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
import { committedScope } from "../invalidations.ts";

export type AttachmentEntry = typeof PresentationAttachmentSchema.Type;
export type AttachmentDiagnostic = typeof PresentationDiagnosticSchema.Type;
export type AttachmentPage = {
  entries: AttachmentEntry[];
  diagnostics: AttachmentDiagnostic[];
  truncated: boolean;
};

export interface PublicationStoreConfig<H> {
  readonly store: Store;
  readonly locks: Locks;
  readonly associations?: PresentationAssociations;
  readonly lockKey: LockKey;
  readonly conflict: (message: string) => CrewError;
  readonly headPrefix: (session: SessionId) => StoragePrefix;
  readonly headKey: (session: SessionId, id: string) => StorageKey;
  readonly maxHeads: number;
  readonly limit: () => CrewError;
  readonly decodeHead: (
    session: SessionId,
    id: string,
    raw: unknown,
  ) => Effect.Effect<H, CrewError>;
}

/** Shared two-phase publication store (reserve pending head -> write immutable records ->
 * associate presentation -> advance committed head -> bounded startup recovery). */
export class PublicationStore<H extends { pending?: unknown }> {
  readonly associations: PresentationAssociations;
  constructor(private config: PublicationStoreConfig<H>) {
    this.associations =
      config.associations ?? new PresentationAssociations(config.store, config.locks);
  }

  withLock<A, E>(run: () => Effect.Effect<A, E>) {
    return this.config.locks.with(this.config.lockKey, run);
  }

  private rows(prefix: StoragePrefix) {
    const { store, maxHeads } = this.config;
    if (!store.page)
      return store.entries(prefix).pipe(Effect.map((rows) => rows.slice(0, maxHeads)));
    const page = store.page.bind(store);
    return Effect.gen(function* () {
      const rows: { key: StorageKey; value: unknown }[] = [];
      let after: string | undefined;
      do {
        const result = yield* page(prefix, after, maxHeads - rows.length);
        rows.push(...result.entries);
        after = result.next;
      } while (after && rows.length < maxHeads);
      return rows;
    });
  }

  heads(session: SessionId) {
    const prefix = this.config.headPrefix(session);
    return this.rows(prefix).pipe(
      Effect.map((rows) =>
        rows.map(({ key, value }) => {
          const id = key.slice(prefix.length);
          return { id, key, read: this.config.decodeHead(session, id, value) };
        }),
      ),
    );
  }

  legacyIds(prefix: StoragePrefix) {
    return this.rows(prefix).pipe(
      Effect.map((rows) => rows.map((row) => row.key.slice(prefix.length))),
    );
  }

  headForPublication(session: SessionId, id: string) {
    return this.readHead(session, id).pipe(
      Effect.tap((head) =>
        head
          ? Effect.void
          : this.rows(this.config.headPrefix(session)).pipe(
              Effect.flatMap((rows) =>
                rows.length >= this.config.maxHeads
                  ? Effect.fail(this.config.limit())
                  : Effect.void,
              ),
            ),
      ),
    );
  }

  /** Write-once immutable record; rebinding an existing key to different canonical content fails. */
  immutable(key: StorageKey, value: unknown, conflictMessage: string) {
    return Effect.gen({ self: this }, function* () {
      const prior = yield* this.config.store.get(key);
      if (prior !== undefined) {
        if (canonicalJSON(prior) !== canonicalJSON(value))
          return yield* this.config.conflict(conflictMessage);
      } else {
        yield* this.config.store.set(key, value);
      }
    });
  }

  readHead(session: SessionId, id: string) {
    return this.config.store
      .get(this.config.headKey(session, id))
      .pipe(
        Effect.flatMap((raw) =>
          raw === undefined ? Effect.undefined : this.config.decodeHead(session, id, raw),
        ),
      );
  }

  /** Phase 1 (write pending reservation onto head) followed immediately by Phase 2 (commit). */
  reserveAndCommit<R>(
    session: SessionId,
    id: string,
    pendingHead: H,
    commit: () => Effect.Effect<R, CrewError>,
  ) {
    return Effect.gen({ self: this }, function* () {
      yield* this.config.store.set(this.config.headKey(session, id), pendingHead);
      return yield* commit();
    });
  }

  /** Finalize Phase 2: write the committed head (clearing `pending`), run optional cleanup, and emit invalidation. */
  finalizeHead(
    session: SessionId,
    id: string,
    committedHead: H,
    afterCommit?: () => Effect.Effect<void, CrewError>,
  ) {
    return Effect.gen({ self: this }, function* () {
      yield* this.config.store.set(this.config.headKey(session, id), committedHead);
      if (afterCommit) yield* afterCommit();
      yield* committedScope({ presentations: true });
    });
  }

  /** Bounded recovery scan over retained heads for a session. */
  recover<D = void>(
    session: SessionId,
    options: {
      commit: (
        pending: NonNullable<H["pending"]>,
        key: StorageKey,
      ) => Effect.Effect<unknown, CrewError>;
      onClean?: (rawId: string, head: H) => Effect.Effect<void, CrewError>;
      onFailure?: (rawId: string, error: CrewError) => Effect.Effect<D | undefined, never>;
      isolate?: boolean;
    },
  ) {
    return Effect.gen({ self: this }, function* () {
      const diagnostics: D[] = [];
      for (const row of yield* this.heads(session)) {
        const rawId = row.id;
        const result = yield* Effect.gen(function* () {
          const head = yield* row.read;
          if (head.pending != null) yield* options.commit(head.pending, row.key);
          else if (options.onClean) yield* options.onClean(rawId, head);
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
