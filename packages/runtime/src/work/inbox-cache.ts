import { Context, Layer, Clock, Effect, Exit } from "effect";
import type { InboxDetail } from "@abracode/contracts/visibility/github-inbox";
import type { CrewError } from "../domain.ts";
import { freshMs } from "./inbox-index.ts";

export type DetailObservation = {
  readonly at: number;
  readonly data: Omit<InboxDetail, "links" | "observed_at">;
};

type Entry = { read: Effect.Effect<DetailObservation, CrewError>; expires?: number };

/** Readers share the selected observation. Each forced refresh selects a new entry immediately. */
export class InboxDetailCache {
  private readonly entries = new Map<string, Entry>();

  observe(id: string, force: boolean, read: Effect.Effect<DetailObservation, CrewError>) {
    return Effect.gen({ self: this }, function* () {
      const now = yield* Clock.currentTimeMillis;
      const prior = this.entries.get(id);
      this.entries.delete(id);
      if (!force && prior && (prior.expires === undefined || prior.expires > now)) {
        this.entries.set(id, prior);
        return yield* prior.read;
      }
      const entry: Entry = {
        read: yield* Effect.cached(
          read.pipe(
            Effect.onExit((exit) =>
              Clock.currentTimeMillis.pipe(
                Effect.map((completed) => {
                  if (this.entries.get(id) !== entry) return;
                  if (Exit.isSuccess(exit)) entry.expires = completed + freshMs;
                  else this.entries.delete(id);
                }),
              ),
            ),
          ),
        ),
      };
      this.entries.set(id, entry);
      if (this.entries.size > 32) {
        const oldest = this.entries.keys().next();
        if (!oldest.done) this.entries.delete(oldest.value);
      }
      return yield* entry.read;
    });
  }

  get clear() {
    return Effect.sync(() => this.entries.clear());
  }
}

export class InboxDetailCacheService extends Context.Service<
  InboxDetailCacheService,
  InboxDetailCache
>()("abracode/InboxDetailCache") {
  static layer() {
    return Layer.effect(
      InboxDetailCacheService,
      Effect.acquireRelease(
        Effect.sync(() => new InboxDetailCache()),
        (cache) => cache.clear,
      ),
    );
  }
}
