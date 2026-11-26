import { EventSchema } from "@ag-ui/core/schemas";
import { NativeSessionProjection } from "../../src/opencode/agui/native-state.ts";
import type { ChangeScope, Observation } from "@abracode/contracts/web/changes";
import { projectNativeMessage } from "../../src/opencode/agui/messages.ts";
import { NativeAgentAdapter } from "../../src/opencode/agui/adapter.ts";
import { SessionMessage } from "@opencode/schema/session-message";
import { AbstractAgent } from "@ag-ui/client";
import { EventType } from "@ag-ui/core";
import { from, lastValueFrom, toArray } from "rxjs";
import {
  Fingerprint,
  FormId,
  IssueId,
  MessageId,
  ContentHash,
  Identifier,
  RequestId,
  timestampAt,
} from "@abracode/contracts/identities";
import { WorkspaceStateJson } from "@abracode/contracts/web/workspace-wire";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { Clock, Deferred, Effect, Exit, Fiber, Scope, Stream, Schema, PubSub } from "effect";
import { TestClock } from "effect/testing";
import { AbraAgent, AbraRunner, WorkspaceFeed } from "../../src/web/agent.ts";
import { CrewError } from "../../src/domain.ts";
import { retainedExecution } from "../helpers/retained-execution.ts";
import { deliveryOutcome } from "../../src/visibility/delivery-outcome.ts";
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
        yield* TestClock.adjust("2 seconds");
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

test("observation failure terminates once, releases its stream and hides producer data", async () => {
  for (const updates of [
    Stream.succeed({
      type: "custom" as const,
      event: { type: EventType.RUN_STARTED } as import("@ag-ui/core").Event,
    }),
    Stream.die(new Error("secret fixture detail")),
    Stream.empty,
  ]) {
    const backend = new WorkspaceFixture();
    let releases = 0;
    const adapter = new NativeAgentAdapter({
      sessionID: backend.sessionID,
      current: Effect.succeed({ busy: false }),
      submit: () => Effect.die("unexpected submission"),
      receipt: () => Effect.succeed(null),
      stop: backend.stop,
      notifyAdmission: Effect.void,
      updates: updates.pipe(
        Stream.ensuring(
          Effect.sync(() => {
            releases++;
          }),
        ),
      ),
    });
    const terminals: unknown[] = [];
    await new Promise<void>((resolve) => {
      adapter.connect(backend.sessionID).subscribe({
        complete: () => {
          terminals.push("complete");
          resolve();
        },
        error: (error) => {
          terminals.push(error);
          resolve();
        },
      });
    });
    assert.equal(terminals.length, 1);
    if (updates === Stream.empty) assert.equal(terminals[0], "complete");
    else {
      assert.ok(terminals[0] instanceof CrewError);
      assert.match(terminals[0].code, /^WEB_(EVENT|OBSERVATION)$/);
      assert.doesNotMatch(terminals[0].message, /secret/);
      assert.ok(terminals[0].message.length < 1024);
    }
    assert.equal(releases, 1);
    assert.equal(backend.stops, 0);
  }
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
  const events = await lastValueFrom(
    runner.run({ threadId: backend.sessionID, agent, input }).pipe(toArray()),
  );
  const error = events.find((event) => event.type === EventType.RUN_ERROR);
  assert.ok(error && "message" in error);
  assert.match(String(error.message), /Client tools and context/);
  assert.equal(backend.submissions, 0);
});

test("unchanged fallbacks publish freshness only and scoped bursts keep off-page issue hints", async () => {
  const source = new WorkspaceFixture();
  const item = source.value.work.work[0]!;
  const fingerprint = Fingerprint.make("plan");
  const { execution } = await retainedExecution({
    issue_id: item.issue_id,
    plan_fingerprint: fingerprint,
    approval_receipts: [
      { kind: "plan", fingerprint, form_id: FormId.make("frm_plan"), session_id: source.sessionID },
    ],
  });
  const scopes: ChangeScope[] = [];
  const release = Deferred.makeUnsafe<void>();
  let reads = 0;
  source.observe = (scope: ChangeScope) =>
    Effect.gen(function* () {
      reads++;
      scopes.push(scope);
      if (scope.transcript) yield* Deferred.await(release);
      const now = yield* Clock.currentTimeMillis;
      return {
        ...source.value,
        at: new Date(now).toISOString(),
        work: {
          ...source.value.work,
          work: [
            {
              ...item,
              phase: "awaiting_plan_approval",
              outcome: deliveryOutcome(execution, "in_progress", now),
            },
          ],
        },
      };
    });
  await Effect.runPromise(
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const feed = yield* WorkspaceFeed.make(source).pipe(
        Effect.provideService(Scope.Scope, scope),
      );
      const events: Stream.Success<typeof feed.updates>[] = [];
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
        1,
        "Subscription and baseline capture deliver the initial observation exactly once",
      );
      assert.equal(events.filter((event) => event.type === "freshness").length, 3);
      execution.approval_receipts[0]!.authorized_at = timestampAt(15000);
      yield* TestClock.adjust("5 seconds");
      assert.equal(events.filter((event) => event.type === "snapshot").length, 2);
      const peerObservations: Observation[] = [];
      const peer = yield* feed.updates.pipe(
        Stream.runForEach((event) =>
          Effect.sync(() => {
            if (event.type === "snapshot") peerObservations.push(event.snapshot.observation!);
          }),
        ),
        Effect.forkChild,
      );
      yield* TestClock.adjust("0 millis");
      assert.equal(peerObservations.at(-1)?.baseline, true);
      source.value = { ...source.value, busy: true };
      yield* feed.notify({ transcript: true });
      yield* TestClock.adjust("200 millis");
      assert.equal(scopes.at(-1)?.transcript, true);
      assert.equal(scopes.at(-1)?.work_all, undefined);
      const blockedReads = reads;
      const offPage = [IssueId.make("closed-off-page"), IssueId.make("another-off-page")];
      yield* feed.notify({ issues: [offPage[0]!], finder: true });
      yield* feed.notify({ issues: [offPage[1]!], attention: true });
      yield* Deferred.succeed(release, undefined);
      yield* TestClock.adjust("400 millis");
      assert.equal(reads, blockedReads + 1);
      assert.deepEqual(scopes.at(-1)?.issues, offPage);
      const merged = events.at(-1);
      assert.ok(merged?.type === "snapshot");
      assert.deepEqual(merged.snapshot.observation?.changes.issues, offPage);
      assert.deepEqual(peerObservations.at(-1), merged.snapshot.observation);
      const baseline = yield* feed.baseline;
      assert.equal(baseline.observation?.baseline, true);
      assert.ok(baseline.observation!.sequence >= 2);
      const before = reads;
      yield* Scope.close(scope, Exit.void);
      yield* Fiber.interrupt(observer);
      yield* Fiber.interrupt(peer);
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
      values.map((snapshot) => ({ type: "snapshot" as const, snapshot, native: snapshot })),
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
      return from(events);
    }
  }
  const observer = new Observer({ threadId: source.sessionID });
  await observer.connectAgent();
  assert.equal(observer.messages.length, 1);
  assert.equal(observer.messages[0].id, "msg_native");
  assert.equal(observer.messages[0].content, "Restart baseline");
  assert.equal(Object.hasOwn(observer.state.workspace, "messages"), false);
  const state = Schema.decodeUnknownSync(WorkspaceStateJson)(observer.state);
  assert.equal(state.workspace.observation?.epoch, "two");
  assert.equal(state.workspace.at, "2027-01-01T00:00:00Z");
  assert.equal(source.submissions, 0);
  assert.equal(source.stops, 0);
});

test("native adapter runs without workspace, finder or report data and cloned hosting retains middleware", async () => {
  let admissions = 0,
    stops = 0,
    middlewareCalls = 0;
  const view = {
    completions: [{ inputs: ["msg_native-only"], outcome: "succeeded" as const }],
    busy: false,
    messages: [
      {
        id: "msg_native-only",
        role: "user" as const,
        text: "Native input",
        at: "2026-11-16T00:00:00Z",
      },
    ],
    inbox: [],
  };
  const adapter = new NativeAgentAdapter({
    sessionID: "ses_native-only",
    current: Effect.succeed({ busy: false }),
    receipt: () => Effect.succeed(null),
    submit: (input) =>
      Effect.sync(() => {
        admissions++;
        return {
          ...input,
          message_id: SessionMessage.ID.make("msg_native-only"),
          at: "2026-11-16T00:00:00Z",
          status: "admitted" as const,
        };
      }),
    stop: Effect.sync(() => {
      stops++;
      return true;
    }),
    notifyAdmission: Effect.void,
    updates: Stream.succeed({ type: "snapshot", native: view }),
  });
  const input = {
    threadId: "ses_native-only",
    runId: "run-native-only",
    state: {},
    tools: [],
    context: [],
    messages: [{ id: "input", role: "user" as const, content: "Native input" }],
    forwardedProps: { request_id: "native-only" },
  };
  const events = await lastValueFrom(adapter.run(input.threadId, "abra", input).pipe(toArray()));
  assert.deepEqual(
    events.map((event) => event.type),
    [EventType.RUN_STARTED, EventType.MESSAGES_SNAPSHOT, EventType.RUN_FINISHED],
  );
  assert.equal(admissions, 1);
  assert.equal(stops, 0);
  const backend = new WorkspaceFixture();
  const runner = new AbraRunner(backend, {
    notify: () => Effect.void,
    updates: Stream.succeed({
      type: "snapshot",
      snapshot: backend.value,
      native: backend.nativeSnapshot(),
    }),
  });
  const agent = new AbraAgent(runner, backend.sessionID);
  agent.description = "Retained configuration";
  agent.setState({ retained: true });
  agent.use((input, next) => {
    middlewareCalls++;
    return next.run(input);
  });
  const clone = agent.clone();
  assert.equal(clone.description, "Retained configuration");
  assert.deepEqual(clone.state, { retained: true });
  clone.setState({});
  clone.setMessages([{ id: "clone-user", role: "user", content: "Retained middleware input" }]);
  await clone.runAgent({ tools: [], context: [], forwardedProps: { request_id: "clone" } });
  assert.equal(backend.submissions, 1);
  assert.equal(middlewareCalls, 1);
});

test("transport completion follows each admitted input across queue, steer, failures and same-ID recovery", async () => {
  const receipts = new Map<
    string,
    import("@abracode/contracts/web/workspace-wire").SubmissionReceipt
  >();
  let prompts = 0;
  const input = (key: string, runId = key) => ({
    threadId: "ses_causal",
    runId,
    tools: [],
    context: [],
    state: {},
    messages: [{ id: key, role: "user" as const, content: key }],
    forwardedProps: { request_id: key, delivery: key === "steer" ? "steer" : "queue" },
  });
  const messages = ["first", "queued", "steer"].map((key) => ({
    id: `msg_${key}`,
    role: "user" as const,
    text: key,
    at: "2026-11-16T00:00:00Z",
  }));
  const observed = (
    inputs: string[],
    outcome: "succeeded" | "failed" = "succeeded",
    error?: string,
  ) => ({
    type: "snapshot" as const,
    native: {
      messages,
      inbox: [],
      busy: false,
      completions: [{ inputs, outcome, error }],
    },
  });
  const source = (events: import("../../src/opencode/agui/adapter.ts").NativeObservation[]) => ({
    sessionID: "ses_causal",
    current: Effect.succeed({ busy: false }),
    stop: Effect.succeed(true),
    notifyAdmission: Effect.void,
    receipt: (key: string) => Effect.succeed(receipts.get(key) ?? null),
    submit: (request: { request_id: string; text: string; delivery: "queue" | "steer" }) =>
      Effect.sync(() => {
        const previous = receipts.get(request.request_id);
        if (previous) return previous;
        prompts++;
        const receipt = {
          ...request,
          message_id: SessionMessage.ID.make(`msg_${request.request_id}`),
          at: "2026-11-16T00:00:00Z",
          status: "admitted" as const,
        };
        receipts.set(request.request_id, receipt);
        return receipt;
      }),
    updates: Stream.fromIterable(events),
  });
  const timeline = [
    observed(["msg_unrelated"]),
    observed(["msg_first"]),
    observed(["msg_queued", "msg_steer"]),
  ];
  const adapter = new NativeAgentAdapter(source(timeline));
  const [first, queued, steered] = await Promise.all(
    ["first", "queued", "steer"].map(async (key) =>
      lastValueFrom(adapter.run("ses_causal", "abra", input(key)).pipe(toArray())),
    ),
  );
  assert.equal(first.at(-1)?.type, EventType.RUN_FINISHED);
  assert.equal(queued.at(-1)?.type, EventType.RUN_FINISHED);
  assert.equal(steered.at(-1)?.type, EventType.RUN_FINISHED);
  assert.equal(prompts, 3);
  const sameRun = adapter.run("ses_causal", "abra", input("queued"));
  const collect = () => lastValueFrom(sameRun.pipe(toArray()));
  const peers = await Promise.all([collect(), collect()]);
  for (const observation of [...peers, await collect()]) {
    assert.deepEqual(observation, queued);
  }
  assert.equal(prompts, 3);
  // Idle with no matching delivered identity is never sufficient, even if the input is visible.
  const unrelated = await lastValueFrom(
    new NativeAgentAdapter(source([observed(["msg_unrelated"])]))
      .run("ses_causal", "abra", input("queued", "unrelated-run"))
      .pipe(toArray()),
  );
  assert.equal(unrelated.at(-1)?.type, EventType.RUN_ERROR);
  const failed = await lastValueFrom(
    new NativeAgentAdapter(
      source([observed(["msg_queued"], "failed", "Provider failure " + "x".repeat(3000))]),
    )
      .run("ses_causal", "abra", input("queued", "failure-run"))
      .pipe(toArray()),
  );
  assert.equal(failed.at(-1)?.type, EventType.RUN_ERROR);
  assert.ok(String(Reflect.get(failed.at(-1)!, "message")).length <= 1024);
  const restarted = new NativeAgentAdapter(source([observed(["msg_queued"])]));
  await lastValueFrom(
    restarted.run("ses_causal", "abra", input("queued", "recovered-transport-run")).pipe(toArray()),
  );
  assert.equal(prompts, 3);
  assert.equal(receipts.get("queued")!.message_id, "msg_queued");
});

test("uncertain admission and unsupported actions produce bounded run errors without replay", async () => {
  let nativePrompts = 0;
  const native = new NativeAgentAdapter({
    sessionID: "ses_uncertain",
    current: Effect.succeed({ busy: false }),
    stop: Effect.succeed(false),
    receipt: () => Effect.succeed(null),
    notifyAdmission: Effect.void,
    submit: (input) =>
      Effect.sync(() => {
        nativePrompts++;
        return {
          ...input,
          message_id: SessionMessage.ID.make("msg_uncertain"),
          at: "2026-11-16T00:00:00Z",
          status: "uncertain" as const,
        };
      }),
    updates: Stream.never,
  });
  const input = {
    threadId: "ses_uncertain",
    runId: "uncertain",
    tools: [],
    context: [],
    state: { workspace: { busy: false } },
    messages: [{ id: "input", role: "user" as const, content: "input" }],
    forwardedProps: { request_id: "same-input" },
  };
  const result = await lastValueFrom(native.run(input.threadId, "abra", input).pipe(toArray()));
  assert.deepEqual(
    result.map((event) => event.type),
    [EventType.RUN_STARTED, EventType.RUN_ERROR],
  );
  assert.equal(nativePrompts, 1);
  for (const changed of [
    { ...input, tools: [{ name: "mutate", description: "Unsupported tool", parameters: {} }] },
    { ...input, forwardedProps: { request_id: "same-input", a2uiAction: { action: "approve" } } },
  ]) {
    const result = await lastValueFrom(native.run(input.threadId, "abra", changed).pipe(toArray()));
    assert.equal(result.at(-1)?.type, EventType.RUN_ERROR);
  }
  assert.equal(nativePrompts, 1);
});

test("native streaming shares one subscription/fallback across observers and releases only scoped resources", async () => {
  const native = new NativeSessionProjection("ses_webfixture");
  const user = Schema.decodeSync(SessionMessage.User)({
    id: "msg_shared",
    type: "user",
    text: "Shared observation",
    time: { created: 0 },
  });
  native.baseline([user], true, []);
  const source = new WorkspaceFixture();
  source.value = { ...source.value, busy: true, messages: [projectNativeMessage(user)!] };
  let subscriptions = 0,
    closed = 0,
    reads = 0;
  await Effect.runPromise(
    Effect.gen(function* () {
      const signals = yield* PubSub.unbounded<{
        transcript: true;
        native: import("../../src/opencode/agui/native-state.ts").NativeEventEnvelope;
      }>();
      const scope = yield* Scope.make();
      const backend = Object.assign(source, {
        nativeEvent: (
          event: import("../../src/opencode/agui/native-state.ts").NativeEventEnvelope,
        ) => native.apply(event),
        nativeSnapshot: () => native.current(),
        observe: () =>
          Effect.sync(() => {
            reads++;
            return source.value;
          }),
        changes: Stream.fromPubSub(signals).pipe(
          Stream.onStart(
            Effect.sync(() => {
              subscriptions++;
            }),
          ),
          Stream.ensuring(
            Effect.sync(() => {
              closed++;
            }),
          ),
        ),
      });
      const feed = yield* WorkspaceFeed.make(backend).pipe(
        Effect.provideService(Scope.Scope, scope),
      );
      const runner = new AbraRunner(backend, feed);
      const first: import("@ag-ui/core").BaseEvent[] = [],
        second: import("@ag-ui/core").BaseEvent[] = [];
      const connection = runner.connect({ threadId: backend.sessionID, agentId: "abra" });
      const a = connection.subscribe((event) => first.push(event));
      yield* TestClock.adjust("0 millis");
      const b = connection.subscribe((event) => second.push(event));
      yield* TestClock.adjust("0 millis");
      for (const events of [first, second]) {
        assert.ok(events.some((event) => event.type === EventType.MESSAGES_SNAPSHOT));
        assert.ok(events.some((event) => event.type === EventType.STATE_SNAPSHOT));
      }
      let seq = 0;
      const push = (type: string, data: object, ephemeral = false) =>
        PubSub.publish(signals, {
          transcript: true,
          native: {
            type,
            id: `evt_shared-${++seq}`,
            created: seq,
            ...(ephemeral
              ? {}
              : {
                  durable: {
                    aggregateID: backend.sessionID,
                    seq: type === "session.step.started" ? 1 : 2,
                    version: 1,
                  },
                }),
            data: { sessionID: backend.sessionID, ...data },
          },
        }).pipe(Effect.andThen(TestClock.adjust("0 millis")));
      yield* push("session.step.started", {
        assistantMessageID: "msg_streaming",
        agent: "abra",
        model: { providerID: "fixture", id: "fixture" },
        started: 1,
      });
      yield* push("session.tool.input.started", {
        assistantMessageID: "msg_streaming",
        id: "shared-call",
        name: "read_source",
      });
      yield* push(
        "session.tool.input.delta",
        { assistantMessageID: "msg_streaming", id: "shared-call", delta: '{"path":' },
        true,
      );
      assert.equal(subscriptions, 1);
      assert.ok(first.some((event) => event.type === EventType.TOOL_CALL_ARGS));
      assert.ok(second.some((event) => event.type === EventType.TOOL_CALL_ARGS));
      a.unsubscribe();
      yield* TestClock.adjust("0 millis");
      const count = first.length;
      yield* push(
        "session.tool.input.delta",
        { assistantMessageID: "msg_streaming", id: "shared-call", delta: '"source.ts"}' },
        true,
      );
      assert.equal(first.length, count);
      assert.ok(second.length > count);
      b.unsubscribe();
      yield* TestClock.adjust("0 millis");
      yield* Scope.close(scope, Exit.void);
      const before = reads;
      yield* TestClock.adjust("10 seconds");
      assert.equal(reads, before);
      assert.equal(subscriptions, 1);
      assert.equal(closed, 1);
    }).pipe(Effect.provide(TestClock.layer())),
  );
  assert.equal(source.stops, 0);
  assert.equal(source.submissions, 0);
});

test("generated views, reviews and artifacts publish lightweight activities tied to their producing call", async () => {
  const source = new WorkspaceFixture();
  const at = source.value.at;
  const common = {
    session_id: source.sessionID,
    message_id: MessageId.make("msg_origin"),
    source: "tool" as const,
    tool_call_id: "call_origin",
  };
  const revision = ContentHash.make("a".repeat(64));
  const entries = [
    {
      ...common,
      target: { kind: "surface" as const, surface_id: Identifier.make("view"), revision: 2 },
    },
    {
      ...common,
      target: { kind: "review" as const, review_id: Identifier.make("review"), revision: 1 },
    },
    {
      ...common,
      target: {
        kind: "artifact" as const,
        issue_id: IssueId.make("issue"),
        request_id: RequestId.make("report"),
        hash: revision,
      },
    },
  ];
  const snapshot = { ...source.value, presentations: { entries, truncated: false } };
  const runner = new AbraRunner(source, {
    notify: () => Effect.void,
    updates: Stream.succeed({
      type: "snapshot",
      snapshot,
      native: {
        messages: [{ id: "msg_origin", role: "assistant", at, text: "Unique native transcript" }],
        busy: false,
        inbox: [],
      },
    }),
  });
  const events = await lastValueFrom(
    runner.connect({ threadId: source.sessionID, agentId: "abra" }).pipe(toArray()),
  );
  const activities = events
    .map((e) => EventSchema.parse(e))
    .filter((e) => e.type === EventType.ACTIVITY_SNAPSHOT);
  assert.deepEqual(
    activities.map((e) => e.activityType),
    ["abracode.surface", "abracode.review", "abracode.artifact"],
  );
  assert.deepEqual(
    activities.map((e) => e.content),
    [
      { surface_id: "view", revision: 2, tool_call_id: "call_origin" },
      { surface_id: "review", revision: 1, tool_call_id: "call_origin" },
      { surface_id: "report", revision, tool_call_id: "call_origin" },
    ],
  );
  assert.equal(new Set(activities.map((e) => e.messageId)).size, 3);
  assert.equal(JSON.stringify(events).split("Unique native transcript").length - 1, 1);
});

test("state survives a native token burst and the last disconnect suspends fallback reads", async () => {
  const source = new WorkspaceFixture();
  let reads = 0;
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const signals = yield* PubSub.unbounded<{ native: { type: string } }>();
        const stalled = yield* Deferred.make<void>();
        let tokens = 0;
        const backend = Object.assign(source, {
          observe: () =>
            source.snapshot.pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  reads++;
                }),
              ),
            ),
          changes: Stream.fromPubSub(signals),
          nativeEvent: () => ({
            view: {
              ...source.nativeSnapshot(),
              messages: [
                {
                  id: "msg_burst",
                  role: "assistant" as const,
                  text: String(++tokens),
                  at: source.value.at,
                },
              ],
            },
          }),
        });
        const feed = yield* WorkspaceFeed.make(backend);
        yield* TestClock.adjust("15 seconds");
        assert.equal(reads, 0);
        const observed: Stream.Success<typeof feed.updates>[] = [];
        const observer = yield* feed.updates.pipe(
          Stream.runForEach((event) =>
            Effect.gen(function* () {
              observed.push(event);
              if (observed.length === 1) yield* Deferred.await(stalled);
            }),
          ),
          Effect.forkScoped,
        );
        yield* TestClock.adjust("0 millis");
        source.value = { ...source.value, model: "changed-model" };
        yield* feed.notify({ transcript: true });
        yield* TestClock.adjust("200 millis");
        for (let i = 0; i < 256; i++) yield* PubSub.publish(signals, { native: { type: "token" } });
        yield* TestClock.adjust("0 millis");
        yield* Deferred.succeed(stalled, undefined);
        yield* TestClock.adjust("0 millis");
        assert.ok(
          observed.some((e) => e.type === "snapshot" && e.snapshot.model === "changed-model"),
        );
        assert.ok(
          observed.some(
            (e) =>
              e.type === "snapshot" &&
              e.snapshot.observation?.baseline &&
              e.native.messages[0]?.text === "256",
          ),
          "A slow observer recovers the latest transcript and workspace in one baseline",
        );
        yield* Fiber.interrupt(observer);
        const before = reads;
        yield* TestClock.adjust("15 seconds");
        assert.equal(reads, before);
        const baseline = yield* Stream.runHead(feed.updates);
        assert.ok(
          baseline._tag === "Some" &&
            baseline.value.type === "snapshot" &&
            baseline.value.native.messages[0].text === "256",
        );
      }),
    ).pipe(Effect.provide(TestClock.layer())),
  );
});
