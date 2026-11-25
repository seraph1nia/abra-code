import { LockKey } from "@abracode/contracts/identities";
import { Layer, Context, Effect } from "effect";
import { CrewError } from "../domain.ts";
import { type Locks } from "../storage/lock.ts";

const held = Context.Reference<{ owner: Coordination; shared: boolean } | undefined>(
  "abracode/coordination",
  {
    defaultValue: () => undefined,
  },
);
/** Only short read/validate/commit sections belong here. No external work or lock waits. */
export class Coordination {
  constructor(private locks: Locks) {}
  with<A, E, R>(
    action: () => Effect.Effect<A, E, R>,
    options?: { waitSeconds?: number; shared?: boolean },
  ) {
    return Effect.flatMap(held, (state) => {
      if (state?.owner === this) {
        if (state.shared && !options?.shared)
          return Effect.fail(
            new CrewError(
              "COORDINATION_UPGRADE",
              "Observation cannot upgrade shared coordination into a commit",
            ),
          );
        return action();
      }
      return this.locks.with(
        LockKey.make("controller"),
        () =>
          action().pipe(
            Effect.provideService(held, { owner: this, shared: options?.shared ?? false }),
          ),
        options,
      );
    });
  }
}

export class CoordinationService extends Context.Service<CoordinationService, Coordination>()(
  "abracode/Coordination",
) {
  static layer(locks: Locks) {
    return Layer.effect(
      CoordinationService,
      Effect.sync(() => new Coordination(locks)),
    );
  }
}
