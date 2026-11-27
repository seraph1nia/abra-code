import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { Effect, Deferred, Fiber, Exit, Schema, Scope, Stream } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { HttpApiClient } from "effect/http-api";
import { AbstractAgent } from "@ag-ui/client";
import { EventType, type Event } from "@ag-ui/core";
import { from, lastValueFrom, toArray } from "rxjs";
import { SessionMessage } from "@opencode/schema/session-message";
import { SessionEvent } from "@opencode/schema/session-event";
import { IssueId, SessionId, WebSubmissionId } from "@abracode/contracts/identities";
import { workspaceApi } from "@abracode/contracts/web/http-api";
import { NativeMessageCursor } from "@abracode/contracts/web/transcript";
import { WorkspaceStateJson } from "@abracode/contracts/web/workspace-wire";
import { NativeAgentAdapter, jsonPatch } from "../../src/opencode/agui/adapter.ts";
import {
  NativeSessionProjection,
  trustedSessionEvent,
} from "../../src/opencode/agui/native-state.ts";
import { NativeSessionReader, type AuthorizedConnection } from "../../src/opencode/agui/source.ts";
import { nativeChangeScope } from "../../src/web/change-scopes.ts";
import { AbraRunner } from "../../src/web/agent.ts";
import { workspaceServer } from "../../src/web/server.ts";
import { WorkspaceFixture } from "../helpers/web.ts";

class Consumer extends AbstractAgent {
  constructor(private events: Event[]) {
    super({ threadId: "ses_wave3" });
  }
  run() {
    return from(this.events);
  }
}

test("state patches add and remove optional fields using their JSON wire presence", async () => {
  const source = new WorkspaceFixture();
  const native = { busy: false, messages: [], inbox: [] };
  const adapter = new NativeAgentAdapter({
    sessionID: source.sessionID,
    current: Effect.succeed({ busy: false }),
    stop: Effect.succeed(false),
    submit: () => Effect.die("unexpected admission"),
    receipt: () => Effect.succeed(null),
    notifyAdmission: Effect.void,
    updates: Stream.fromIterable(
      [undefined, true, undefined].map((attention, sequence) => ({
        type: "snapshot" as const,
        native,
        order: { epoch: "test", sequence, baseline: sequence === 0 },
        state: () => ({ changes: { attention } }),
      })),
    ),
  });
  const events = await lastValueFrom(adapter.connect(source.sessionID).pipe(toArray()));
  assert.deepEqual(
    events.filter((e) => e.type === EventType.STATE_DELTA).map((e) => e.delta),
    [
      [{ op: "add", path: "/changes/attention", value: true }],
      [{ op: "remove", path: "/changes/attention" }],
    ],
  );
});

test("NativeMessageCursor emits one TEXT_MESSAGE_START, multiple TEXT_MESSAGE_CONTENT deltas, and one TEXT_MESSAGE_END", async () => {
  const cursor = new NativeMessageCursor();
  const base = { id: "msg_stream", role: "assistant" as const, at: "2026-11-24T00:00:00Z" };
  const emitted: Event[] = [
    { type: EventType.RUN_STARTED, threadId: "ses_wave3", runId: "text-stream" },
    ...cursor.update([], true),
  ];

  const chunk1 = cursor.update([{ ...base, text: "Hello" }]);
  const chunk2 = cursor.update([{ ...base, text: "Hello, " }]);
  const chunk3 = cursor.update([{ ...base, text: "Hello, world" }]);
  const chunk4 = cursor.update([{ ...base, text: "Hello, world!" }]);
  const ended = cursor.update([{ ...base, text: "Hello, world!" }]);

  assert.deepEqual(
    chunk1.map((e) => e.type),
    [EventType.TEXT_MESSAGE_START, EventType.TEXT_MESSAGE_CONTENT],
  );
  assert.deepEqual(
    chunk2.map((e) => e.type),
    [EventType.TEXT_MESSAGE_CONTENT],
  );
  assert.deepEqual(
    chunk3.map((e) => e.type),
    [EventType.TEXT_MESSAGE_CONTENT],
  );
  assert.deepEqual(
    chunk4.map((e) => e.type),
    [EventType.TEXT_MESSAGE_CONTENT],
  );
  assert.deepEqual(
    ended.map((e) => e.type),
    [EventType.TEXT_MESSAGE_END],
  );

  emitted.push(...chunk1, ...chunk2, ...chunk3, ...chunk4, ...ended, {
    type: EventType.RUN_FINISHED,
    threadId: "ses_wave3",
    runId: "text-stream",
  });
  assert.equal(emitted.filter((e) => e.type === EventType.TEXT_MESSAGE_START).length, 1);
  assert.equal(emitted.filter((e) => e.type === EventType.TEXT_MESSAGE_CONTENT).length, 4);
  assert.equal(emitted.filter((e) => e.type === EventType.TEXT_MESSAGE_END).length, 1);

  const consumer = new Consumer(emitted);
  await consumer.runAgent();
  assert.equal(consumer.messages.length, 1);
  assert.equal(consumer.messages[0]?.content, "Hello, world!");
});

test("NativeMessageCursor avoids MESSAGES_SNAPSHOT on streaming-to-running tool transition", () => {
  const cursor = new NativeMessageCursor();
  const base = { id: "msg_tool", role: "assistant" as const, text: "", at: "2026-11-24T00:00:00Z" };
  cursor.update([], true);
  const start = cursor.update([
    {
      ...base,
      tools: [{ id: "call_1", name: "read_file", status: "streaming", input: '{"a":1}' }],
    },
  ]);
  const running = cursor.update([
    {
      ...base,
      tools: [{ id: "call_1", name: "read_file", status: "running", input: '{"a":1}' }],
    },
  ]);
  assert.ok(start.some((e) => e.type === EventType.TOOL_CALL_START));
  assert.deepEqual(
    running.map((e) => e.type),
    [EventType.TOOL_CALL_END],
  );
});

test("STATE_DELTA emits fine-grained RFC 6902 sub-path patches instead of replacing /workspace", async () => {
  const source = new WorkspaceFixture();
  const first = {
    ...source.value,
    busy: false,
    observation: { epoch: "ep1", sequence: 1, baseline: true, changes: { all: true } },
  };
  const second = {
    ...first,
    busy: true,
    work: {
      ...first.work,
      work: [{ ...first.work.work[0]!, title: "Updated title" }],
    },
    observation: { epoch: "ep1", sequence: 2, baseline: false, changes: { work_all: true } },
  };

  const directDelta = jsonPatch({ workspace: first }, { workspace: second });
  assert.ok(directDelta.some((op) => op.path === "/workspace/busy" && op.op === "replace"));
  assert.ok(
    directDelta.some((op) => op.path === "/workspace/work/work/0/title" && op.op === "replace"),
  );
  assert.equal(
    directDelta.some((op) => op.path === "/workspace"),
    false,
    "Must never replace the entire /workspace blob on a section update",
  );

  const runner = new AbraRunner(source, {
    notify: () => Effect.void,
    updates: Stream.fromIterable([
      { type: "snapshot" as const, snapshot: first, native: first },
      { type: "snapshot" as const, snapshot: second, native: second },
    ]),
  });
  const events = await lastValueFrom(
    runner.connect({ threadId: source.sessionID, agentId: "abra" }).pipe(toArray()),
  );
  const stateDelta = events.find((e) => e.type === EventType.STATE_DELTA);
  assert.ok(stateDelta && "delta" in stateDelta);
  const paths = (stateDelta.delta as { path: string }[]).map((op) => op.path);
  assert.ok(paths.includes("/workspace/busy"), `Expected /workspace/busy in ${paths.join(", ")}`);
  assert.ok(
    paths.some((p) => p.startsWith("/workspace/work")),
    `Expected /workspace/work* in ${paths.join(", ")}`,
  );
  assert.equal(paths.includes("/workspace"), false);

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
  const decoded = Schema.decodeUnknownSync(WorkspaceStateJson)(observer.state);
  assert.equal(decoded.workspace.busy, true);
  assert.equal(decoded.workspace.work.work[0]?.title, "Updated title");
});

test("nativeChangeScope skips transcript refresh for live incremental streaming events", () => {
  const issue = IssueId.make("abra-worker");
  const read = (type: string, sessionID = "ses_abra") =>
    nativeChangeScope(
      { type, data: { sessionID }, location: { directory: "/home/central" } },
      "/home/central",
      "ses_abra",
      (id) => (id === "ses_worker" ? issue : undefined),
    );

  for (const streamingType of [
    "session.text.started",
    "session.text.delta",
    "session.text.ended",
    "session.tool.input.started",
    "session.tool.input.delta",
    "session.tool.input.ended",
    "session.tool.called",
    "session.step.started",
    "session.step.ended",
  ]) {
    assert.equal(read(streamingType), undefined, `${streamingType} should not trigger poll`);
  }

  for (const structuralType of [
    "session.execution.started",
    "session.execution.succeeded",
    "session.tool.success",
    "session.tool.failed",
  ]) {
    assert.deepEqual(read(structuralType), { transcript: true });
  }
  assert.deepEqual(read("session.inbox.enqueued"), { admissions: true, transcript: true });
  assert.deepEqual(read("session.text.delta", "ses_worker"), { sessions: ["ses_worker"] });
});

test("NativeSessionProjection memoizes unchanged messages and accepts pre-decoded events", () => {
  let presenterCalls = 0;
  const projection = new NativeSessionProjection("ses_memo", () => {
    presenterCalls++;
    return undefined;
  });
  const historical = Array.from({ length: 10 }, (_, index) =>
    Schema.decodeSync(SessionMessage.Assistant)({
      id: `msg_old_${index}`,
      type: "assistant",
      agent: "abra",
      model: { providerID: "fixture", id: "fixture" },
      time: { created: index + 1, completed: index + 2 },
      content: [
        {
          type: "tool",
          id: `call_${index}`,
          name: "read_source",
          time: { created: index + 1, completed: index + 2 },
          state: {
            status: "completed",
            input: { path: `file_${index}.ts` },
            content: [{ type: "text", text: "ok" }],
          },
        },
      ],
    }),
  );
  projection.baseline(historical, true, []);
  assert.equal(presenterCalls, 10);

  const stepStarted = Schema.decodeSync(SessionEvent.All)({
    id: "evt_1",
    type: "session.step.started",
    created: 100,
    durable: { aggregateID: "ses_memo", seq: 1, version: 1 },
    data: {
      sessionID: "ses_memo",
      assistantMessageID: "msg_live",
      agent: "abra",
      model: { providerID: "fixture", id: "fixture" },
      started: 100,
    },
  });
  const textStarted = Schema.decodeSync(SessionEvent.All)({
    id: "evt_2",
    type: "session.text.started",
    created: 101,
    durable: { aggregateID: "ses_memo", seq: 2, version: 1 },
    data: { sessionID: "ses_memo", assistantMessageID: "msg_live", ordinal: 0 },
  });
  const textDelta = Schema.decodeSync(SessionEvent.All)({
    id: "evt_3",
    type: "session.text.delta",
    created: 102,
    data: { sessionID: "ses_memo", assistantMessageID: "msg_live", ordinal: 0, delta: "Token" },
  });

  projection.apply(trustedSessionEvent(stepStarted));
  projection.apply(trustedSessionEvent(textStarted));
  const result = projection.apply(trustedSessionEvent(textDelta));
  assert.equal(
    presenterCalls,
    10,
    "Unchanged historical messages must not be re-projected on delta",
  );
  assert.equal(result.view?.messages.at(-1)?.text, "Token");
});

test("NativeAgentAdapter closes open streaming text message before RUN_FINISHED", async () => {
  const base = { id: "msg_open", role: "assistant" as const, at: "2026-11-24T00:00:00Z" };
  const adapter = new NativeAgentAdapter({
    sessionID: "ses_close",
    current: Effect.succeed({ busy: false }),
    submit: () => Effect.die("unused"),
    receipt: () => Effect.succeed(null),
    stop: Effect.succeed(true),
    notifyAdmission: Effect.void,
    updates: Stream.fromIterable([
      {
        type: "snapshot" as const,
        order: { epoch: "e1", sequence: 1, baseline: true },
        native: { busy: true, inbox: [], messages: [] },
      },
      {
        type: "snapshot" as const,
        order: { epoch: "e1", sequence: 2, baseline: false },
        native: { busy: true, inbox: [], messages: [{ ...base, text: "Streaming..." }] },
      },
    ]),
  });
  const events = await lastValueFrom(adapter.connect("ses_close").pipe(toArray()));
  const types = events.map((e) => e.type);
  assert.deepEqual(types, [
    EventType.RUN_STARTED,
    EventType.MESSAGES_SNAPSHOT,
    EventType.TEXT_MESSAGE_START,
    EventType.TEXT_MESSAGE_CONTENT,
    EventType.TEXT_MESSAGE_END,
    EventType.RUN_FINISHED,
  ]);
});

test("workspaceServer exposes /api/abra/submit, CopilotKit /stop/:threadId, unified reviews, and SPA fallback", async (t) => {
  const backend = new WorkspaceFixture();
  const scope = await Effect.runPromise(Scope.make());
  const web = await Effect.runPromise(
    workspaceServer({ port: 0, backend }).pipe(Effect.provideService(Scope.Scope, scope)),
  );
  t.onTestFinished(() => Effect.runPromise(Scope.close(scope, Exit.void)));

  const client = await Effect.runPromise(
    HttpApiClient.make(workspaceApi, {
      baseUrl: web.origin,
      transformClient: (c) =>
        HttpClient.mapRequest(c, HttpClientRequest.setHeader("origin", web.origin)),
    }).pipe(Effect.provide(FetchHttpClient.layer)),
  );

  const receipt = await Effect.runPromise(
    client.workspace.submit({
      payload: {
        request_id: WebSubmissionId.make("req-wave3-submit"),
        text: "Lightweight submit",
        delivery: "queue",
      },
    }),
  );
  assert.equal(receipt.request_id, "req-wave3-submit");
  assert.equal(receipt.status, "admitted");
  assert.equal(backend.submissions, 1);

  const wrongStop = await fetch(`${web.origin}/api/copilotkit/agent/abra/stop/ses_foreign`, {
    method: "POST",
    headers: { origin: web.origin, "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(wrongStop.status, 403);
  assert.equal(backend.stops, 0);

  const okStop = await fetch(`${web.origin}/api/copilotkit/agent/abra/stop/${backend.sessionID}`, {
    method: "POST",
    headers: { origin: web.origin, "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(okStop.status, 200);
  const stopJson = (await okStop.json()) as { stopped: boolean };
  assert.equal(stopJson.stopped, true);
  assert.equal(backend.stops, 1);

  assert.equal((await fetch(`${web.origin}/api/unknown-endpoint`)).status, 404);
  assert.equal((await fetch(`${web.origin}/assets/nested/missing.js`)).status, 404);
  const spaResponse = await fetch(`${web.origin}/settings/appearance`);
  assert.notEqual(spaResponse.status, 404);
});

test("a repair discovered while replaying events buffered behind a page read reaches the caller", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>(),
        release = yield* Deferred.make<void>();
      const connection = {
        session: { time: {} },
        client: {
          message: {
            list: () =>
              Deferred.succeed(entered, undefined).pipe(
                Effect.andThen(Deferred.await(release)),
                Effect.as({ data: [], cursor: {} }),
              ),
          },
        },
      } as unknown as AuthorizedConnection;
      const reader = new NativeSessionReader(SessionId.make("ses_repair"), () =>
        Effect.succeed(connection),
      );
      const fiber = yield* reader.read({ transcript: true }).pipe(Effect.forkChild);
      yield* Deferred.await(entered);
      assert.deepEqual(reader.apply({ type: "server.connected" }), {});
      yield* Deferred.succeed(release, undefined);
      assert.equal((yield* Fiber.join(fiber)).repair, true);
      assert.equal((yield* reader.read({ transcript: true })).repair, false);
    }),
  );
});
