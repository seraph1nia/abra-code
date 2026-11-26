import { Context, Cache, Effect, Exit } from "effect";
import type { InboxDetail } from "@abracode/contracts/visibility/github-inbox";
import type { CrewError } from "../domain.ts";
import { freshMs } from "./inbox-index.ts";

export type DetailObservation = {
  readonly at: number;
  readonly data: Omit<InboxDetail, "links" | "observed_at">;
};

class DetailRead extends Context.Service<DetailRead, Effect.Effect<DetailObservation, CrewError>>()(
  "abracode/InboxDetailRead",
) {}

export class InboxDetailCache {
  private cache?: Cache.Cache<string, DetailObservation, CrewError, DetailRead>;
  observe(id: string, force: boolean, read: Effect.Effect<DetailObservation, CrewError>) {
    return Effect.gen({ self: this }, function* () {
      const cache = (this.cache ??= yield* Cache.makeWith(
        (_id: string) => Effect.flatten(DetailRead),
        {
          capacity: 32,
          requireServicesAt: "lookup",
          timeToLive: (exit) => (Exit.isSuccess(exit) ? freshMs : 0),
        },
      ));
      if (force) yield* Cache.invalidate(cache, id);
      return yield* Cache.get(cache, id).pipe(Effect.provideService(DetailRead, read));
    });
  }
  get clear() {
    return Effect.suspend(() => (this.cache ? Cache.invalidateAll(this.cache) : Effect.void));
  }
}
