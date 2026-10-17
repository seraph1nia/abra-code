import { Clock, Effect, Metric } from "effect";
import { type Role, type ManagedExecution } from "./domain.ts";
export const observerRequests = Metric.counter("abracode.observer.requests", { incremental: true });
export const admissionWaits = Metric.counter("abracode.admission.waits", { incremental: true });
export const providerFailures = Metric.counter("abracode.worker.failures", { incremental: true });
export const reconcileDuration = Metric.histogram("abracode.reconcile.duration_ms", {
  boundaries: [10, 50, 100, 500, 1000, 5000, 30000, 120000],
});
export const observerRequest = (
  method: "snapshot" | "detail" | "diff" | "document" | "report" | "feedback",
) => Metric.update(observerRequests.pipe(Metric.withAttributes({ method })), 1);
export const admissionWait = (role: Role) =>
  Metric.update(admissionWaits.pipe(Metric.withAttributes({ role })), 1);
export const providerFailure = (role: Role) =>
  Metric.update(providerFailures.pipe(Metric.withAttributes({ role })), 1);
export const measureReconcile = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const started = yield* Clock.currentTimeMillis;
    return yield* effect.pipe(
      Effect.ensuring(
        Clock.currentTimeMillis.pipe(
          Effect.flatMap((ended) => Metric.update(reconcileDuration, Math.max(0, ended - started))),
        ),
      ),
    );
  });
export function correlate<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  e: ManagedExecution | undefined,
) {
  if (!e) return effect;
  const attributes = {
    issue_id: e.issue_id,
    execution_id: e.execution_id,
    generation: e.control_generation,
    operation_id: e.operation?.id ?? "unassigned",
  };
  return effect.pipe(
    Effect.annotateLogs(attributes),
    Effect.withSpan("abracode.operation", { attributes }),
  );
}
