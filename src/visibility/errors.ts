import { Rpc } from "@opencode/plugin/rpc";
import { Effect } from "effect";
import { CrewError } from "../domain.ts";
import { diagnosticText } from "../opencode/diagnostics.ts";
import { type visibility } from "./protocol.ts";
type ErrorFactory = Rpc.ErrorFactory<typeof visibility.methods.detail>;
export function observerResult<A, R>(effect: Effect.Effect<A, CrewError, R>, error: ErrorFactory) {
  return effect.pipe(
    Effect.catch(
      (failure): Effect.Effect<never, Rpc.HandlerError<typeof visibility.methods.detail>> => {
        const message = diagnosticText(failure.message);
        const data = { code: failure.code };
        if (
          ["ISSUE_MISSING", "EXECUTION_MISSING", "PROJECT_MISSING", "NOT_FOUND"].includes(
            failure.code,
          )
        )
          return Effect.fail(error("not_found", message, data));
        if (["SPEC_PATH", "DOCUMENT_PATH", "DIFF_PATH", "INVALID_ID"].includes(failure.code))
          return Effect.fail(error("invalid_selection", message, data));
        if (
          [
            "WORKER_UNAVAILABLE",
            "DOCUMENT_UNAVAILABLE",
            "REPORT_UNAVAILABLE",
            "REPORT_MISSING",
            "REPORT_REQUIRED",
            "REPORT_IDENTITY",
            "REPORT_PATH",
            "REPORT_TAMPERED",
            "DIFF_REPOSITORY",
            "ENOENT",
            "EACCES",
            "WORKTREE",
            "COMMAND_FAILED",
          ].includes(failure.code)
        )
          return Effect.fail(error("resource_unavailable", message, data));
        return Effect.die(failure);
      },
    ),
  );
}
