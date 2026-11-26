import { Effect } from "effect";
import { CrewError } from "./domain.ts";

/** Keep expected failures from synchronous policy and mutation callbacks in the error channel. */
export const tryDomainValue = <Args extends readonly unknown[], A>(
  evaluate: (...args: Args) => A,
  ...args: Args
): Effect.Effect<A, CrewError> =>
  Effect.try({
    try: () => evaluate(...args),
    catch: (error) => {
      if (error instanceof CrewError) return error;
      throw error;
    },
  });
