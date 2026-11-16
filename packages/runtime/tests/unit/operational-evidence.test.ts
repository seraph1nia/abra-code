import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { safeEvidence } from "../operational/evidence.ts";
test("operational evidence omits native payloads even inside encoded tool receipts", () => {
  const value = {
    id: "request-1",
    attempts: 1,
    prompt: "private instruction",
    nested: [
      {
        body: "private request",
        content: "raw provider response",
        input: { token: "secret" },
        hash: "abc",
      },
      JSON.stringify({ prompt: "encoded instruction", apiKey: "credential", status: "admitted" }),
    ],
    summary: "x".repeat(10000),
  };
  const redacted = safeEvidence(value) as {
    id: string;
    attempts: number;
    nested: unknown[];
    summary: string;
  };
  assert.deepEqual(redacted.nested, [{ hash: "abc" }, { status: "admitted" }]);
  assert.equal(redacted.id, value.id);
  assert.equal(redacted.attempts, 1);
  assert.equal(redacted.summary.length, 8192);
  assert.doesNotMatch(
    JSON.stringify(redacted),
    /private|secret|credential|encoded instruction|raw provider/,
  );
});
