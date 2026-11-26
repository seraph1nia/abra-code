import { publicationDestination } from "../../src/workflow/finishing/contracts.ts";
import { CrewError } from "../../src/domain.ts";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Id from "@abracode/contracts/identities";
import { domainEffect, run } from "../effects.ts";
import { Effect } from "effect";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { fixture, delivered } from "../fixtures.ts";
import { GitHubDelivery, type PR } from "../../src/git/delivery.ts";
import { type Runner } from "../../src/process.ts";
import { forgeFixture } from "../forge.ts";
import { permittedTools } from "../../src/opencode/guards.ts";
test("delivery rediscovers an existing PR and exact pushed head without creating or pushing duplicates", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  let e = await run(delivered(f)),
    p = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
  const calls: string[][] = [];
  const pr: PR = {
    url: Id.PullRequestUrl.make("https://example.invalid/fixture/api/pull/7"),
    state: "OPEN",
    headRefOid: e.delivered_commit!,
    baseRefName: Id.BranchName.make("main"),
    body: "",
    isDraft: false,
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
  };
  let changeDuringEdit = false;
  const runner: Runner = {
    run(_file, args) {
      return domainEffect(
        Effect.sync(() => {
          calls.push(args);
          if (changeDuringEdit && args[1] === "edit") pr.baseRefName = e.branch;
          return JSON.stringify([pr]);
        }),
      );
    },
  };
  const git = f.git;
  const original = git.run.bind(git);
  git.run = (cwd, args) =>
    domainEffect(
      Effect.gen(function* () {
        return args[0] === "ls-remote"
          ? `${e.delivered_commit}\trefs/heads/${e.branch}`
          : yield* original(cwd, args);
      }),
    );
  e = { ...e, pull_request_reference: pr.url };
  const d = new GitHubDelivery(git, runner, Id.Executable.make("gh"));
  const result = await run(
    d.deliver(p, e, { commit: e.delivered_commit!, destination: publicationDestination(e) }),
  );
  assert.equal(result.pr, pr.url);
  assert.equal(calls.filter((a) => a[1] === "create").length, 0);
  changeDuringEdit = true;
  await assert.rejects(
    run(d.deliver(p, e, { commit: e.delivered_commit!, destination: publicationDestination(e) })),
    /changed during its publication update/,
  );
});
test("merge requires exact PR head and successful CI, honors requested changes", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  let e = await run(delivered(f)),
    p = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
  let pr: PR = {
    url: Id.PullRequestUrl.make("https://example.invalid/fixture/api/pull/7"),
    state: "OPEN",
    headRefOid: e.delivered_commit!,
    baseRefName: Id.BranchName.make("main"),
    body: "",
    isDraft: false,
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    reviewDecision: "APPROVED",
    statusCheckRollup: [{ status: "COMPLETED", conclusion: "FAILURE" }],
  };
  const { calls, runner: r } = forgeFixture(p, () => pr);
  e = { ...e, pull_request_reference: pr.url };
  const d = new GitHubDelivery(f.git, r, Id.Executable.make("gh"));
  assert.equal((await run(d.merge(p, e))).category, "verification");
  pr.statusCheckRollup = [{ status: "COMPLETED", conclusion: "SUCCESS" }];
  pr.reviewDecision = "CHANGES_REQUESTED";
  assert.equal((await run(d.merge(p, e))).category, "verification");
  pr.reviewDecision = "APPROVED";
  pr.headRefOid = Id.Commit.make("f".repeat(40));
  await assert.rejects(run(d.merge(p, e)), /head/);
  assert.equal(calls.filter((a) => a[1] === "merge").length, 0);
});
test("worker tool allowlists deny management, arbitrary delegation and Explore shell", () => {
  for (const role of ["explore", "apply", "review"] as const) {
    const allow = permittedTools(role);
    assert.equal(allow.has(Id.ToolName.make("abra_work_approve")), false);
    assert.equal(allow.has(Id.ToolName.make("abra_work_finish")), false);
    assert.equal(allow.has(Id.ToolName.make("abra_work_create")), false);
    assert.equal(allow.has(Id.ToolName.make("abra_work_diagnostics")), false);
    assert.equal(allow.has(Id.ToolName.make("task")), false);
  }
  assert.equal(permittedTools("explore").has(Id.ToolName.make("bash")), false);
  assert.equal(permittedTools("review").has(Id.ToolName.make("write")), false);
  assert.equal(permittedTools("apply").has(Id.ToolName.make("bash")), true);
});

test("finalization refuses a prepared commit with a different tree before publication", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const prepare = f.git.commit.bind(f.git);
  f.git.commit = (...args) =>
    prepare(...args).pipe(Effect.andThen(f.git.branch(args[0], Id.BranchName.make("main"))));
  await assert.rejects(run(delivered(f)), /retained reviewed tree/);
  const e = await run(f.controller.get(Id.IssueId.make("abra-1")));
  assert.equal(f.delivery.calls, 0);
  assert.equal(
    await run(f.git.run(e.worktree_directory!, ["ls-remote", "origin", `refs/heads/${e.branch}`])),
    "",
  );
});

test("branch delivery publishes the bound SHA after local edits and branch movement", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(delivered(f));
  const p = (await run(f.records.project(e.repository_id)))!;
  const cwd = e.worktree_directory!;
  const sha = e.delivered_commit!;
  const ref = `refs/heads/${e.branch}`;
  await run(f.git.run(cwd, ["push", "origin", `:${ref}`]));
  await run(f.git.run(cwd, ["commit", "--allow-empty", "-m", "later work"]));
  await writeFile(join(cwd, "later.txt"), "uncommitted");
  const d = new GitHubDelivery(
    f.git,
    forgeFixture(p, () => undefined).runner,
    Id.Executable.make("gh"),
  );
  assert.deepEqual(
    await run(
      d.deliver({ ...p, delivery: "branch" }, e, {
        commit: sha,
        destination: publicationDestination(e),
      }),
    ),
    { commit: sha },
  );
  assert.equal(await run(f.git.run(cwd, ["ls-remote", "origin", ref])), `${sha}\t${ref}`);
  assert.match(await run(f.git.dirty(cwd)), /later.txt/);
  assert.notEqual(await run(f.git.head(cwd)), sha);
});

test("PR creation confirms the returned identity, base and head and reconciles a lost response", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  let e = await run(delivered(f));
  const p = (await run(f.records.project(e.repository_id)))!;
  const pr = { ...f.delivery.pr!, body: "" };
  e = { ...e, pull_request_reference: undefined };
  e = { ...e, finishing: undefined };
  for (const observed of [
    { ...pr, baseRefName: e.branch },
    { ...pr, headRefOid: Id.Commit.make("a".repeat(40)) },
    { ...pr, url: Id.PullRequestUrl.make(pr.url + "0") },
    pr,
  ]) {
    let creates = 0;
    const d = new GitHubDelivery(
      f.git,
      {
        run: (_file, args) => {
          if (args[1] === "create") {
            creates++;
            return observed === pr
              ? Effect.fail(new CrewError("LOST", "lost create response"))
              : Effect.succeed(pr.url);
          }
          return Effect.succeed(JSON.stringify(creates ? [observed] : []));
        },
      },
      Id.Executable.make("gh"),
    );
    await assert.rejects(
      run(d.deliver(p, e, { commit: e.delivered_commit!, destination: publicationDestination(e) })),
      observed === pr ? /lost create/ : /Created PR/,
    );
    if (observed === pr)
      assert.equal(
        (
          await run(
            d.deliver(p, e, {
              commit: e.delivered_commit!,
              destination: publicationDestination(e),
            }),
          )
        ).pr,
        pr.url,
      );
    assert.equal(creates, 1);
  }
});
