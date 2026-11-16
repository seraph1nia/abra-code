import { Effect, Scope } from "effect";
/** Promise interop stays at the test runner; production modules return Effects. */
export const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>): Promise<A> =>
  Effect.runPromise(Effect.scoped(effect));
