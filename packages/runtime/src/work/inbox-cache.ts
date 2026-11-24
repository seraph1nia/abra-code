import { Cache, Duration, Effect, Equal, Exit, Hash } from "effect";
import type { InboxDetail } from "@abracode/contracts/visibility/github-inbox";
import type { CrewError } from "../domain.ts";
import { freshMs } from "./inbox-index.ts";

export type DetailObservation = {
  readonly at: number;
  readonly data: Omit<InboxDetail, "links" | "observed_at">;
};

class DetailCacheKey implements Equal.Equal {
  constructor(
    readonly id: string,
    readonly read: Effect.Effect<DetailObservation, CrewError>,
  ) {}
  [Equal.symbol](that: Equal.Equal): boolean {
    return that instanceof DetailCacheKey && this.id === that.id;
  }
  [Hash.symbol](): number {
    return Hash.string(this.id);
  }
}

/** Bounded TTL cache for GitHub detail observations with single-flight sharing and forced refresh. */
export class InboxDetailCache {
  private readonly cache = Effect.runSync(
    Cache.makeWith<DetailCacheKey, DetailObservation, CrewError>((entry) => entry.read, {
      capacity: 32,
      timeToLive: (exit) => (Exit.isSuccess(exit) ? Duration.millis(freshMs) : Duration.zero),
    }),
  );

  observe(
    id: string,
    force: boolean,
    read: Effect.Effect<DetailObservation, CrewError>,
  ): Effect.Effect<DetailObservation, CrewError> {
    const key = new DetailCacheKey(id, read);
    return force ? Cache.refresh(this.cache, key) : Cache.get(this.cache, key);
  }

  clear(): Effect.Effect<void> {
    return Cache.invalidateAll(this.cache);
  }
}
