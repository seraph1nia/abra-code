import * as Id from "@abracode/contracts/identities";
import { domainEffect } from "../effects.ts";
import { Effect, Schema, Semaphore } from "effect";
import { type Store } from "../../src/storage/store.ts";
import { CrewError } from "../../src/domain.ts";
import { type Locks } from "../../src/storage/lock.ts";

export class MemoryStore implements Store {
  values = new Map<string, unknown>();
  get<T>(key: string) {
    return domainEffect(
      Effect.sync(() => {
        return structuredClone(this.values.get(key)) as T | undefined;
      }),
    );
  }
  set<T>(key: string, value: T) {
    return domainEffect(
      Effect.sync(() => {
        this.values.set(key, structuredClone(value));
      }),
    );
  }
  page(prefix: Id.StoragePrefix, after: string | undefined, limit: number) {
    return this.entries(prefix).pipe(
      Effect.map((rows) => {
        const sorted = rows
          .filter((r) => !after || r.key > after)
          .sort((a, b) => (a.key < b.key ? -1 : 1));
        return {
          entries: sorted
            .slice(0, limit)
            .map((r) => ({ key: r.key, value: Schema.decodeUnknownSync(Schema.Json)(r.value) })),
          next: sorted.length > limit ? sorted[limit - 1].key : undefined,
        };
      }),
    );
  }
  entries(prefix: string) {
    return domainEffect(
      Effect.sync(() =>
        [...this.values]
          .filter(([key]) => key.startsWith(prefix))
          .map(([key, value]) => ({ key: Id.StorageKey.make(key), value: structuredClone(value) })),
      ),
    );
  }
}
export class TestLocks implements Locks {
  private semaphores = new Map<string, Semaphore.Semaphore>();
  private owners = new Set<string>();
  get held() {
    return this.owners.size > 0;
  }
  with<A, E, R>(
    key: string,
    action: () => Effect.Effect<A, E, R>,
    options?: { waitSeconds?: number },
  ) {
    const semaphore = this.semaphores.get(key) ?? Semaphore.makeUnsafe(1);
    this.semaphores.set(key, semaphore);
    const body = Effect.acquireUseRelease(
      Effect.sync(() => this.owners.add(key)),
      () => action(),
      () =>
        Effect.sync(() => {
          this.owners.delete(key);
        }),
    );
    return options?.waitSeconds === 0
      ? semaphore
          .withPermitsIfAvailable(1)(body)
          .pipe(
            Effect.flatMap((result) =>
              Effect.fromOption(result).pipe(
                Effect.mapError(() => new CrewError("LOCKED", `${key} is owned`)),
              ),
            ),
          )
      : semaphore.withPermits(1)(body);
  }
}
