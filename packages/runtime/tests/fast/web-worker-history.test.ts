import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { Schema } from "effect";
import {
  workerHistoryMessage,
  WorkerHistoryPageSchema,
} from "@abracode/contracts/web/worker-history";
import { SessionId, Timestamp } from "@abracode/contracts/identities";
import type { TranscriptMessage } from "../../src/web/contracts.ts";

test("worker history preserves message/tool identities and ordering with explicit UTF-8 excerpt bounds", () => {
  const original: TranscriptMessage = {
    id: "msg_worker",
    role: "assistant",
    at: "2026-11-16T00:00:00Z",
    text: "Before.After.",
    parts: [
      { type: "text", text: "Before." },
      { type: "tool", tool_id: "call_worker" },
      { type: "text", text: "After." },
    ],
    tools: [
      {
        id: "call_worker",
        name: "check",
        status: "error",
        input: "é".repeat(3000),
        result: "日".repeat(3000),
      },
    ],
  };
  const bounded = workerHistoryMessage(original);
  assert.deepEqual(bounded.parts, original.parts);
  assert.equal(bounded.id, original.id);
  assert.equal(bounded.tools?.[0].id, "call_worker");
  assert.equal(bounded.tools?.[0].status, "error");
  assert.ok(new TextEncoder().encode(bounded.tools![0].input!).length <= 1024);
  assert.ok(new TextEncoder().encode(bounded.tools![0].result!).length <= 2048);
  assert.ok(!bounded.tools![0].result!.includes("�"));
  assert.ok(bounded.limited);
  const long = workerHistoryMessage({ ...original, text: "😀".repeat(9000), parts: undefined });
  assert.ok(new TextEncoder().encode(long.text).length <= 8192);
  assert.ok(long.limited);
  const page = {
    session_id: SessionId.make("ses_worker"),
    observed_at: Timestamp.make(original.at),
    messages: Array(8).fill(long),
  };
  assert.ok(Schema.is(WorkerHistoryPageSchema)(page));
  assert.equal(
    Schema.is(WorkerHistoryPageSchema)({ ...page, messages: Array(9).fill(long) }),
    false,
  );
  assert.equal(original.tools![0].input!.length, 3000);
});
