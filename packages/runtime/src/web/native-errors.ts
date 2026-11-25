import { Effect, Result, Schema } from "effect";
import { ErrorCode } from "@abracode/contracts/identities";
import { CrewError } from "../domain.ts";
import type { WorkReportSchema } from "@abracode/contracts/web/wire";

// OpenCode 2.3.0 RPC handler failures carry the domain code in data, not code.
const nativeFailure = Schema.Struct({
  type: Schema.Literals(["not_found", "resource_unavailable", "invalid_selection", "refused"]),
  message: Schema.String,
  data: Schema.Struct({ code: ErrorCode }),
});
const missingMethod = Schema.Struct({ type: Schema.Literal("rpc.method_not_found") });

export function nativeRpcError(cause: unknown): CrewError {
  if (cause instanceof CrewError) return cause;
  if (Schema.is(missingMethod)(cause))
    return new CrewError("WEB_NATIVE_UPDATE_REQUIRED", "The running native plugin needs updating");
  const result = Schema.decodeUnknownResult(nativeFailure)(cause);
  return Result.isSuccess(result)
    ? new CrewError(result.success.data.code, result.success.message, {
        rpcType: result.success.type,
      })
    : CrewError.from(cause);
}

/** Only ordinary report absence is an empty state; integrity and transport failures remain errors. */
export function readWorkReport(
  report: Effect.Effect<{ readonly content: string }, CrewError>,
  confirmTask: Effect.Effect<unknown, CrewError>,
): Effect.Effect<typeof WorkReportSchema.Type, CrewError> {
  return report.pipe(
    Effect.catch((error): Effect.Effect<typeof WorkReportSchema.Type, CrewError> => {
      if (error.code === "REPORT_REQUIRED")
        return Effect.succeed({ unavailable: "not_published" as const });
      if (error.code === "EXECUTION_MISSING")
        return confirmTask.pipe(Effect.as({ unavailable: "not_started" as const }));
      return Effect.fail(error);
    }),
  );
}
