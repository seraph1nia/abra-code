import { sha256 } from "../digest.ts";
import { WorkflowError } from "../errors.ts";
import { SessionMessage } from "@opencode/schema/session-message";
import { correlate } from "../observability.ts";
import {
  OperationAction,
  LockKey,
  OperationId,
  Fingerprint,
  IssueId,
} from "@abracode/contracts/identities";
import type { WorkGraph } from "../work/graph.ts";
import { removeOwnedField, type Records } from "../storage/store.ts";

import { Cause, Clock, Effect, Exit, Fiber, FiberMap, PubSub, Scope } from "effect";
import { randomUUID } from "node:crypto";
import { CrewError, type ManagedExecution, type Execution } from "../domain.ts";
import { type Locks } from "../storage/lock.ts";

import { type Coordination } from "./coordination.ts";

export const operationKey = (id: IssueId) => LockKey.make(`execution-${sha256(id).slice(0, 40)}`);

export function inputFingerprint(e: ManagedExecution) {
  return Fingerprint.make(
    sha256(
      JSON.stringify({
        execution: e.execution_id,
        generation: e.control_generation,
        policy: e.effective_policy,
        phase: e.current_phase,
        base: e.base_commit,
        target: e.target_branch,
        plan: e.plan_fingerprint,
        delivered: e.delivered_commit,
      }),
    ),
  );
}

/** Only emitted when acquisition failed before the operation body entered. */
export class ExecutionBusy extends CrewError {
  constructor(readonly issue_id: IssueId) {
    super("LOCKED", "An operation already owns this execution; observe its progress.");
  }
}

/** Single writer per execution; short commits and interruption remain independently available. */
export class Operations {
  static make(records: Records, locks: Locks, coordination: Coordination, work: WorkGraph) {
    return Effect.gen(function* () {
      const scope = yield* Scope.make();
      const running = yield* FiberMap.make<IssueId, unknown, CrewError>().pipe(
        Scope.provide(scope),
      );
      const controlEvents = yield* PubSub.sliding<IssueId>(64);
      return new Operations(records, locks, coordination, work, scope, running, controlEvents);
    });
  }
  get close() {
    return PubSub.shutdown(this.controlEvents).pipe(
      Effect.andThen(Scope.close(this.scope, Exit.void)),
    );
  }
  private constructor(
    private records: Records,
    private locks: Locks,
    private coordination: Coordination,
    private work: WorkGraph,
    private scope: Scope.Closeable,
    private running: FiberMap.FiberMap<IssueId, unknown, CrewError>,
    private controlEvents: PubSub.PubSub<IssueId>,
  ) {}
  /** Reapply the same owner-checked SQLite change after interruption or a lost acknowledgement. */
  reflectIssue(e: Execution) {
    return this.coordination.with(() =>
      Effect.gen({ self: this }, function* () {
        e = yield* this.records.commitOwned(e, () => undefined);
        const target = e.pending_issue_status;
        if (!target) return e;
        switch (target) {
          case "blocked":
            yield* this.work.block(e.issue_id, e.execution_id, e.error_or_recovery_reason ?? "");
            break;
          case "in_progress":
            yield* this.work.resume(e.issue_id, e.execution_id);
            break;
          case "closed":
            yield* this.work.close(e.issue_id, e.execution_id);
            break;
        }
        return yield* this.records.commitOwned(e, {
          pending_issue_status: removeOwnedField,
          ...(target === "closed" && {
            current_phase: "completed",
            finishing: {
              ...e.finishing,
              schema_version: 1,
              current_question: undefined,
              completion_notice: e.finishing?.completion_notice ?? {
                message_id: SessionMessage.ID.create(),
                session_id: e.supervisor_session_id,
                status: "pending" as const,
                attempts: 0,
                next_check_at: 0,
              },
            },
            cleanup_blocker: removeOwnedField,
            attention:
              e.attention?.map((a) =>
                a.code === "cleanup_blocked" && a.status !== "superseded"
                  ? { ...a, status: "superseded" as const }
                  : a,
              ) ?? removeOwnedField,
          }),
        });
      }),
    );
  }
  /** Wake in-process watchdogs immediately after a control generation or stop-status write. */
  notifyControl(id: IssueId) {
    return PubSub.publish(this.controlEvents, id).pipe(Effect.asVoid);
  }
  intent(e: Execution, action: OperationAction) {
    return Effect.gen({ self: this }, function* () {
      const operation = {
        id: OperationId.make(`op-${randomUUID()}`),
        generation: e.control_generation,
        fingerprint: inputFingerprint(e),
        action,
        status: "prepared" as const,
        expected: `Reconcile ${e.current_phase} against retained execution/native/delivery identities`,
        started_at: yield* Clock.currentTimeMillis,
      };
      return yield* this.records.beginOperation(e, operation);
    });
  }
  owned<A>(id: IssueId, action: OperationAction, body: () => Effect.Effect<A, CrewError>) {
    return Effect.suspend(() => {
      let entered = false;
      return this.locks
        .with(
          operationKey(id),
          () => {
            entered = true;
            return Effect.uninterruptibleMask((restore) =>
              Effect.gen({ self: this }, function* () {
                const initial = yield* this.coordination.with(() =>
                  Effect.gen({ self: this }, function* () {
                    let e: Execution | undefined = yield* this.records.execution(id);
                    if (e?.pending_issue_status) e = yield* this.reflectIssue(e);
                    if (
                      e &&
                      e.current_phase !== "completed" &&
                      !(
                        action === "reconcile" &&
                        ["interrupted", "blocked", "failed", "recovery_required"].includes(
                          e.current_phase,
                        )
                      )
                    )
                      e = yield* this.intent(e, action);
                    return e;
                  }),
                );
                const generation = initial?.control_generation ?? 0;
                const watchdog = Effect.scoped(
                  Effect.gen({ self: this }, function* () {
                    const subscription = yield* PubSub.subscribe(this.controlEvents);
                    const waitControl = Effect.gen(function* () {
                      while (true) {
                        if ((yield* PubSub.take(subscription)) === id) return;
                      }
                    });
                    while (true) {
                      // Immediate wakeup for in-process control writes; calm fallback catches cross-process writes.
                      yield* waitControl.pipe(
                        Effect.timeoutOrElse({
                          duration: "500 millis",
                          orElse: () => Effect.void,
                        }),
                      );
                      const current = yield* this.records.execution(id);
                      if (
                        current &&
                        (current.control_generation !== generation ||
                          (current.stop_status === "requested" &&
                            initial?.stop_status !== "requested"))
                      )
                        return yield* new WorkflowError(
                          "STOP_REQUESTED",
                          "Operation superseded by a control request",
                        );
                    }
                  }),
                );
                const fiber = yield* FiberMap.run(
                  this.running,
                  id,
                  correlate(
                    Effect.logDebug("Owned operation started").pipe(
                      Effect.andThen(Effect.raceFirst(body(), watchdog)),
                      Effect.tap(() => Effect.logDebug("Owned operation completed")),
                      Effect.tapError((error) =>
                        Effect.logDebug("Owned operation failed", { code: error.code }),
                      ),
                    ),
                    initial,
                  ).pipe(Effect.interruptible),
                );
                const exit = yield* restore(Fiber.join(fiber)).pipe(
                  Effect.onInterrupt(() => FiberMap.remove(this.running, id)),
                  Effect.exit,
                );
                const current = yield* this.coordination.with(() =>
                  Effect.gen({ self: this }, function* () {
                    let e: Execution | undefined = yield* this.records.execution(id);
                    if (
                      e?.operation &&
                      initial?.current_phase !== "completed" &&
                      e.operation.generation === generation &&
                      e.control_generation === generation
                    ) {
                      const operation = e.operation;
                      const succeeded = Exit.isSuccess(exit);
                      return yield* this.records.commitOwned(e, {
                        operation: { ...operation, status: succeeded ? "completed" : "uncertain" },
                        ...(succeeded &&
                          e.attention && {
                            attention: e.attention.map((a) =>
                              a.generation === generation &&
                              a.code === "operation_stall" &&
                              a.observed_operation === operation.id &&
                              !["handled", "superseded"].includes(a.status)
                                ? {
                                    ...a,
                                    status: "superseded",
                                    disposition: `Owned operation ${operation.id} completed`,
                                  }
                                : a,
                            ),
                          }),
                      });
                    }
                    return e;
                  }),
                );
                if (Exit.isFailure(exit)) {
                  if (Cause.hasInterruptsOnly(exit.cause))
                    return yield* new WorkflowError("STOP_REQUESTED", "Owned operation stopped");
                  return yield* Effect.failCause(exit.cause);
                }
                if (
                  current &&
                  typeof exit.value === "object" &&
                  exit.value !== null &&
                  "execution_id" in exit.value &&
                  exit.value.execution_id === current.execution_id
                )
                  return current as A;
                return exit.value;
              }),
            );
          },
          { waitSeconds: 0 },
        )
        .pipe(
          Effect.mapError((error) =>
            !entered && error instanceof CrewError && error.code === "LOCKED"
              ? new ExecutionBusy(id)
              : error instanceof ExecutionBusy
                ? new WorkflowError(error.code, error.message, error.details)
                : error,
          ),
        );
    });
  }
  stop(id: IssueId) {
    return FiberMap.remove(this.running, id);
  }
  quiescent<A>(id: IssueId, inspect: () => Effect.Effect<A, CrewError>) {
    return this.locks.with(operationKey(id), inspect, { waitSeconds: 0 });
  }
}
