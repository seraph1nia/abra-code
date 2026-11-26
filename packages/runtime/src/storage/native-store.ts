import { StorageError } from "../errors.ts";
import { StorageKey, StoragePrefix } from "@abracode/contracts/identities";
import { type StorageDomain } from "@opencode/plugin/effect/storage";
import { Effect, type Schema } from "effect";
import { CrewError } from "../domain.ts";

export interface PagedStore {
  page(
    prefix: StoragePrefix,
    after: string | undefined,
    limit: number,
  ): Effect.Effect<
    {
      entries: Array<{ key: StorageKey; value: unknown }>;
      next?: string;
    },
    CrewError
  >;
}

export interface Store extends Partial<PagedStore> {
  get(key: StorageKey): Effect.Effect<unknown, CrewError>;
  set<T>(key: StorageKey, value: T): Effect.Effect<void, CrewError>;
  entries(
    prefix: StoragePrefix,
  ): Effect.Effect<Array<{ key: StorageKey; value: unknown }>, CrewError>;
}

function hasToJSON(value: object): value is { toJSON: () => unknown } {
  return "toJSON" in value && typeof (value as { toJSON?: unknown }).toJSON === "function";
}

function isOmittedPropertyValue(value: unknown): boolean {
  return value === undefined || typeof value === "function" || typeof value === "symbol";
}

/**
 * Normalize an arbitrary JS value into a JSON-safe structure in a single pass
 * without a full JSON.stringify + JSON.parse roundtrip.
 */
function normalizeJsonValue(value: unknown, key: StorageKey, seen: Set<object>): Schema.Json {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (
    value === undefined ||
    typeof value === "function" ||
    typeof value === "symbol" ||
    typeof value === "bigint"
  ) {
    throw new StorageError("INVALID_RECORD", `Cannot encode ${key}`);
  }
  if (typeof value !== "object") throw new StorageError("INVALID_RECORD", `Cannot encode ${key}`);

  if (seen.has(value)) throw new StorageError("INVALID_RECORD", `Cannot encode ${key}`);
  seen.add(value);
  try {
    if (hasToJSON(value)) {
      const converted = value.toJSON();
      return normalizeJsonValue(converted, key, seen);
    }
    if (Array.isArray(value)) {
      const result: Schema.Json[] = [];
      for (const element of value) {
        result.push(
          isOmittedPropertyValue(element) ? null : normalizeJsonValue(element, key, seen),
        );
      }
      return result;
    }
    const result: Record<string, Schema.Json> = {};
    for (const [prop, propValue] of Object.entries(value)) {
      if (isOmittedPropertyValue(propValue)) continue;
      result[prop] = normalizeJsonValue(propValue, key, seen);
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

export class NativeStore implements Store {
  constructor(private storage: StorageDomain) {}
  get(key: StorageKey) {
    return this.storage.get(key);
  }
  set<T>(key: StorageKey, value: T) {
    return Effect.gen({ self: this }, function* () {
      const json = yield* Effect.try({
        try: () => normalizeJsonValue(value, key, new Set()),
        catch: (error) =>
          error instanceof CrewError
            ? error
            : new StorageError("INVALID_RECORD", `Cannot encode ${key}`),
      });
      yield* this.storage.set(key, json).pipe(Effect.uninterruptible);
    });
  }
  page(prefix: StoragePrefix, after: string | undefined, limit: number) {
    return this.storage.scan({ prefix, after, limit }).pipe(
      Effect.map((page) => ({
        entries: page.entries.map((entry) => ({ ...entry, key: StorageKey.make(entry.key) })),
        next: page.next,
      })),
    );
  }
  entries(prefix: StoragePrefix) {
    return Effect.gen({ self: this }, function* () {
      const result: Array<{ key: StorageKey; value: unknown }> = [];
      let after: string | undefined;
      do {
        const page = yield* this.storage.scan({ prefix, after, limit: 100 });
        result.push(
          ...page.entries.map((entry) => ({ ...entry, key: StorageKey.make(entry.key) })),
        );
        after = page.next;
      } while (after);
      return result;
    });
  }
}
