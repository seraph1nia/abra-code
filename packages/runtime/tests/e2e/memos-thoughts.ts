import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { Effect, Exit, Scope } from "effect";
import type { Endpoint } from "@opencode/client/effect/service";
import { reportBrowserExecutable } from "@abracode/report-export/browser";
import { AbsolutePath, IssueId } from "../../src/identities.ts";
import { NativeWebBackend } from "../../src/web/backend.ts";
import { workspaceServer } from "../../src/web/server.ts";

export const roadExcerpt = "make time for weekly planning";
export const roadQuestion = "AbraCode, discuss the thought I selected on the road.";
export async function thoughtsJourney(input: {
  home: string;
  project: string;
  session: string;
  endpoint: Endpoint;
  evidence?: string;
  invoke: (tool: string, args: unknown) => Promise<any>;
}) {
  const scope = Scope.makeUnsafe();
  const backend = new NativeWebBackend(
    AbsolutePath.make(input.home),
    input.session,
    Effect.succeed(input.endpoint),
  );
  const cli = promisify(execFile);
  const ab = (...args: string[]) =>
    cli(
      resolve("node_modules/.bin/agent-browser"),
      ["--session", "abra-thoughts-" + process.pid, ...args],
      {
        env: { ...process.env, AGENT_BROWSER_EXECUTABLE_PATH: reportBrowserExecutable() },
        timeout: 30000,
      },
    );
  try {
    const web = await Effect.runPromise(
      workspaceServer({ port: 0, backend, assets: join(input.home, "apps/web/dist") }).pipe(
        Effect.provideService(Scope.Scope, scope),
      ),
    );
    const results = await Effect.runPromise(backend.work.thoughtList({ text: roadExcerpt }));
    assert.equal(results.entries.length, 1);
    const ref = results.entries[0]!.reference;
    assert.deepEqual(results.entries[0]!.tags, []);
    await ab("open", web.origin);
    await ab("set", "viewport", "390", "844");
    await ab("wait", '[aria-label="Message Abra"]');
    await ab("find", "role", "link", "click", "--name", "Thoughts", "--exact");
    await ab("wait", "--text", "Thoughts");
    await ab("wait", '[aria-label="Thought text"]');
    await ab("find", "label", "Thought text", "fill", roadExcerpt);
    await ab("find", "role", "button", "click", "--name", "Search thoughts");
    await ab("wait", "--text", "Road notebook:");
    await ab("find", "text", "Road notebook:", "click");
    await ab("wait", "--text", "Open in Memos");
    if (input.evidence)
      await writeFile(join(input.evidence, "abra-thought.txt"), (await ab("snapshot")).stdout);
    await ab("find", "role", "button", "click", "--name", "Ask Abra about this");
    await ab("wait", ".thought-source a");
    const original = (await ab("get", "attr", ".thought-source a", "href")).stdout.trim();
    assert.equal(original, (await Effect.runPromise(backend.work.thoughtDetail(ref))).url);
    await ab("tab", "new", original);
    await ab("wait", "body");
    assert.equal(new URL((await ab("get", "url")).stdout.trim()).origin, ref.instance);
    if (input.evidence)
      await writeFile(
        join(input.evidence, "original-memos-on-phone.txt"),
        (await ab("snapshot")).stdout,
      );
    await ab("tab", "t1");
    await ab("find", "label", "Message Abra", "fill", roadQuestion);
    await ab("press", "Enter");
    await ab("wait", "--text", "I found the weekly planning thought.");
    if (input.evidence)
      await writeFile(join(input.evidence, "abra-discussion.txt"), (await ab("snapshot")).stdout);
    const capture = {
      request_id: "standalone-capture",
      content: "Separate capture\nwith original line breaks.",
    };
    const saved = await input.invoke("abra_thought_save", capture);
    assert.deepEqual(await input.invoke("abra_thought_save", capture), saved);
    assert.equal(
      (await Effect.runPromise(backend.work.thoughtDetail(saved))).content,
      capture.content,
    );
    await input.invoke("abra_project_onboard", {
      id: "api",
      path: input.project,
      action: "register",
      verification: [[process.execPath, "--version"]],
    });
    const goal = {
      repository_id: "api",
      title: "Weekly planning view",
      description: "Add a weekly planning view",
      request_id: "road-work",
      thought_source: { reference: ref, excerpt: roadExcerpt },
    };
    const result = await input.invoke("abra_work_create", goal);
    assert.deepEqual((await input.invoke("abra_work_create", goal)).issue.id, result.issue.id);
    const overview = await Effect.runPromise(
      backend.work.overview({ issue_id: IssueId.make(result.issue.id) }),
    );
    assert.deepEqual(overview.thought_source, goal.thought_source);
    const used = await Effect.runPromise(backend.work.thoughtWork(ref));
    assert.ok(
      used.entries.some(
        (row) => row.id === result.issue.id && row.wording_hash === ref.wording_hash,
      ),
    );
    assert.ok(!JSON.stringify(overview).includes("Keep this second sentence personal"));
    if (input.evidence)
      await writeFile(join(input.evidence, "intake.json"), JSON.stringify(overview, null, 2));
    return { memo: ref.name, issue: result.issue.id, accepted_excerpt: roadExcerpt };
  } catch (error) {
    if (input.evidence)
      await writeFile(join(input.evidence, "failed-attempt.txt"), (await ab("snapshot")).stdout);
    throw error;
  } finally {
    await ab("close").finally(() => Effect.runPromise(Scope.close(scope, Exit.void)));
  }
}
