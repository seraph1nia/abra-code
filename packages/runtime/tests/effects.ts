import type { Agents } from "@abracode/agents";
import { AgentsLive, sourcesLayer } from "@abracode/agents/bundled";
import { platformLayer } from "../src/platform.ts";
import { Effect, Layer, Scope } from "effect";
const catalog = AgentsLive.pipe(Layer.provide(sourcesLayer()), Layer.provide(platformLayer));
/** Promise interop stays at the test runner; production modules return Effects. */
export const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope | Agents>): Promise<A> =>
  Effect.runPromise(Effect.scoped(effect.pipe(Effect.provide(catalog))));
