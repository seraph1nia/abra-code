import { correlate } from "../observability.ts";
import {
  OperationAction,
  LockKey,
  OperationId,
  Fingerprint,
  IssueId,
} from "@abracode/contracts/identities";
import { synchronizeExecution, type Records } from "../storage/store.ts";

import { Cause, Clock, Effect, Exit, Fiber, FiberMap, PubSub, Scope } from "effect";
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
  private controlEvents = Effect.runSync(PubSub.sliding<IssueId>(64));
  close = () =>
    PubSub.shutdown(this.controlEvents).pipe(Effect.andThen(Scope.close(this.scope, Exit.void)));
  constructor(
    private records: Records,
    private locks: Locks,
    private coordination: Coordination,
  ) {}
  /** Wake in-process watchdogs immediately after a control generation or stop-status write. */
  notifyControl(id: IssueId) {
    return PubSub.publish(this.controlEvents, id).pipe(Effect.asVoid);
  }
  intent(e: Execution, action: OperationAction) {
    return domainEffect(
      Effect.gen({ self: this }, function* () {
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
            return domainEffect(
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
                        return yield* new CrewError(
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
                  ),
                );
                const exit = yield* Fiber.join(fiber).pipe(
                  Effect.onInterrupt(() => FiberMap.remove(this.running, id)),
                  Effect.exit,
                );
                const current = yield* this.coordination.with(() =>
                  Effect.gen({ self: this }, function* () {
                    const e = yield* this.records.execution(id);
                    if (
                      e?.operation &&
                      initial?.current_phase !== "completed" &&
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
                      yield* this.records.saveOwned(e, ["operation", "attention"]);
                    }
                    return e;
                  }),
                );
                if (Exit.isFailure(exit)) {
                  if (Cause.hasInterruptsOnly(exit.cause))
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
