import { AbstractAgent } from "@ag-ui/client";
import { EventType } from "@ag-ui/core";
import { from, lastValueFrom, toArray } from "rxjs";
import { IssueId } from "../../src/identities.ts";
import { WorkspaceStateJson } from "../../src/web/workspace-wire.ts";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { Clock, Deferred, Effect, Exit, Fiber, Scope, Stream, Schema } from "effect";
import { TestClock } from "effect/testing";
import { AbraAgent, AbraRunner, WorkspaceFeed } from "../../src/web/agent.ts";
import { CrewError } from "../../src/domain.ts";
import { WorkspaceFixture } from "../helpers/web.ts";

for (const termination of ["EOF", "failure"] as const)
  test(`workspace observation reconnects after ${termination} and keeps its fallback scoped`, async () => {
    let subscriptions = 0;
    let reads = 0;
    const source = new WorkspaceFixture();
    const ended = Deferred.makeUnsafe<void>();
    const backend = Object.assign(source, {
      snapshot: Effect.sync(() => {
        reads++;
        return { ...source.value, busy: subscriptions > 1 };
      }),
      changes: Stream.unwrap(
        Effect.sync(() => {
          subscriptions++;
          return subscriptions === 1
            ? Stream.fromEffect(Deferred.await(ended)).pipe(
                Stream.flatMap(() =>
                  termination === "EOF"
                    ? Stream.empty
                    : Stream.fail(new CrewError("FIXTURE_EOF", "Connection lost")),
                ),
              )
            : Stream.concat(Stream.succeed(undefined), Stream.never);
        }),
      ),
    });
    await Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make();
        const feed = yield* WorkspaceFeed.make(backend).pipe(
          Effect.provideService(Scope.Scope, scope),
        );
        let observedReconnection = false;
        let observedChange = false;
        const observer = yield* feed.updates.pipe(
          Stream.runForEach((event) =>
            Effect.sync(() => {
              if (event.type === "reconnecting") observedReconnection = true;
              if (event.type === "snapshot" && event.snapshot.busy) observedChange = true;
            }),
          ),
          Effect.forkChild,
        );
        yield* TestClock.adjust("0 millis");
        yield* Deferred.succeed(ended, undefined);
        yield* TestClock.adjust("0 millis");
        assert.equal(observedReconnection, true);
        yield* TestClock.adjust("1 second");
        assert.equal(subscriptions, 2);
        assert.equal(observedChange, true);
        const beforeFallback = reads;
        yield* TestClock.adjust("5 seconds");
        assert.ok(reads > beforeFallback, "Fallback must keep observing during reconnection");
        yield* Scope.close(scope, Exit.void);
        yield* Fiber.interrupt(observer);
        const disposedReads = reads;
        yield* TestClock.adjust("10 seconds");
        assert.equal(reads, disposedReads);
        assert.equal(subscriptions, 2);
      }).pipe(Effect.provide(TestClock.layer())),
    );
    assert.equal(source.stops, 0);
    assert.equal(source.submissions, 0);
  });

test("disposing during EOF backoff cancels the next subscription without native stop", async () => {
  let subscriptions = 0;
  const source = new WorkspaceFixture();
  await Effect.runPromise(
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      yield* WorkspaceFeed.make(
        Object.assign(source, {
          changes: Stream.unwrap(
            Effect.sync(() => {
              subscriptions++;
              return Stream.empty;
            }),
          ),
        }),
      ).pipe(Effect.provideService(Scope.Scope, scope));
      yield* TestClock.adjust("0 millis");
      assert.equal(subscriptions, 1);
      yield* Scope.close(scope, Exit.void);
      yield* TestClock.adjust("10 seconds");
      assert.equal(subscriptions, 1);
    }).pipe(Effect.provide(TestClock.layer())),
  );
  assert.equal(source.stops, 0);
  assert.equal(source.submissions, 0);
});

test("AG-UI observation is interruptible and disconnect never stops native work", async () => {
  const backend = new WorkspaceFixture();
  const started = Deferred.makeUnsafe<void>();
  const detached = Deferred.makeUnsafe<void>();
  const runner = new AbraRunner(backend, {
    notify: () => Effect.void,
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
  const runner = new AbraRunner(backend, { notify: () => Effect.void, updates: Stream.never });
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
  const runner = new AbraRunner(backend, { notify: () => Effect.void, updates: Stream.never });
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

test("unchanged fallbacks publish freshness only and scoped bursts keep off-page issue hints", async () => {
  const source = new WorkspaceFixture();
  const scopes: import("@abracode/contracts/web/changes").ChangeScope[] = [];
  let reads = 0;
  source.observe = (scope: import("@abracode/contracts/web/changes").ChangeScope) =>
    Effect.gen(function* () {
      reads++;
      scopes.push(scope);
      return { ...source.value, at: new Date(yield* Clock.currentTimeMillis).toISOString() };
    });
  await Effect.runPromise(
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const feed = yield* WorkspaceFeed.make(source).pipe(
        Effect.provideService(Scope.Scope, scope),
      );
      const events: { type: string }[] = [];
      const observer = yield* feed.updates.pipe(
        Stream.runForEach((event) =>
          Effect.sync(() => {
            events.push(event);
          }),
        ),
        Effect.forkChild,
      );
      yield* TestClock.adjust("0 millis");
      assert.equal(reads, 1);
      for (let i = 0; i < 3; i++) yield* TestClock.adjust("5 seconds");
      assert.equal(reads, 4, "One fallback schedule makes exactly one read per interval");
      assert.equal(
        events.filter((event) => event.type === "snapshot").length,
        2,
        "Initial read plus bootstrap delivery; wire projector suppresses the duplicate sequence",
      );
      assert.equal(events.filter((event) => event.type === "freshness").length, 3);
      source.value = { ...source.value, busy: true };
      yield* feed.notify({ transcript: true });
      yield* TestClock.adjust("200 millis");
      assert.equal(scopes.at(-1)?.transcript, true);
      assert.equal(scopes.at(-1)?.work_all, undefined);
      const offPage = IssueId.make("closed-off-page");
      yield* feed.notify({ issues: [offPage], finder: true });
      yield* feed.notify({ attention: true });
      yield* TestClock.adjust("400 millis");
      assert.ok(scopes.some((scope) => scope.issues?.includes(offPage)));
      const baseline = yield* feed.baseline;
      assert.equal(baseline.observation?.baseline, true);
      assert.ok(baseline.observation!.sequence >= 2);
      const before = reads;
      yield* Scope.close(scope, Exit.void);
      yield* Fiber.interrupt(observer);
      yield* TestClock.adjust("10 seconds");
      assert.equal(reads, before);
    }).pipe(Effect.provide(TestClock.layer())),
  );
  assert.equal(source.submissions, 0);
  assert.equal(source.stops, 0);
});

test("AG-UI consumer applies contiguous deltas and recovers gaps/restarts from full baselines", async () => {
  const source = new WorkspaceFixture();
  const snapshot = (epoch: string, sequence: number, text: string, at: string) => ({
    ...source.value,
    at,
    messages: [{ id: "msg_native", role: "assistant" as const, text, at: "2026-01-01T00:00:00Z" }],
    observation: { epoch, sequence, baseline: false, changes: { transcript: true } },
  });
  const values = [
    snapshot("one", 1, "Hello", "2030-01-01T00:00:00Z"),
    snapshot("one", 2, "Hello there", "2029-01-01T00:00:00Z"),
    snapshot("one", 2, "Duplicate must be ignored", "2031-01-01T00:00:00Z"),
    snapshot("one", 4, "Gap recovered", "2028-01-01T00:00:00Z"),
    snapshot("two", 1, "Restart baseline", "2027-01-01T00:00:00Z"),
  ];
  const runner = new AbraRunner(source, {
    notify: () => Effect.void,
    updates: Stream.fromIterable(
      values.map((snapshot) => ({ type: "snapshot" as const, snapshot })),
    ),
  });
  const events = await lastValueFrom(
    runner.connect({ threadId: source.sessionID, agentId: "abra" }).pipe(toArray()),
  );
  assert.equal(events.filter((event) => event.type === EventType.STATE_SNAPSHOT).length, 3);
  assert.equal(events.filter((event) => event.type === EventType.STATE_DELTA).length, 1);
  assert.ok(events.some((event) => event.type === EventType.TEXT_MESSAGE_CONTENT));
  class Observer extends AbstractAgent {
    run() {
      return from(events);
    }
    protected override connect() {
      // The HTTP runtime supplies run envelopes around AgentRunner.connect.
      return from([
        { type: EventType.RUN_STARTED, threadId: source.sessionID, runId: "observer" } as const,
        ...events,
        { type: EventType.RUN_FINISHED, threadId: source.sessionID, runId: "observer" } as const,
      ]);
    }
  }
  const observer = new Observer({ threadId: source.sessionID });
  await observer.connectAgent();
  assert.equal(observer.messages.length, 1);
  assert.equal(observer.messages[0].id, "msg_native");
  assert.equal(observer.messages[0].content, "Restart baseline");
  const state = Schema.decodeUnknownSync(WorkspaceStateJson)(observer.state);
  assert.equal(state.workspace.observation?.epoch, "two");
  assert.equal(state.workspace.at, "2027-01-01T00:00:00Z");
  assert.equal(source.submissions, 0);
  assert.equal(source.stops, 0);
});
