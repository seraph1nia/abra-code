import { type Context } from "@opencode/plugin/effect/plugin";
import { Effect, Queue, Schedule, Stream } from "effect";
import { type Controller } from "../workflow/controller.ts";
import { Scheduler } from "../scheduler/scheduler.ts";
import { workerFor } from "../opencode/guards.ts";

/** Coalesce event bursts and serialize reconciliation for the plugin's lifetime. */
export function monitor(ctx: Context, c: Controller) {
  return Effect.gen(function* () {
    const requests = yield* Effect.acquireRelease(Queue.dropping<void>(1), Queue.shutdown);
    const scheduler = new Scheduler(c);
    const tick = c.reconcile().pipe(
      Effect.andThen(scheduler.tick()),
      Effect.catch((error) =>
        error.code === "LOCKED" ? Effect.void : Effect.logError("AbraCode reconciliation", error),
      ),
    );
    yield* Stream.fromQueue(requests).pipe(
      Stream.runForEach(() => tick),
      Effect.forkScoped,
    );
    // Setup must return before discovery RPCs can activate other project plugins.
    yield* Effect.sleep(100).pipe(
      Effect.andThen(
        Queue.offer(requests, undefined).pipe(
          Effect.repeat(Schedule.spaced(c.queries.settings.reconcileInterval)),
        ),
      ),
      Effect.forkScoped,
    );
    yield* c.supervise().pipe(
      Effect.catch((error) => Effect.logError("AbraCode attention", error)),
      Effect.repeat(Schedule.spaced(c.queries.settings.reconcileInterval)),
      Effect.forkScoped,
    );
    const events = ctx.event.subscribe().pipe(
      Stream.runForEach((event) =>
        Effect.gen(function* () {
          if (
            event.type === "session.text.ended" ||
            event.type === "session.tool.success" ||
            event.type === "session.tool.failed" ||
            event.type === "session.tool.progress"
          ) {
            yield* c.observeWorker(event.data.sessionID).pipe(Effect.ignore);
          } else if (
            event.type === "session.execution.succeeded" ||
            event.type === "session.execution.failed" ||
            event.type === "session.execution.interrupted" ||
            event.type === "session.idle"
          ) {
            if (yield* workerFor(c, event.data.sessionID)) {
              if (event.type === "session.execution.failed")
                yield* c.recordWorkerFailure(event.data.sessionID, event.data.error);
              yield* Queue.offer(requests, undefined);
            }
          } else if (
            event.type === "form.replied" &&
            (yield* c.queries.executions()).some(
              (e) =>
                e.approval_receipts.some((a) => a.form_id === event.data.id) ||
                e.decisions?.some((d) => d.form_id === event.data.id),
            )
          ) {
            yield* Queue.offer(requests, undefined);
          }
        }),
      ),
      Effect.catchCause((cause) => Effect.logError("AbraCode events", cause)),
    );
    // Native event streams have no replay or automatic reconnect. Periodic
    // reconciliation remains authoritative while reconnecting after EOF/failure.
    yield* events.pipe(Effect.repeat(Schedule.spaced("1 second")), Effect.forkScoped);
  });
}
