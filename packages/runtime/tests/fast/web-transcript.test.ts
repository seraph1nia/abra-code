import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { Schema } from "effect";
import { SessionMessage } from "@opencode/schema/session-message";
import { MessageSchema } from "@ag-ui/core/schemas";
import { projectMessage } from "../../src/web/backend.ts";
import { nativeAguiMessages, transcriptFromAgent } from "@abracode/contracts/web/transcript";
import { TranscriptMessageSchema } from "@abracode/contracts/web/workspace-wire";

const assistant = (state: unknown) =>
  Schema.decodeUnknownSync(SessionMessage.Assistant)({
    id: "msg_native",
    type: "assistant",
    agent: "abra",
    model: { providerID: "fixture", id: "fixture" },
    time: { created: 10 },
    metadata: { providerReplay: "hidden-replay" },
    content: [
      { type: "text", text: "Before the observation.", native: { secret: "hidden-replay" } },
      { type: "reasoning", text: "hidden-reasoning", native: { signature: "hidden-replay" } },
      {
        type: "tool",
        id: "call_native",
        name: "unknown_tool",
        state,
        native: { replay: "hidden-replay" },
        time: { created: 11 },
      },
      { type: "text", text: "After the observation." },
    ],
  });

test("native text/tool order and identities survive AG-UI projection without hidden provider material", () => {
  const native = assistant({
    status: "completed",
    input: { path: "source.ts" },
    content: [{ type: "text", text: "Observed source" }],
  });
  const message = projectMessage(native)!;
  assert.equal(Schema.is(TranscriptMessageSchema)(message), true);
  assert.deepEqual(
    message.parts?.map((part) => part.type),
    ["text", "tool", "text"],
  );
  const messages = nativeAguiMessages([message]);
  assert.deepEqual(
    messages.map((message) => message.role),
    ["assistant", "tool", "assistant"],
  );
  const [display] = transcriptFromAgent(messages);
  assert.deepEqual(display.parts, message.parts);
  assert.equal(display.at, message.at);
  assert.equal(display.tools?.[0].result, "Observed source");
  assert.equal(messages[0].id, native.id);
  assert.equal(messages[0].role === "assistant" && messages[0].toolCalls?.[0].id, "call_native");
  assert.equal(messages[1].role === "tool" && messages[1].toolCallId, "call_native");
  assert.equal(messages[2].metadata?.abracode_native_message_id, native.id);
  assert.equal(messages[0].content, "Before the observation.");
  assert.equal(messages[2].content, "After the observation.");
  messages.forEach((message) => MessageSchema.parse(message));
  assert.doesNotMatch(
    JSON.stringify({ message, messages }),
    /hidden-replay|hidden-reasoning|encryptedValue/,
  );
  assert.deepEqual(nativeAguiMessages([projectMessage(native)!]), messages);
});

test("streaming, running, failed and historical native calls retain their original call identity", () => {
  const states = [
    { status: "streaming", input: '{"path":' },
    { status: "running", input: { path: "source.ts" }, metadata: {} },
    {
      status: "error",
      input: { path: "source.ts" },
      error: {
        type: "fixture",
        message: "Could not read source",
        response: { body: "hidden-error-response" },
      },
    },
  ];
  for (const state of states) {
    const projected = projectMessage(assistant(state))!;
    assert.equal(projected.tools?.[0].id, "call_native");
    assert.equal(projected.tools?.[0].status, state.status);
    const messages = nativeAguiMessages([projected]);
    const call = messages[0].role === "assistant" ? messages[0].toolCalls?.[0] : undefined;
    assert.equal(call?.id, "call_native");
    assert.equal(call?.metadata?.abracode_native_status, state.status);
    if (state.status === "error") {
      assert.equal(messages[1].role === "tool" && messages[1].error, "Could not read source");
    } else
      assert.equal(
        messages.some((message) => message.role === "tool"),
        false,
      );
    messages.forEach((message) => MessageSchema.parse(message));
    assert.doesNotMatch(JSON.stringify(projected), /hidden-error-response/);
  }
});

test("unknown native tool payloads are bounded and preserve a concrete truncation indication", () => {
  const message = projectMessage(
    assistant({
      status: "completed",
      input: { text: "x".repeat(9000) },
      content: [{ type: "text", text: "y".repeat(18000) }],
    }),
  )!;
  assert.equal(message.tools?.[0].input?.length, 4096);
  assert.equal(message.tools?.[0].result?.length, 8192);
  assert.equal(message.tools?.[0].limited, true);
  assert.equal(message.tools?.[0].presentation, undefined);
  const call = nativeAguiMessages([message])[0]!;
  assert.ok(call.role === "assistant" && call.toolCalls?.[0]);
  assert.deepEqual(JSON.parse(call.toolCalls[0].function.arguments), {});
  assert.equal(call.toolCalls[0].metadata?.abracode_arguments_unavailable, true);
});
