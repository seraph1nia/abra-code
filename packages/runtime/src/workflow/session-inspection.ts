import { Effect } from "effect";
import { CrewError, type Execution } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import type { Runtime } from "../opencode/runtime.ts";
import { messageRequests } from "./message-contracts.ts";
import { workerSessionID } from "./worker-assignment.ts";

export class SessionInspection {
  constructor(private runtime: Pick<Runtime, "session">) {}

  validateLocations = Effect.fn("SessionInspection.validateLocations")(
    function* (this: SessionInspection, e: Execution) {
      for (const role of ["explore", "apply", "review", "research"] as const) {
        const id = workerSessionID(e, role);
        if (id && (yield* this.runtime.session(id)).directory !== e.worktree_directory)
          return yield* new CrewError(
            "SESSION_LOCATION",
            "Managed session moved out of owned worktree",
          );
      }
    }.bind(this),
    domainEffect,
  );
  idle = Effect.fn("SessionInspection.idle")(
    function* (this: SessionInspection, e: Execution) {
      if (messageRequests(e.messages).some((m) => m.status === "admission_uncertain"))
        return yield* new CrewError(
          "MESSAGE_UNCERTAIN",
          "Pause and confirm native stop before replacing an uncertain instruction",
        );
      for (const role of ["explore", "apply", "review", "research"] as const) {
        const id = workerSessionID(e, role);
        if (id && (yield* this.runtime.session(id)).busy)
          return yield* new CrewError(
            "WRITER_BUSY",
            "A managed session still runs in this worktree",
          );
      }
    }.bind(this),
    domainEffect,
  );
}
