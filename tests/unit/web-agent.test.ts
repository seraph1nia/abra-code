import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { Deferred, Effect, Stream } from "effect";
import { AbraAgent, AbraRunner } from "../../src/web/agent.ts";
import { WorkspaceFixture } from "../helpers/web.ts";

test("AG-UI observation is interruptible and disconnect never stops native work", async () => {
  const backend = new WorkspaceFixture();
  const started = Deferred.makeUnsafe<void>();
  const detached = Deferred.makeUnsafe<void>();
  const runner = new AbraRunner(backend, {
    refresh: Effect.void,
    updates: Stream.never.pipe(
      Stream.onStart(Deferred.succeed(started, undefined)),
      Stream.ensuring(Deferred.succeed(detached, undefined)),
    ),
  });
  const subscription = runner.connect({ threadId: backend.sessionID, agentId: "abra" }).subscribe();
  await Effect.runPromise(Deferred.await(started).pipe(Effect.timeout("1 second")));
  subscription.unsubscribe();
  await Effect.runPromise(Deferred.await(detached).pipe(Effect.timeout("1 second")));
  assert.equal(backend.stops, 0);
  assert.equal(backend.submissions, 0);
});

test("run-specific Stop refuses an unsafe substitute; current Abra Stop stays explicit", async () => {
  const backend = new WorkspaceFixture();
  const runner = new AbraRunner(backend, { refresh: Effect.void, updates: Stream.never });
  await assert.rejects(
    runner.stop({ threadId: backend.sessionID, runId: "old-run" }),
    /particular historical run/,
  );
  assert.equal(backend.stops, 0);
  assert.equal(await runner.stop({ threadId: backend.sessionID }), true);
  assert.equal(backend.stops, 1);
  await assert.rejects(runner.stop({ threadId: "ses_worker" }));
  assert.equal(backend.stops, 1);
});

test("client tool/context injection cannot alter native Abra configuration", async () => {
  const backend = new WorkspaceFixture();
  const runner = new AbraRunner(backend, { refresh: Effect.void, updates: Stream.never });
  const agent = new AbraAgent(runner, backend.sessionID);
  const input = {
    threadId: backend.sessionID,
    runId: "run-inject",
    messages: [{ id: "u1", role: "user" as const, content: "Build" }],
    tools: [{ name: "write_anything", description: "Unsafe", parameters: {} }],
    context: [],
    state: {},
    forwardedProps: { request_id: "identity" },
  };
  const error = await new Promise<unknown>((resolve) =>
    runner.run({ threadId: backend.sessionID, agent, input }).subscribe({ error: resolve }),
  );
  assert.match(String(error), /Client tools and context/);
  assert.equal(backend.submissions, 0);
});
