import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Effect, Exit, Scope } from "effect";
import type { Endpoint } from "@opencode/client/effect/service";
import { reportBrowserExecutable } from "@abracode/report-export/browser";
import { NativeWebBackend } from "../../src/web/backend.ts";
import { workspaceServer } from "../../src/web/server.ts";
import { AbsolutePath } from "../../src/identities.ts";
import type { InboxSummary, InboxTarget } from "@abracode/contracts/visibility/github-inbox";

export async function inboxJourney(input: {
  home: string;
  root: string;
  project: string;
  session: string;
  endpoint: Endpoint;
  evidence?: string;
  invoke: (tool: string, args: unknown) => Promise<any>;
  restart: () => Promise<void>;
  eventually: <T>(f: () => Promise<T | undefined>, timeout?: number) => Promise<T>;
}) {
  const cli = promisify(execFile);
  const git = (...args: string[]) => cli("git", args, { cwd: input.project });
  const shim = join(input.root, "read-fixture-remote");
  // SSH fetches terminate locally. The push URL is always the fixture's own bare repository.
  await writeFile(shim, '#!/bin/sh\nexec git-upload-pack "$ABRACODE_INBOX_FIXTURE_REMOTE"\n', {
    mode: 0o700,
  });
  await git("config", "core.sshCommand", shim);
  await git("config", "ssh.variant", "ssh");
  await git("remote", "set-url", "origin", "git@inbox.invalid:fixture/api.git");
  await git("remote", "set-url", "--push", "origin", input.project + ".git");
  await input.invoke("abra_project_onboard", {
    id: "api",
    path: input.project,
    action: "register",
    plan_approval: false,
    merge_approval: true,
    delivery: "github-pr",
    verification: [[process.execPath, "--version"]],
  });
  const list = () => input.invoke("abra_github_inbox", {});
  const first = await list();
  assert.equal(first.total, 2);
  const select = (row: InboxSummary): InboxTarget => ({
    repository_id: row.repository_id,
    repo_node: row.repo_node,
    item_node: row.item_node,
    kind: row.kind,
    number: row.number,
  });
  const issue = select(first.entries.find((r: InboxSummary) => r.kind === "issue")),
    pr = select(first.entries.find((r: InboxSummary) => r.kind === "pr"));
  const local = await input.invoke("abra_github_assign", issue);
  assert.equal(await input.invoke("abra_github_assign", issue), local);
  const review = await input.invoke("abra_github_assign", pr);
  await input.invoke("abra_work_start", { issue_id: review });
  const status = async (id: string) => {
    const e = (await input.invoke("abra_work_status", { issue_id: id })).execution;
    if (["failed", "recovery_required", "blocked"].includes(e.current_phase))
      throw Object.assign(Error(e.error_or_recovery_reason || e.current_phase), { terminal: true });
    return e;
  };
  await input.eventually(
    async () => (await status(review)).current_phase === "completed" || undefined,
    60000,
  );
  const worker = (await status(review)).configuration_snapshot.workers.research;
  assert.equal(worker.model.id, "gpt-specialist");
  assert.ok(worker.required_skills.includes("abra-open-code-review-delegate"));
  assert.equal(await input.invoke("abra_github_assign", pr), review);
  await input.invoke("abra_work_start", { issue_id: local });
  const published = await input.eventually(
    async () => (await status(local)).pull_request_reference || undefined,
    90000,
  );
  await input.restart();
  await input.invoke("abra_github_inbox", { refresh: true });
  const page = await input.eventually(async () => {
    const p = await list();
    return p.entries.some((r: InboxSummary) => r.url === published) ? p : undefined;
  });
  assert.ok(
    page.entries
      .find((r: InboxSummary) => r.url === published)
      .links.some((l: { role: string }) => l.role === "delivery"),
  );
  const detail = await input.invoke("abra_github_item", pr);
  assert.equal(detail.links[0].status, "closed");
  assert.equal(detail.state, "OPEN");
  const scope = Scope.makeUnsafe();
  const backend = new NativeWebBackend(
    AbsolutePath.make(input.home),
    input.session,
    Effect.succeed(input.endpoint),
  );
  const web = await Effect.runPromise(
    workspaceServer({ port: 0, backend, assets: join(input.home, "apps/web/dist") }).pipe(
      Effect.provideService(Scope.Scope, scope),
    ),
  );
  const session = "abra-github-" + process.pid;
  const ab = (...args: string[]) =>
    cli(resolve("node_modules/.bin/agent-browser"), ["--session", session, ...args], {
      timeout: 20000,
      env: { ...process.env, AGENT_BROWSER_EXECUTABLE_PATH: reportBrowserExecutable() },
    });
  try {
    await ab("open", web.origin);
    await ab("set", "viewport", "1500", "900");
    await ab("find", "label", "Toggle work finder", "click");
    await ab("wait", "--text", "Fix export retries");
    await ab("wait", "--text", "Review retry messaging");
    if (input.evidence) {
      await mkdir(input.evidence, { recursive: true });
      await ab("screenshot", join(input.evidence, "github-inbox.png"));
      await writeFile(join(input.evidence, "github-inbox.txt"), (await ab("snapshot")).stdout);
    }
    await ab(
      "find",
      "role",
      "button",
      "click",
      "--name",
      "api PR #91 · Review retry messaging colleague · open · review (closed)",
    );
    await ab("wait", "--text", "Reviewed revision aaaaaaaa");
    if (input.evidence) {
      await ab("screenshot", join(input.evidence, "github-pr.png"));
      await writeFile(join(input.evidence, "github-pr.txt"), (await ab("snapshot")).stdout);
    }
    await ab("find", "text", "review · closed", "click");
    await ab("wait", "--text", "Reviewed retry messaging");
    const report = await Effect.runPromise(backend.work.report({ issue_id: review }));
    assert.ok(
      "content" in report &&
        report.content.includes("Reviewed retry messaging") &&
        report.content.includes("a".repeat(40)),
    );
    if (input.evidence)
      await writeFile(
        join(input.evidence, "steps.md"),
        "1. Open Work on the disposable service.\n2. Inspect issue #42, the delivery PR and colleague PR #91.\n3. Select #91 and open the linked completed review.\n4. Read the retained report after the native service restart.\n",
      );
    return {
      issue: local,
      review,
      published,
      pr: detail.state,
      review_state: detail.links[0].status,
    };
  } catch (error) {
    if (input.evidence)
      await writeFile(join(input.evidence, "browser-failure.txt"), (await ab("snapshot")).stdout);
    throw error;
  } finally {
    try {
      await ab("close");
    } finally {
      await Effect.runPromise(Scope.close(scope, Exit.void));
    }
  }
}
