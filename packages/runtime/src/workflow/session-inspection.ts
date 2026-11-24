import { Effect } from "effect";
import { CrewError, type Execution } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import type { Runtime } from "../opencode/runtime.ts";
import { messageRequests } from "@abracode/contracts/workflow/message-contracts";
import { workerSessionID } from "./worker-assignment.ts";

const workerRoles = ["explore", "apply", "review", "research"] as const;

export class SessionInspection {
  constructor(private runtime: Pick<Runtime, "session">) {}

  validateLocations = Effect.fn("SessionInspection.validateLocations")(
    function* (this: SessionInspection, e: Execution) {
      yield* Effect.forEach(
        workerRoles,
        (role) => {
          const id = workerSessionID(e, role);
          if (!id) return Effect.void;
          return this.runtime
            .session(id)
            .pipe(
              Effect.flatMap((state) =>
                state.directory !== e.worktree_directory
                  ? Effect.fail(
                      new CrewError(
                        "SESSION_LOCATION",
                        "Managed session moved out of owned worktree",
                      ),
                    )
                  : Effect.void,
              ),
            );
        },
        { concurrency: "unbounded" },
      );
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
      yield* Effect.forEach(
        workerRoles,
        (role) => {
          const id = workerSessionID(e, role);
          if (!id) return Effect.void;
          return this.runtime
            .session(id)
            .pipe(
              Effect.flatMap((state) =>
                state.busy
                  ? Effect.fail(
                      new CrewError("WRITER_BUSY", "A managed session still runs in this worktree"),
                    )
                  : Effect.void,
              ),
            );
        },
        { concurrency: "unbounded" },
      );
    }.bind(this),
    domainEffect,
  );
}
