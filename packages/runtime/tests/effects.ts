import { CrewError } from "../src/domain.ts";
import type { Agents } from "@abracode/agents";
import { AgentsLive, sourcesLayer } from "@abracode/agents/bundled";
import { platformLayer } from "../src/platform.ts";
import { Effect, Layer, Scope } from "effect";
const catalog = AgentsLive.pipe(Layer.provide(sourcesLayer()), Layer.provideMerge(platformLayer));
/** Promise interop stays at the test runner; production modules return Effects. */
export const run = <A, E>(
  effect: Effect.Effect<A, E, Scope.Scope | Agents | Layer.Success<typeof platformLayer>>,
): Promise<A> => Effect.runPromise(Effect.scoped(effect.pipe(Effect.provide(catalog))));

/** Fixture adapters also simulate errors thrown by synchronous native and Git stubs. */
export const domainEffect = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, CrewError, R> =>
  effect.pipe(
    Effect.mapError(CrewError.from),
    Effect.catchDefect((defect) =>
      defect instanceof CrewError ? Effect.fail(defect) : Effect.die(defect),
    ),
  );
