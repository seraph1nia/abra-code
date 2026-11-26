import { Rpc } from "@opencode/plugin/rpc";
import { Effect } from "effect";
import { CrewError } from "../domain.ts";
import { diagnosticText } from "../opencode/diagnostics.ts";
import { type visibility } from "./protocol.ts";
type ErrorFactory = Rpc.ErrorFactory<typeof visibility.methods.detail>;
export function observerResult<A, R>(
  effect: Effect.Effect<A, CrewError, R>,
  error: ErrorFactory,
  inbox = false,
) {
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
        if (
          [
            "SPEC_PATH",
            "DOCUMENT_PATH",
            "DIFF_PATH",
            "INVALID_ID",
            "INVALID_SELECTION",
            "FEEDBACK_PAGE",
          ].includes(failure.code) ||
          (inbox && failure.code === "INBOX_PROJECT")
        )
          return Effect.fail(error("invalid_selection", message, data));
        return Effect.fail(error("resource_unavailable", message, data));
      },
    ),
  );
}
