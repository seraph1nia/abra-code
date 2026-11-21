import { Context, Effect, Layer, Queue } from "effect";
import { mergeChanges, type ChangeScope } from "@abracode/contracts/web/changes";
/** Committers enqueue hints; publication waits outside the commit lock. */
export const Invalidations = Context.Reference<{
  readonly committed: Effect.Effect<void>;
  readonly publish: (scope: ChangeScope) => Effect.Effect<void>;
  readonly take: Effect.Effect<ChangeScope>;
}>("abracode/Invalidations", {
  defaultValue: () => ({ committed: Effect.void, publish: () => Effect.void, take: Effect.never }),
});
/** Retry the barrier on this consumer so later hints coalesce during backoff. */
export const publishInvalidations = <E, R, R2>(
  events: typeof Invalidations.Service,
  barrier: Effect.Effect<void, E, R>,
  emit: (scope: ChangeScope) => Effect.Effect<void, never, R2>,
) =>
  events.take.pipe(
    Effect.flatMap((scope) =>
      barrier.pipe(
        Effect.matchEffect({
          onFailure: () => events.publish(scope).pipe(Effect.andThen(Effect.sleep("250 millis"))),
          onSuccess: () => emit(scope),
        }),
      ),
    ),
    Effect.forever,
  );
/** Supported broad compatibility path for older callers. */
export const committed = Effect.flatMap(Invalidations, (events) => events.committed);
export const committedScope = (scope: ChangeScope) =>
  Effect.flatMap(Invalidations, (events) => events.publish(scope));
export const invalidationsLayer = Layer.effect(
  Invalidations,
  Effect.gen(function* () {
    const queue = yield* Effect.acquireRelease(Queue.dropping<void>(1), Queue.shutdown);
    let pending: ChangeScope = {};
    const publish = (scope: ChangeScope) =>
      Effect.sync(() => {
        pending = mergeChanges(pending, scope);
      }).pipe(Effect.andThen(Queue.offer(queue, undefined)), Effect.asVoid);
    return {
      committed: publish({ all: true }),
      publish,
      take: Queue.take(queue).pipe(
        Effect.andThen(
          Effect.sync(() => {
            const value = pending;
            pending = {};
            return value;
          }),
        ),
      ),
    };
  }),
);
