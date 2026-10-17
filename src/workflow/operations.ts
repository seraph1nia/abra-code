import { correlate } from "../observability.ts";
import { OperationAction, LockKey, OperationId, Fingerprint, IssueId } from "../identities.ts";
import { synchronizeExecution, type Records } from "../storage/store.ts";

import { Clock, Effect, Exit, Fiber, FiberMap, Scope } from "effect";
import { createHash, randomUUID } from "node:crypto";
import { CrewError, type ManagedExecution, type Execution } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { type Locks } from "../storage/lock.ts";

import { type Coordination } from "./coordination.ts";

export const operationKey = (id: IssueId) =>
  LockKey.make(`execution-${createHash("sha256").update(id).digest("hex").slice(0, 40)}`);
export function inputFingerprint(e: ManagedExecution) {
  return Fingerprint.make(
    createHash("sha256")
      .update(
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
      )
      .digest("hex"),
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
  private scope = Scope.makeUnsafe();
  private running = Effect.runSync(
    FiberMap.make<IssueId, unknown, CrewError>().pipe(
      Effect.provideService(Scope.Scope, this.scope),
    ),
  );
  close = () => Scope.close(this.scope, Exit.void);
  constructor(
    private records: Records,
    private locks: Locks,
    private coordination: Coordination,
  ) {}
  intent(e: Execution, action: OperationAction) {
    return domainEffect(
      Effect.gen({ self: this }, function* () {
        e.operation = {
          id: OperationId.make(`op-${randomUUID()}`),
          generation: e.control_generation,
          fingerprint: inputFingerprint(e),
          action,
          status: "prepared",
          expected: `Reconcile ${e.current_phase} against retained execution/native/delivery identities`,
          started_at: yield* Clock.currentTimeMillis,
        };
        return yield* this.records.save(e);
      }),
    );
  }
  owned<A>(id: IssueId, action: OperationAction, body: () => Effect.Effect<A, CrewError>) {
    return Effect.suspend(() => {
      let entered = false;
      return this.locks
        .with(
          operationKey(id),
          () => {
            entered = true;
            return Effect.scoped(
              domainEffect(
                Effect.gen({ self: this }, function* () {
                  const initial = yield* this.coordination.with(() =>
                    Effect.gen({ self: this }, function* () {
                      const e = yield* this.records.execution(id);
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
                        yield* this.intent(e, action);
                      return e;
                    }),
                  );
                  const generation = initial?.control_generation ?? 0;
                  const watchdog = Effect.gen({ self: this }, function* () {
                    while (true) {
                      yield* Effect.sleep(100);
                      const current = yield* this.records.execution(id);
                      if (
                        current &&
                        (current.control_generation !== generation ||
                          (current.stop_status === "requested" &&
                            initial?.stop_status !== "requested"))
                      )
                        return yield* new CrewError(
                          "STOP_REQUESTED",
                          "Operation superseded by a control request",
                        );
                    }
                  });
                  const fiber = yield* correlate(
                    Effect.logDebug("Owned operation started").pipe(
                      Effect.andThen(Effect.raceFirst(body(), watchdog)),
                      Effect.tap(() => Effect.logDebug("Owned operation completed")),
                      Effect.tapError((error) =>
                        Effect.logDebug("Owned operation failed", { code: error.code }),
                      ),
                    ),
                    initial,
                  ).pipe(Effect.forkScoped);
                  yield* FiberMap.set(this.running, id, fiber);
                  const exit = yield* Effect.exit(Fiber.join(fiber));
                  const current = yield* this.coordination.with(() =>
                    Effect.gen({ self: this }, function* () {
                      const e = yield* this.records.execution(id);
                      if (
                        e?.operation &&
                        e.operation.generation === generation &&
                        e.control_generation === generation
                      ) {
                        e.operation = {
                          ...e.operation,
                          status: Exit.isSuccess(exit) ? "completed" : "uncertain",
                        };
                        if (Exit.isSuccess(exit))
                          e.attention = e.attention?.map((a) =>
                            a.generation === generation &&
                            a.code === "operation_stall" &&
                            a.observed_operation === e.operation!.id &&
                            !["handled", "superseded"].includes(a.status)
                              ? {
                                  ...a,
                                  status: "superseded",
                                  disposition: `Owned operation ${e.operation!.id} completed`,
                                }
                              : a,
                          );
                        yield* this.records.save(e);
                      }
                      return e;
                    }),
                  );
                  if (Exit.isFailure(exit)) {
                    if (exit.cause.reasons.some((reason) => reason._tag === "Interrupt"))
                      return yield* new CrewError("STOP_REQUESTED", "Owned operation stopped");
                    return yield* Effect.failCause(exit.cause);
                  }
                  if (
                    current &&
                    typeof exit.value === "object" &&
                    exit.value !== null &&
                    "execution_id" in exit.value
                  )
                    synchronizeExecution(exit.value, current);
                  return exit.value;
                }),
              ),
            );
          },
          { waitSeconds: 0 },
        )
        .pipe(
          Effect.mapError((error) =>
            !entered && error instanceof CrewError && error.code === "LOCKED"
              ? new ExecutionBusy(id)
              : error instanceof ExecutionBusy
                ? new CrewError(error.code, error.message, error.details)
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
