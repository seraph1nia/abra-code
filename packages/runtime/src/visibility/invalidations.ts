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
