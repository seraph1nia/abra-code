import { toolPresentation } from "../../src/web/tool-presentation.ts";
import { catalogId } from "../../src/web/catalog.ts";
import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { Schema } from "effect";
import { AbstractAgent } from "@ag-ui/client";
import { EventType, type Event } from "@ag-ui/core";
import { from } from "rxjs";
import { SessionMessage } from "@opencode/schema/session-message";
import { NativeSessionProjection } from "../../src/opencode/agui/native-state.ts";
import { NativeMessageCursor, nativeAguiMessages } from "../../src/web/transcript.ts";
import { projectNativeMessage } from "../../src/opencode/agui/messages.ts";

const user = Schema.decodeSync(SessionMessage.User)({
  id: "msg_input",
  type: "user",
  text: "Native request",
  time: { created: 0 },
});
function fixture() {
  const projection = new NativeSessionProjection("ses_native");
  projection.baseline([user], true, []);
  let seq = 0,
    id = 0;
  const event = (type: string, data = {}, ephemeral = false) => ({
    id: `evt_${++id}`,
    type,
    created: id,
    ...(ephemeral
      ? {}
      : {
          durable: {
            aggregateID: "ses_native",
            seq: ++seq,
            version: type === "session.tool.success" || type === "session.tool.failed" ? 2 : 1,
          },
        }),
    data: { sessionID: "ses_native", ...data },
  });
  const step = () =>
    event("session.step.started", {
      assistantMessageID: "msg_reply",
      agent: "abra",
      model: { providerID: "fixture", id: "fixture" },
      started: 1,
    });
  return { projection, event, step };
}
class Consumer extends AbstractAgent {
  constructor(private events: Event[]) {
    super({ threadId: "ses_native" });
  }
  run() {
    return from(this.events);
  }
}

test("native text and tool boundaries stream through the real AG-UI reducer with exact history parity", async () => {
  const f = fixture(),
    cursor = new NativeMessageCursor();
  const events: Event[] = [
    { type: EventType.RUN_STARTED, threadId: "ses_native", runId: "stream" },
    ...cursor.update(f.projection.current().messages, true),
  ];
  const assistantMessageID = "msg_reply",
    tool = { assistantMessageID, id: "call_native" };
  const steps = [
    f.step(),
    f.event("session.reasoning.started", { assistantMessageID, ordinal: 0 }),
    f.event(
      "session.reasoning.delta",
      { assistantMessageID, ordinal: 0, delta: "hidden-reasoning" },
      true,
    ),
    f.event("session.reasoning.ended", {
      assistantMessageID,
      ordinal: 0,
      text: "hidden-reasoning",
      native: { replay: "secret-provider" },
    }),
    f.event("session.text.started", { assistantMessageID, ordinal: 1 }),
    f.event("session.text.delta", { assistantMessageID, ordinal: 1, delta: "Before" }, true),
    f.event("session.text.ended", {
      assistantMessageID,
      ordinal: 1,
      text: "Before",
      native: { secret: "secret-provider" },
    }),
    f.event("session.tool.input.started", { ...tool, name: "read_source" }),
    f.event("session.tool.input.delta", { ...tool, delta: '{"path":' }, true),
    f.event("session.tool.input.delta", { ...tool, delta: '"source.ts"}' }, true),
    f.event("session.tool.input.ended", { ...tool, text: '{"path":"source.ts"}' }),
    f.event("session.tool.called", { ...tool, input: { path: "source.ts" }, executed: true }),
    f.event("session.tool.success", {
      ...tool,
      content: [{ type: "text", text: "Observed source" }],
      executed: true,
    }),
    f.event("session.text.started", { assistantMessageID, ordinal: 3 }),
    f.event("session.text.delta", { assistantMessageID, ordinal: 3, delta: "After" }, true),
    f.event("session.text.ended", { assistantMessageID, ordinal: 3, text: "After" }),
  ];
  for (const step of steps) {
    const result = f.projection.apply(step);
    assert.equal(result.repair, undefined);
    if (result.view) {
      events.push(...cursor.update(result.view.messages), {
        type: EventType.CUSTOM,
        name: "checkpoint",
        value: nativeAguiMessages(result.view.messages),
      });
    }
  }
  assert.ok(events.some((event) => event.type === EventType.TOOL_CALL_ARGS));
  assert.ok(events.some((event) => event.type === EventType.TOOL_CALL_END));
  assert.ok(events.some((event) => event.type === EventType.TOOL_CALL_RESULT));
  events.push({ type: EventType.RUN_FINISHED, threadId: "ses_native", runId: "stream" });
  const consumer = new Consumer(events);
  await consumer.runAgent(
    {},
    {
      onCustomEvent: ({ event, messages }) => {
        if (event.name === "checkpoint") assert.deepEqual(messages, event.value);
      },
    },
  );
  const history = Schema.decodeSync(SessionMessage.Assistant)({
    id: assistantMessageID,
    type: "assistant",
    agent: "abra",
    model: { providerID: "fixture", id: "fixture" },
    time: { created: 1 },
    content: [
      { type: "reasoning", text: "hidden-reasoning" },
      { type: "text", text: "Before" },
      {
        type: "tool",
        id: tool.id,
        name: "read_source",
        state: {
          status: "completed",
          input: { path: "source.ts" },
          content: [{ type: "text", text: "Observed source" }],
        },
        time: { created: 8, completed: 13 },
      },
      { type: "text", text: "After" },
    ],
  });
  assert.deepEqual(
    consumer.messages,
    nativeAguiMessages([projectNativeMessage(user)!, projectNativeMessage(history)!]),
  );
  assert.doesNotMatch(JSON.stringify(events), /hidden-reasoning|secret-provider/);
});

test("a baseline during text or arguments blocks ambiguous fragments and reconciles complete boundaries", async () => {
  const f = fixture();
  f.projection.apply(f.step());
  f.projection.apply(
    f.event("session.text.started", { assistantMessageID: "msg_reply", ordinal: 0 }),
  );
  f.projection.apply(
    f.event(
      "session.text.delta",
      { assistantMessageID: "msg_reply", ordinal: 0, delta: "Hello" },
      true,
    ),
  );
  const partial = Schema.decodeSync(SessionMessage.Assistant)({
    id: "msg_reply",
    type: "assistant",
    agent: "abra",
    model: { providerID: "fixture", id: "fixture" },
    time: { created: 1 },
    content: [{ type: "text", text: "Hello there" }],
  });
  f.projection.baseline([user, partial], true, []);
  const replayed = f.event(
    "session.text.delta",
    { assistantMessageID: "msg_reply", ordinal: 0, delta: " there" },
    true,
  );
  assert.equal(f.projection.apply(replayed).view, undefined);
  f.projection.apply(
    f.event("session.text.ended", {
      assistantMessageID: "msg_reply",
      ordinal: 0,
      text: "Hello there!",
    }),
  );
  assert.equal(f.projection.current().messages[1]!.text, "Hello there!");
  assert.equal(f.projection.apply(replayed).view, undefined);
  const gap = f.event("session.text.started", { assistantMessageID: "msg_reply", ordinal: 1 });
  gap.durable!.seq += 2;
  assert.equal(f.projection.apply(gap).repair, true);
  assert.equal(f.projection.apply(replayed).view, undefined);
});

test("routine retained reads preserve known live prefixes while reconnect baselines block ambiguous deltas", () => {
  const f = fixture();
  const assistantMessageID = "msg_reply",
    tool = { assistantMessageID, id: "call_refresh" };
  f.projection.apply(f.step());
  f.projection.apply(f.event("session.text.started", { assistantMessageID, ordinal: 0 }));
  f.projection.apply(
    f.event("session.text.delta", { assistantMessageID, ordinal: 0, delta: "Hello" }, true),
  );
  f.projection.apply(f.event("session.tool.input.started", { ...tool, name: "read_source" }));
  f.projection.apply(f.event("session.tool.input.delta", { ...tool, delta: '{"path":' }, true));
  const retained = Schema.decodeSync(SessionMessage.Assistant)({
    id: assistantMessageID,
    type: "assistant",
    agent: "abra",
    model: { providerID: "fixture", id: "fixture" },
    time: { created: 1 },
    content: [
      { type: "text", text: "" },
      {
        type: "tool",
        id: tool.id,
        name: "read_source",
        time: { created: 2 },
        state: { status: "streaming", input: "" },
      },
    ],
  });
  f.projection.baseline([user, retained], true, [], true);
  f.projection.apply(
    f.event("session.text.delta", { assistantMessageID, ordinal: 0, delta: " there" }, true),
  );
  f.projection.apply(f.event("session.tool.input.delta", { ...tool, delta: '"source"}' }, true));
  assert.equal(f.projection.current().messages[1]!.text, "Hello there");
  assert.equal(f.projection.current().messages[1]!.tools![0]!.input, '{"path":"source"}');
  f.projection.apply({ type: "server.connected" });
  f.projection.baseline([user, retained], true, [], true);
  assert.equal(
    f.projection.apply(
      f.event("session.text.delta", { assistantMessageID, ordinal: 0, delta: " there" }, true),
    ).view,
    undefined,
  );
  assert.equal(f.projection.current().messages[1]!.text, "Hello there");
});

test("oversized and malformed argument streams recover valid bounded calls without replay", async () => {
  const f = fixture(),
    cursor = new NativeMessageCursor(),
    events: Event[] = [
      { type: EventType.RUN_STARTED, threadId: "ses_native", runId: "limits" },
      ...cursor.update(f.projection.current().messages, true),
    ];
  const tool = { assistantMessageID: "msg_reply", id: "limited-call" };
  for (const step of [
    f.step(),
    f.event("session.tool.input.started", { ...tool, name: "read_source" }),
    f.event("session.tool.input.delta", { ...tool, delta: '{"broken":' }, true),
    f.event("session.tool.input.delta", { ...tool, delta: "x".repeat(8000) }, true),
    f.event("session.tool.called", { ...tool, input: { text: "x".repeat(9000) }, executed: true }),
    f.event("session.tool.failed", {
      ...tool,
      error: { type: "fixture", message: "Tool failed" },
      executed: true,
    }),
  ]) {
    const result = f.projection.apply(step);
    assert.equal(result.repair, undefined);
    if (result.view) events.push(...cursor.update(result.view.messages));
  }
  events.push({ type: EventType.RUN_FINISHED, threadId: "ses_native", runId: "limits" });
  const consumer = new Consumer(events);
  await consumer.runAgent();
  const call = consumer.messages.find(
    (message) => message.role === "assistant" && message.toolCalls?.length,
  );
  assert.ok(call?.role === "assistant" && call.toolCalls?.[0]);
  assert.deepEqual(JSON.parse(call.toolCalls[0].function.arguments), {});
  assert.equal(call.toolCalls[0].metadata?.abracode_limited, true);
  assert.equal(consumer.messages.find((message) => message.role === "tool")?.error, "Tool failed");
  assert.equal(
    f.projection.current().busy,
    true,
    "A failed tool does not terminate native execution",
  );
});

test("native terminal evidence groups delivered queue/steer inputs and excludes shutdown", () => {
  const f = fixture();
  f.projection.baseline([user], true, [{ id: "msg_queued" }]);
  f.projection.apply(f.event("session.execution.succeeded"));
  assert.deepEqual(f.projection.current().completions?.[0]!.inputs, [user.id]);
  assert.equal(f.projection.current().completions?.[0]!.inputs.includes("msg_queued"), false);
  f.projection.apply(f.event("session.execution.started"));
  f.projection.apply(f.event("session.inbox.delivered", { inboxID: "msg_queued" }));
  f.projection.apply(f.event("session.inbox.delivered", { inboxID: "msg_steered" }));
  f.projection.apply(
    f.event("session.execution.failed", {
      error: {
        type: "provider",
        message: "Known provider failure",
        response: { body: "hidden-provider-response" },
      },
    }),
  );
  const terminal = f.projection.current().completions!.at(-1)!;
  assert.deepEqual(terminal.inputs, ["msg_queued", "msg_steered"]);
  assert.equal(terminal.outcome, "failed");
  assert.equal(terminal.error, "Known provider failure");
  assert.doesNotMatch(JSON.stringify(f.projection.current()), /hidden-provider-response/);
  f.projection.apply(f.event("session.execution.started"));
  f.projection.apply(f.event("session.execution.interrupted", { reason: "shutdown" }));
  assert.equal(f.projection.current().busy, true);
  assert.equal(f.projection.current().completions!.length, 2);
});

test("mid-argument reconnect resets the real reducer cursor and resumes fresh text without duplicate results", async () => {
  const f = fixture(),
    cursor = new NativeMessageCursor();
  const events: Event[] = [
    { type: EventType.RUN_STARTED, threadId: "ses_native", runId: "recover" },
    ...cursor.update(f.projection.current().messages, true),
  ];
  const tool = { assistantMessageID: "msg_reply", id: "reconnect-call" };
  for (const event of [
    f.step(),
    f.event("session.tool.input.started", { ...tool, name: "read_source" }),
    f.event("session.tool.input.delta", { ...tool, delta: '{"path":' }, true),
  ]) {
    const view = f.projection.apply(event).view;
    if (view) events.push(...cursor.update(view.messages));
  }
  const partial = Schema.decodeSync(SessionMessage.Assistant)({
    id: "msg_reply",
    type: "assistant",
    agent: "abra",
    model: { providerID: "fixture", id: "fixture" },
    time: { created: 1 },
    content: [
      {
        type: "tool",
        id: tool.id,
        name: "read_source",
        time: { created: 2 },
        state: { status: "streaming", input: '{"path":"source' },
      },
    ],
  });
  f.projection.apply({ type: "server.connected" });
  f.projection.baseline([user, partial], true, []);
  events.push(...cursor.update(f.projection.current().messages, true));
  const ignored = f.event("session.tool.input.delta", { ...tool, delta: "source" }, true);
  assert.equal(f.projection.apply(ignored).view, undefined);
  for (const event of [
    f.event("session.tool.input.ended", { ...tool, text: '{"path":"source.ts"}' }),
    f.event("session.tool.called", { ...tool, input: { path: "source.ts" }, executed: true }),
    f.event("session.tool.success", {
      ...tool,
      content: [{ type: "text", text: "Result once" }],
      executed: true,
    }),
    f.event("session.text.started", { assistantMessageID: "msg_reply", ordinal: 1 }),
    f.event(
      "session.text.delta",
      { assistantMessageID: "msg_reply", ordinal: 1, delta: "Fresh after reconnect" },
      true,
    ),
    f.event("session.text.ended", {
      assistantMessageID: "msg_reply",
      ordinal: 1,
      text: "Fresh after reconnect",
    }),
  ]) {
    const view = f.projection.apply(event).view;
    if (view) events.push(...cursor.update(view.messages));
  }
  assert.equal(f.projection.apply(ignored).view, undefined);
  events.push({ type: EventType.RUN_FINISHED, threadId: "ses_native", runId: "recover" });
  const consumer = new Consumer(events);
  await consumer.runAgent();
  const call = consumer.messages.find(
    (message) => message.role === "assistant" && message.toolCalls?.length,
  );
  assert.ok(call?.role === "assistant" && call.toolCalls?.[0]);
  assert.deepEqual(JSON.parse(call.toolCalls[0].function.arguments), { path: "source.ts" });
  assert.equal(consumer.messages.filter((message) => message.role === "tool").length, 1);
  assert.equal(consumer.messages.at(-1)!.content, "Fresh after reconnect");
});

test("live and restarted native projections retain each exact A2UI revision under its producing call", () => {
  const f = fixture(),
    projection = new NativeSessionProjection("ses_native", toolPresentation);
  projection.baseline([user], true, []);
  const raw: SessionMessage.Info[] = [user];
  for (const revision of [1, 2]) {
    const assistantMessageID = `msg_surface-${revision}`,
      id = `surface-call-${revision}`;
    const input = {
      surface: {
        version: "1.0",
        createSurface: {
          surfaceId: "same-board",
          catalogId,
          components: [{ id: "root", component: "Text", text: `Revision ${revision}` }],
        },
      },
    };
    const content: SessionMessage.ToolStateCompleted["content"] = [
      {
        type: "text" as const,
        text: JSON.stringify({
          ok: true,
          result: { surface_id: "same-board", revision, version: "1.0" },
        }),
      },
    ];
    const events = [
      f.event("session.step.started", {
        assistantMessageID,
        agent: "abra",
        model: { providerID: "fixture", id: "fixture" },
        started: revision,
      }),
      f.event("session.tool.input.started", { assistantMessageID, id, name: "abra_render_ui" }),
      f.event("session.tool.called", { assistantMessageID, id, input, executed: true }),
      f.event("session.tool.success", { assistantMessageID, id, content, executed: true }),
    ];
    for (const event of events) assert.equal(projection.apply(event).repair, undefined);
    raw.push(
      Schema.decodeSync(SessionMessage.Assistant)({
        id: assistantMessageID,
        type: "assistant",
        agent: "abra",
        model: { providerID: "fixture", id: "fixture" },
        time: { created: events[0]!.created },
        content: [
          {
            type: "tool",
            id,
            name: "abra_render_ui",
            time: { created: events[1]!.created, completed: events[3]!.created },
            state: { status: "completed", input, content },
          },
        ],
      }),
    );
  }
  const live = nativeAguiMessages(projection.current().messages);
  const references = live
    .filter((message) => message.role === "tool")
    .map((message) => {
      assert.equal(typeof message.content, "string");
      return JSON.parse(message.content as string);
    });
  assert.deepEqual(
    references.map((value) => value.revision),
    [1, 2],
  );
  assert.ok(
    references.every((value) => value.kind === "surface" && value.surface_id === "same-board"),
  );
  const restarted = new NativeSessionProjection("ses_native", toolPresentation);
  restarted.baseline(raw, false, []);
  assert.deepEqual(nativeAguiMessages(restarted.current().messages), live);
});

test("reused native call IDs never rewrite an older message's tool identity", async () => {
  const first = {
    id: "msg_old",
    role: "assistant" as const,
    text: "",
    at: "2026-11-16T00:00:00Z",
    tools: [
      {
        id: "call_0",
        name: "first_tool",
        status: "completed" as const,
        input: "{}",
        result: "First result",
      },
    ],
  };
  const second = {
    ...first,
    id: "msg_new",
    tools: [{ id: "call_0", name: "second_tool", status: "streaming" as const, input: '{"next":' }],
  };
  const cursor = new NativeMessageCursor();
  const baseline = cursor.update([first], true);
  const delta = cursor.update([first, second]);
  assert.ok(delta.every((event) => event.type === EventType.MESSAGES_SNAPSHOT));
  const current = {
    ...second,
    tools: [
      {
        ...second.tools[0]!,
        status: "completed" as const,
        input: '{"next":true}',
        result: "Second result",
      },
    ],
  };
  const events: Event[] = [
    { type: EventType.RUN_STARTED, threadId: "ses_native", runId: "reused" },
    ...baseline,
    ...delta,
    ...cursor.update([first, current]),
    { type: EventType.RUN_FINISHED, threadId: "ses_native", runId: "reused" },
  ];
  const consumer = new Consumer(events);
  await consumer.runAgent();
  assert.deepEqual(consumer.messages, nativeAguiMessages([first, current]));
  assert.equal(
    consumer.messages[0]!.role === "assistant" &&
      consumer.messages[0]!.toolCalls?.[0]!.function.name,
    "first_tool",
  );
});
