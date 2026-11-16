import { Effect } from "effect";
import { CrewError } from "./domain.ts";
/** Keep synchronous domain invariants in the typed failure channel; defects remain defects. */
export const domainEffect = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, CrewError, R> =>
  effect.pipe(
    Effect.mapError(CrewError.from),
    Effect.catchDefect((defect) =>
      defect instanceof CrewError ? Effect.fail(defect) : Effect.die(defect),
    ),
  );
