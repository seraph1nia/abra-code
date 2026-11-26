import { validateSurface } from "@abracode/contracts/web/surfaces";
import { catalogId } from "@abracode/contracts/web/catalog";
import { presentationHash } from "../../src/presentation/identity.ts";
import { NativeSessionProjection } from "../../src/opencode/agui/native-state.ts";
import { SessionMessage } from "@opencode/schema/session-message";
import { projectNativeMessage } from "../../src/opencode/agui/messages.ts";
import { HttpAgent } from "@ag-ui/client";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { Effect, PubSub, Stream, Schema } from "effect";
import { ContentHash } from "@abracode/contracts/identities";
import { fixture } from "../helpers/workspace-http.ts";
test("CopilotKit v2 Fetch handler transports AG-UI and binds one native session", async (t) => {
  const web = await fixture();
  t.onTestFinished(web.close);
  const info = await (await fetch(`${web.origin}/api/copilotkit/info`)).json();
  assert.equal(info.telemetryDisabled, true);
  assert.equal(info.a2uiEnabled, false);
  const headers = {
    origin: web.origin,
    "content-type": "application/json",
    accept: "text/event-stream",
  };
  const input = {
    threadId: web.backend.sessionID,
    runId: "run-fixture",
    messages: [{ id: "ui-1", role: "user", content: "Build a work view" }],
    tools: [],
    context: [],
    state: { workspace: { busy: false, session_id: "ignored" } },
    forwardedProps: { request_id: "stable-fixture" },
  };
  const wrong = await fetch(`${web.origin}/api/copilotkit/agent/abra/run`, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...input, threadId: "ses_worker" }),
  });
  assert.equal(wrong.status, 403);
  assert.equal(web.backend.submissions, 0);
  const response = await fetch(`${web.origin}/api/copilotkit/agent/abra/run`, {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  });
  assert.equal(response.status, 200);
  const events = await response.text();
  assert.match(events, /RUN_STARTED/);
  assert.match(events, /MESSAGES_SNAPSHOT/);
  assert.match(events, /RUN_FINISHED/);
  assert.equal(web.backend.submissions, 1);
  const retry = await fetch(`${web.origin}/api/copilotkit/agent/abra/run`, {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  });
  await retry.text();
  assert.equal(web.backend.submissions, 1);
});

test("standard AG-UI client runs, retries and detaches from the hosted native adapter", async (t) => {
  const web = await fixture();
  t.onTestFinished(web.close);
  const run = () =>
    new HttpAgent({
      url: `${web.origin}/api/copilotkit/agent/abra/run`,
      headers: { origin: web.origin },
      agentId: "abra",
      threadId: web.backend.sessionID,
      initialMessages: [{ id: "standard-input", role: "user", content: "Standard consumer input" }],
    });
  const first = run();
  await first.runAgent({
    tools: [],
    context: [],
    forwardedProps: { request_id: "standard-consumer" },
  });
  assert.equal(first.messages.filter((message) => message.role === "assistant").length, 1);
  const retry = run();
  await retry.runAgent({
    tools: [],
    context: [],
    forwardedProps: { request_id: "standard-consumer" },
  });
  assert.equal(web.backend.submissions, 1);
  const observe = new HttpAgent({
    url: `${web.origin}/api/copilotkit/agent/abra/connect`,
    headers: { origin: web.origin },
    agentId: "abra",
    threadId: web.backend.sessionID,
  });
  let baseline = false;
  await observe.runAgent(
    {},
    {
      onMessagesSnapshotEvent: () => {
        baseline = true;
        void observe.detachActiveRun();
      },
    },
  );
  assert.equal(baseline, true);
  assert.equal(web.backend.stops, 0);
  assert.equal(web.backend.submissions, 1);
});

test("HTTP observers reconnect during tool arguments without replay or duplicated arguments/results", async (t) => {
  const signals = await Effect.runPromise(
    PubSub.unbounded<{
      transcript: true;
      native: import("../../src/opencode/agui/native-state.ts").NativeEventEnvelope;
    }>(),
  );
  t.onTestFinished(() => Effect.runPromise(PubSub.shutdown(signals)));
  const projection = new NativeSessionProjection("ses_webfixture");
  const user = Schema.decodeSync(SessionMessage.User)({
    id: "msg_http-stream",
    type: "user",
    text: "Observe only",
    time: { created: 0 },
  });
  projection.baseline([user], true, []);
  let subscriptions = 0;
  const web = await fixture(undefined, (backend) => {
    backend.value = { ...backend.value, busy: true, messages: [projectNativeMessage(user)!] };
    Object.assign(backend, {
      nativeEvent: (event: import("../../src/opencode/agui/native-state.ts").NativeEventEnvelope) =>
        projection.apply(event),
      nativeSnapshot: () => projection.current(),
      changes: Stream.fromPubSub(signals).pipe(
        Stream.onStart(
          Effect.sync(() => {
            subscriptions++;
          }),
        ),
      ),
    });
  });
  t.onTestFinished(web.close);
  const observer = () =>
    new HttpAgent({
      url: `${web.origin}/api/copilotkit/agent/abra/connect`,
      headers: { origin: web.origin },
      agentId: "abra",
      threadId: web.backend.sessionID,
    });
  const wait = <T>(pending: Promise<T>, phase: string) =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`HTTP observation stalled at ${phase}`)),
        5000,
      );
      pending.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  const first = observer();
  let baseline!: () => void, fragment!: () => void;
  const ready = new Promise<void>((resolve) => {
    baseline = resolve;
  });
  const partial = new Promise<void>((resolve) => {
    fragment = resolve;
  });
  let parentSeen!: () => void, callSeen!: () => void;
  const parentReady = new Promise<void>((resolve) => {
    parentSeen = resolve;
  });
  const callReady = new Promise<void>((resolve) => {
    callSeen = resolve;
  });
  const observing = first.runAgent(
    {},
    {
      onMessagesSnapshotEvent: () => {
        baseline();
      },
      onTextMessageStartEvent: () => {
        parentSeen();
      },
      onToolCallStartEvent: () => {
        callSeen();
      },
      onToolCallArgsEvent: () => {
        fragment();
        void first.detachActiveRun();
      },
    },
  );
  t.onTestFinished(() => first.detachActiveRun());
  await wait(ready, "ready");
  let sequence = 0,
    counter = 0;
  const push = (type: string, data: object, ephemeral = false) =>
    Effect.runPromise(
      PubSub.publish(signals, {
        transcript: true,
        native: {
          id: `evt_http-${++counter}`,
          type,
          created: counter,
          ...(ephemeral
            ? {}
            : {
                durable: {
                  aggregateID: web.backend.sessionID,
                  seq: ++sequence,
                  version: type === "session.tool.success" ? 2 : 1,
                },
              }),
          data: { sessionID: web.backend.sessionID, ...data },
        },
      }),
    );
  const tool = { assistantMessageID: "msg_http-reply", id: "http-stream-call" };
  await push("session.step.started", {
    assistantMessageID: tool.assistantMessageID,
    agent: "abra",
    model: { providerID: "fixture", id: "fixture" },
    started: 1,
  });
  await wait(parentReady, "parentReady");
  await push("session.tool.input.started", { ...tool, name: "read_source" });
  await wait(callReady, "callReady");
  await push("session.tool.input.delta", { ...tool, delta: '{"path":' }, true);
  await wait(partial, "partial");
  await wait(observing, "observing");
  const second = observer();
  let resumed!: () => void, finished!: () => void;
  const restored = new Promise<void>((resolve) => {
    resumed = resolve;
  });
  const complete = new Promise<void>((resolve) => {
    finished = resolve;
  });
  const connected = second.runAgent(
    {},
    {
      onMessagesSnapshotEvent: ({ event }) => {
        const messages = event.messages;
        const result = messages.find((message) => message.role === "tool");
        const call = messages.find(
          (message) => message.role === "assistant" && message.toolCalls?.length,
        );
        if (call) resumed();
        if (
          result &&
          call?.role === "assistant" &&
          call.toolCalls?.[0]?.metadata?.abracode_native_status === "completed"
        ) {
          finished();
          void second.detachActiveRun();
        }
      },
    },
  );
  t.onTestFinished(() => second.detachActiveRun());
  await wait(restored, "restored");
  await push("session.tool.input.delta", { ...tool, delta: '"source.ts"}' }, true);
  await push("session.tool.input.ended", { ...tool, text: '{"path":"source.ts"}' });
  await push("session.tool.called", { ...tool, input: { path: "source.ts" }, executed: true });
  await push("session.tool.success", {
    ...tool,
    content: [{ type: "text", text: "HTTP result once" }],
    executed: true,
  });
  await wait(complete, "complete");
  await wait(connected, "connected");
  const call = second.messages.find(
    (message) => message.role === "assistant" && message.toolCalls?.length,
  );
  assert.ok(call?.role === "assistant" && call.toolCalls?.[0]);
  assert.deepEqual(JSON.parse(call.toolCalls[0].function.arguments), { path: "source.ts" });
  assert.equal(second.messages.filter((message) => message.role === "tool").length, 1);
  assert.equal(subscriptions, 1);
  assert.equal(web.backend.submissions, 0);
  assert.equal(web.backend.stops, 0);
});

test(
  "diagram preparation HTTP selects exact retained sources and refuses foreign, stale and executable selectors",
  { timeout: 60000 },
  async (t) => {
    const web = await fixture();
    t.onTestFinished(web.close);
    const surface = validateSurface({
      version: "1.0",
      createSurface: {
        surfaceId: "diagram-board",
        catalogId,
        components: [
          { id: "root", component: "Mermaid", title: "Observed", source: "flowchart LR\nA <--> B" },
        ],
      },
    });
    web.backend.value = {
      ...web.backend.value,
      surfaces: [
        {
          session_id: web.backend.sessionID,
          tool_call_id: "fixture",
          revision: 1,
          at: web.backend.value.at,
          surface,
          snapshot: [],
        },
      ],
    };
    for (const [owner, revision, available] of [
      [web.backend.sessionID, 1, true],
      ["ses_foreign", 1, false],
      [web.backend.sessionID, 2, false],
    ] as const) {
      const response = await fetch(
        web.origin +
          "/api/surface?" +
          new URLSearchParams({
            session_id: owner,
            revision: String(revision),
            surface_id: "diagram-board",
          }),
      );
      assert.equal(response.status, 200);
      const entry = await response.json();
      assert.equal("surface" in entry, available);
      if (available) assert.equal(entry.revision, revision);
    }
    const selection = {
      kind: "surface" as const,
      surface_id: "diagram-board",
      revision: 1,
      hash: presentationHash(surface),
    };
    const prepared = await Effect.runPromise(
      web.client.workspace.prepareDiagrams({ payload: selection }),
    );
    assert.equal(prepared.verified, true);
    assert.equal(prepared.assets[0]!.source, surface.createSurface.components[0]!.source);
    const second = await Effect.runPromise(
      web.client.workspace.prepareDiagrams({ payload: selection }),
    );
    assert.equal(second.metrics?.compilations, 0);
    for (const altered of [
      { ...selection, hash: ContentHash.make("a".repeat(64)) },
      { ...selection, revision: 2 },
      { ...selection, surface_id: "foreign" },
    ])
      assert.equal(
        (
          await Effect.runPromise(
            web.client.workspace.prepareDiagrams({ payload: altered }).pipe(Effect.result),
          )
        )._tag,
        "Failure",
      );
    const invalid = await fetch(`${web.origin}/api/diagrams/prepare`, {
      method: "POST",
      headers: { origin: web.origin, "content-type": "application/json" },
      body: JSON.stringify({ ...selection, path: "/etc/passwd" }),
    });
    assert.equal(invalid.status, 400);
    const foreign = await fetch(`${web.origin}/api/diagrams/prepare`, {
      method: "POST",
      headers: { origin: "https://foreign.invalid", "content-type": "application/json" },
      body: JSON.stringify(selection),
    });
    assert.equal(foreign.status, 403);
    assert.equal(web.backend.submissions, 0);
  },
);
