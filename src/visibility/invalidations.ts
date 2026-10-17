import { Context, Effect, Layer, Queue } from "effect";
/** Committers only enqueue. Publication is scoped, coalesced and outside the commit lock. */
export const Invalidations = Context.Reference<{
  readonly committed: Effect.Effect<void>;
  readonly take: Effect.Effect<void>;
}>("abracode/Invalidations", {
  defaultValue: () => ({ committed: Effect.void, take: Effect.never }),
});
export const committed = Effect.flatMap(Invalidations, (events) => events.committed);
export const invalidationsLayer = Layer.effect(
  Invalidations,
  Effect.gen(function* () {
    const queue = yield* Effect.acquireRelease(Queue.sliding<void>(1), Queue.shutdown);
    return {
      committed: Queue.offer(queue, undefined).pipe(Effect.asVoid),
      take: Queue.take(queue),
    };
  }),
);
