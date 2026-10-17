import { LockKey } from "../identities.ts";
import { Context, Effect } from "effect";
import { type Locks } from "../storage/lock.ts";

const held = Context.Reference<Coordination | undefined>("abracode/coordination", {
  defaultValue: () => undefined,
});
/** Only short read/validate/commit sections belong here. No external work or lock waits. */
export class Coordination {
  constructor(private locks: Locks) {}
  with<A, E, R>(action: () => Effect.Effect<A, E, R>) {
    return Effect.flatMap(held, (owner) =>
      owner === this
        ? action()
        : this.locks.with(LockKey.make("controller"), () =>
            action().pipe(Effect.provideService(held, this)),
          ),
    );
  }
}
