import { Effect } from "effect";
import { LockKey, StorageKey, StoragePrefix, type SessionId } from "@abracode/contracts/identities";
import type {
  PresentationAttachmentSchema,
  PresentationDiagnosticSchema,
} from "@abracode/contracts/presentation/contracts";
import { CrewError } from "../domain.ts";
import type { Store } from "../storage/store.ts";
import type { Locks } from "../storage/lock.ts";
import { canonicalJSON } from "../presentation/identity.ts";
import { PresentationAssociations } from "../presentation/associations.ts";
import { committedScope } from "../visibility/invalidations.ts";

export type AttachmentEntry = typeof PresentationAttachmentSchema.Type;
export type AttachmentDiagnostic = typeof PresentationDiagnosticSchema.Type;
export type AttachmentPage = {
  entries: AttachmentEntry[];
  diagnostics: AttachmentDiagnostic[];
  truncated: boolean;
};

export interface PublicationStoreConfig {
  readonly store: Store;
  readonly locks: Locks;
  readonly associations?: PresentationAssociations;
  readonly lockKey: LockKey;
  readonly conflict: (message: string) => CrewError;
  readonly headPrefix: (session: SessionId) => StoragePrefix;
  readonly headKey: (session: SessionId, id: string) => StorageKey;
  readonly maxHeads?: number;
}

/** Shared two-phase publication store (reserve pending head -> write immutable records ->
 * associate presentation -> advance committed head -> bounded startup recovery). */
export class PublicationStore {
  readonly store: Store;
  readonly locks: Locks;
  readonly associations: PresentationAssociations;
  private readonly lockKey: LockKey;
  private readonly conflict: (message: string) => CrewError;
  private readonly headPrefixFn: (session: SessionId) => StoragePrefix;
  private readonly headKeyFn: (session: SessionId, id: string) => StorageKey;
  private readonly maxHeads?: number;

  constructor(config: PublicationStoreConfig) {
    this.store = config.store;
    this.locks = config.locks;
    this.associations =
      config.associations ?? new PresentationAssociations(config.store, config.locks);
    this.lockKey = config.lockKey;
    this.conflict = config.conflict;
    this.headPrefixFn = config.headPrefix;
    this.headKeyFn = config.headKey;
    this.maxHeads = config.maxHeads;
  }

  headPrefix(session: SessionId) {
    return this.headPrefixFn(session);
  }

  headKey(session: SessionId, id: string) {
    return this.headKeyFn(session, id);
  }

  withLock<A, E>(run: () => Effect.Effect<A, E>) {
    return this.locks.with(this.lockKey, run);
  }

  /** Write-once immutable record; rebinding an existing key to different canonical content fails. */
  immutable(key: StorageKey, value: unknown, conflictMessage: string) {
    return Effect.gen({ self: this }, function* () {
      const prior = yield* this.store.get(key);
      if (prior !== undefined) {
        if (canonicalJSON(prior) !== canonicalJSON(value))
          return yield* this.conflict(conflictMessage);
      } else {
        yield* this.store.set(key, value);
      }
    });
  }

  readHead<H>(
    session: SessionId,
    id: string,
    decodeHead: (raw: unknown) => Effect.Effect<H, CrewError>,
  ) {
    return Effect.gen({ self: this }, function* () {
      const raw = yield* this.store.get(this.headKeyFn(session, id));
      return raw === undefined ? undefined : yield* decodeHead(raw);
    });
  }

  /** Phase 1 (write pending reservation onto head) followed immediately by Phase 2 (commit). */
  reserveAndCommit<R>(
    session: SessionId,
    id: string,
    pendingHead: unknown,
    commit: () => Effect.Effect<R, CrewError>,
  ) {
    return Effect.gen({ self: this }, function* () {
      yield* this.store.set(this.headKeyFn(session, id), pendingHead);
      return yield* commit();
    });
  }

  /** Finalize Phase 2: write the committed head (clearing `pending`), run optional cleanup, and emit invalidation. */
  finalizeHead(
    session: SessionId,
    id: string,
    committedHead: unknown,
    afterCommit?: () => Effect.Effect<void, CrewError>,
  ) {
    return Effect.gen({ self: this }, function* () {
      yield* this.store.set(this.headKeyFn(session, id), committedHead);
      if (afterCommit) yield* afterCommit();
      yield* committedScope({ presentations: true });
    });
  }

  /** Bounded recovery scan over retained heads for a session. */
  recover<H, P, D = void>(
    session: SessionId,
    options: {
      decodeHead: (
        rawId: string,
        raw: unknown,
        key: StorageKey,
      ) => Effect.Effect<{ head: H; pending?: P }, CrewError>;
      commit: (pending: P, key: StorageKey) => Effect.Effect<unknown, CrewError>;
      onClean?: (rawId: string, head: H) => Effect.Effect<void, CrewError>;
      onFailure?: (rawId: string, error: CrewError) => Effect.Effect<D | undefined, never>;
      isolate?: boolean;
    },
  ) {
    return Effect.gen({ self: this }, function* () {
      const prefix = this.headPrefixFn(session);
      const rows = yield* this.store.entries(prefix);
      const bounded = this.maxHeads !== undefined ? rows.slice(0, this.maxHeads) : rows;
      const diagnostics: D[] = [];
      for (const row of bounded) {
        const rawId = row.key.slice(prefix.length);
        const result = yield* Effect.gen(function* () {
          const decoded = yield* options.decodeHead(rawId, row.value, row.key);
          if (decoded.pending !== undefined) yield* options.commit(decoded.pending, row.key);
          else if (options.onClean) yield* options.onClean(rawId, decoded.head);
        }).pipe(Effect.result);
        if (result._tag === "Failure") {
          if (!options.isolate) return yield* result.failure;
          const diagnostic = options.onFailure
            ? yield* options.onFailure(rawId, result.failure)
            : undefined;
          if (diagnostic !== undefined) diagnostics.push(diagnostic);
        }
      }
      return diagnostics;
    });
  }

  /** Filter an attachment page by verifying entries of `kind` against committed publications. */
  filterAttachments<K extends AttachmentEntry["target"]["kind"]>(
    page: AttachmentPage,
    kind: K,
    verify: (
      entry: AttachmentEntry & { target: Extract<AttachmentEntry["target"], { kind: K }> },
    ) => Effect.Effect<"keep" | "skip" | "diagnostic", never>,
    unavailableMessage: string,
  ): Effect.Effect<AttachmentPage> {
    return Effect.gen(function* () {
      const entries: AttachmentEntry[] = [];
      const diagnostics = [...page.diagnostics];
      for (const entry of page.entries) {
        if (entry.target.kind !== kind) {
          entries.push(entry);
          continue;
        }
        const decision = yield* verify(
          entry as AttachmentEntry & { target: Extract<AttachmentEntry["target"], { kind: K }> },
        );
        if (decision === "keep") entries.push(entry);
        else if (decision === "diagnostic")
          diagnostics.push({ message_id: entry.message_id, unavailable: unavailableMessage });
      }
      return { entries, diagnostics: diagnostics.slice(0, 200), truncated: page.truncated };
    });
  }
}
