import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { Effect } from "effect";
import { CrewError } from "../../src/domain.ts";
import { nativeRpcError, readWorkReport } from "../../src/web/native-errors.ts";

test("native RPC failures retain domain codes instead of becoming UNEXPECTED", () => {
  for (const [type, code] of [
    ["resource_unavailable", "REPORT_REQUIRED"],
    ["not_found", "EXECUTION_MISSING"],
    ["invalid_selection", "DOCUMENT_PATH"],
    ["refused", "REVIEW_STALE"],
  ]) {
    const failure = nativeRpcError({ type, message: "Retained explanation", data: { code } });
    assert.equal(failure.code, code);
    assert.equal(failure.message, "Retained explanation");
  }
  const original = new CrewError("WEB_SERVICE", "Service unavailable");
  assert.equal(nativeRpcError(original), original);
  assert.equal(
    nativeRpcError({ type: "rpc.method_not_found", message: "Unknown RPC method" }).code,
    "WEB_NATIVE_UPDATE_REQUIRED",
  );
  for (const cause of [
    { type: "unrelated", message: "Other error", data: { code: "REPORT_REQUIRED" } },
    { type: "rpc.invalid_output", message: "Invalid output", data: { code: "REPORT_REQUIRED" } },
    { type: "not_found", message: "Invalid data", data: { code: 42 } },
  ])
    assert.equal(nativeRpcError(cause).code, "UNEXPECTED");
});

test("report absence is distinct from an unknown task, damaged evidence and failed reads", async () => {
  let confirmations = 0;
  const confirm = Effect.sync(() => confirmations++);
  const read = (code: string, confirmation: Effect.Effect<unknown, CrewError> = confirm) =>
    readWorkReport(
      Effect.fail(
        nativeRpcError({
          type: code === "EXECUTION_MISSING" ? "not_found" : "resource_unavailable",
          message: "Native report read failed",
          data: { code },
        }),
      ),
      confirmation,
    );
  assert.deepEqual(await Effect.runPromise(read("REPORT_REQUIRED")), {
    unavailable: "not_published",
  });
  assert.equal(confirmations, 0);
  assert.deepEqual(await Effect.runPromise(read("EXECUTION_MISSING")), {
    unavailable: "not_started",
  });
  assert.equal(confirmations, 1);
  const missing = await Effect.runPromise(
    read("EXECUTION_MISSING", Effect.fail(new CrewError("ISSUE_MISSING", "Unknown task"))).pipe(
      Effect.result,
    ),
  );
  assert.equal(missing._tag, "Failure");
  if (missing._tag === "Failure") assert.equal(missing.failure.code, "ISSUE_MISSING");
  for (const code of ["REPORT_TAMPERED", "REPORT_PATH", "REPORT_IDENTITY", "WEB_SERVICE"]) {
    const result = await Effect.runPromise(read(code).pipe(Effect.result));
    assert.equal(result._tag, "Failure");
    if (result._tag === "Failure") assert.equal(result.failure.code, code);
  }
  assert.deepEqual(
    await Effect.runPromise(readWorkReport(Effect.succeed({ content: "# Published" }), confirm)),
    { content: "# Published" },
  );
  assert.equal(confirmations, 1);
});
