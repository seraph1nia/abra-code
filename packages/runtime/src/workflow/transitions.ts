import { type IssueId } from "../identities.ts";
import { type Operations } from "./operations.ts";
import { type WorkerSessions } from "./sessions.ts";
import { Effect } from "effect";
import { CrewError, terminal, type Execution, type Phase } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { type Records, type ExecutionPatch, removeOwnedField } from "../storage/store.ts";
import { type WorkGraph } from "../work/graph.ts";
import { type Runtime } from "../opencode/runtime.ts";
import { type Coordination } from "./coordination.ts";
import { type Queries } from "./queries.ts";

/** Phase writes, failure reflection and notifications share one lifecycle implementation. */
export class ExecutionTransitions {
  constructor(
    private records: Records,
    private work: WorkGraph,
    private runtime: Runtime,
    private coordination: Coordination,
    private queries: Pick<Queries, "get">,
    private operations: Operations,
    private sessions: WorkerSessions,
  ) {}
  confirmStop = Effect.fn("ExecutionTransitions.confirmStop")(
    function* (this: ExecutionTransitions, e: Execution) {
      const stopped = yield* this.sessions.confirmStopped(e);
      return yield* this.records.commitOwned(e, {
        ...stopped,
        stop_status: "confirmed",
        ...(e.operation && { operation: { ...e.operation, status: "stopped" } }),
      });
    }.bind(this),
    domainEffect,
  );
  pause = Effect.fn("ExecutionTransitions.pause")(
    function* (this: ExecutionTransitions, id: IssueId) {
      yield* this.coordination.with(() =>
        domainEffect(
          Effect.gen({ self: this }, function* () {
            const e = yield* this.queries.get(id);
            if (terminal(e))
              return yield* new CrewError("CONTROL_PHASE", "Completed work cannot be paused");
            if (
              e.current_phase !== "interrupted" &&
              !(
                e.resume_phase &&
                ["failed", "blocked", "recovery_required"].includes(e.current_phase)
              )
            )
              e.resume_phase = e.current_phase;
            e.current_phase = "interrupted";
            e.stop_status = "requested";
            return yield* this.records.saveControl(e);
          }),
        ),
      );
      yield* this.operations.stop(id);
      return yield* this.operations
        .quiescent(id, () =>
          domainEffect(
            Effect.gen({ self: this }, function* () {
              const current = yield* this.queries.get(id);
              return yield* this.confirmStop(current);
            }),
          ),
        )
        .pipe(
          Effect.catchIf(
            (error) => error.code === "LOCKED",
            () => this.queries.get(id),
          ),
        );
    }.bind(this),
    domainEffect,
  );
  move = Effect.fn("ExecutionTransitions.move")(
    function* (
      this: ExecutionTransitions,
      e: Execution,
      phase: Phase,
      changes: ExecutionPatch = {},
    ) {
      return yield* this.records.commitOwned(e, {
        ...changes,
        current_phase: phase,
        error_or_recovery_reason: removeOwnedField,
      });
    }.bind(this),
    domainEffect,
  );
  notice = Effect.fn("ExecutionTransitions.notice")(
    function* (this: ExecutionTransitions, e: Execution, text: string) {
      if (e.supervisor_session_id)
        yield* this.runtime
          .notify(e.supervisor_session_id, `[AbraCode ${e.issue_id} ${e.current_phase}] ${text}`)
          .pipe(Effect.catch(() => domainEffect(Effect.sync(() => {}))));
    }.bind(this),
    domainEffect,
  );
  fail = Effect.fn("ExecutionTransitions.fail")(
    function* (this: ExecutionTransitions, e: Execution, error: unknown, phase: Phase = "blocked") {
      if (
        error instanceof CrewError &&
        ["STALE_OPERATION", "STALE_REVISION", "STOP_REQUESTED"].includes(error.code)
      )
        return yield* this.queries.get(e.issue_id);
      const reason = CrewError.from(error).message;
      const release =
        !e.active_role &&
        !e.session_intent &&
        !e.explore_session_id &&
        !e.apply_session_id &&
        !e.review_session_id &&
        !e.research_session_id;
      yield* this.coordination.with(() =>
        domainEffect(
          Effect.gen({ self: this }, function* () {
            yield* this.records.commitOwned(e, {
              resume_phase: e.current_phase,
              current_phase: phase,
              error_or_recovery_reason: reason,
              ...(release && {
                capacity_observed_idle: true,
                capacity_reservation: removeOwnedField,
              }),
            });
            if (phase === "blocked" || phase === "failed") {
              const issue = yield* this.work.show(e.issue_id);
              if (issue.assignee === e.execution_id && issue.status === "in_progress")
                yield* this.work.block(e.issue_id, e.execution_id, reason);
            }
          }),
        ),
      );
      yield* this.notice(e, reason);
      return e;
    }.bind(this),
    domainEffect,
  );
}
