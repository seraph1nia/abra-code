import { verifyDiagrams } from "../reporting/diagrams.ts";
import { collectDiagrams } from "@abracode/contracts/presentation/diagrams";
import {
  bindingRequirements,
  selectBindingRows,
  type BindingCoverage,
} from "@abracode/contracts/web/bindings";
import { presentationHash as hash } from "../presentation/identity.ts";
import type { PresentationAssociations } from "../presentation/associations.ts";
import { createHash } from "node:crypto";
import { Effect, Schema } from "effect";
import { CrewError } from "../domain.ts";
import { decode } from "../decode.ts";
import { domainEffect } from "../effect.ts";
import {
  ContentHash,
  LockKey,
  MessageId,
  SessionId,
  StorageKey,
  StoragePrefix,
  type Timestamp,
} from "@abracode/contracts/identities";
import type { Store } from "../storage/store.ts";
import type { Locks } from "../storage/lock.ts";
import {
  SurfaceRecordSchema,
  PresentationAttachmentSchema,
} from "@abracode/contracts/web/workspace-wire";
import {
  normalizeSurface,
  validateSurface,
  type WorkSurface,
} from "@abracode/contracts/web/surfaces";
import { ComponentId } from "@abracode/contracts/web/catalog";
import { WorkItemSchema } from "@abracode/contracts/web/wire";
import { compactSurface, loadSurfaceRecord, observedSurface } from "./surface-records.ts";
import type { SurfaceRecord } from "./contracts.ts";
import { PublicationStore } from "./publication-store.ts";

type SurfaceObservation = Effect.Effect<
  {
    at: Timestamp;
    work: readonly (typeof WorkItemSchema.Type)[];
    binding_coverage?: BindingCoverage;
  },
  CrewError
>;

/** Check content against this observation before capturing it in a new revision. */
export function checkSurfaceDraft(surface: WorkSurface, observe: SurfaceObservation) {
  return Effect.gen(function* () {
    const snapshot = yield* observe;
    yield* Effect.try({
      try: () => validateSurface(surface, new Set(snapshot.work.map((work) => work.issue_id))),
      catch: (error) => new CrewError("UI_SURFACE", CrewError.from(error).message),
    });
    yield* verifyDiagrams(collectDiagrams(surface.createSurface.components));
    return snapshot;
  });
}

const positive = Schema.Int.check(Schema.isGreaterThan(0));
const PublicationSchema = Schema.Struct({
  schema_version: Schema.Literal(1),
  input_hash: ContentHash,
  record_hash: ContentHash,
  message_id: MessageId,
  call_id: Schema.String,
  record: SurfaceRecordSchema,
});
const HeadSchema = Schema.Struct({
  schema_version: Schema.Literal(1),
  session_id: SessionId,
  surface_id: ComponentId,
  next_revision: positive,
  committed_revision: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  pending: Schema.optional(PublicationSchema),
});
function decodeHead(raw: unknown, session: string, surface: string) {
  return Effect.gen(function* () {
    const head = yield* decode(HeadSchema, raw, headKey(session, surface));
    const reserved = head.next_revision - 1;
    const committed = head.committed_revision ?? (head.pending ? reserved - 1 : reserved);
    if (
      head.session_id !== session ||
      head.surface_id !== surface ||
      committed < 0 ||
      committed !== (head.pending ? reserved - 1 : reserved) ||
      (head.pending &&
        (head.pending.record.revision !== reserved ||
          head.pending.record.session_id !== session ||
          head.pending.record.surface.createSurface.surfaceId !== surface))
    )
      return yield* conflict("Invalid committed surface head");
    return { ...head, committed_revision: committed };
  });
}
const RevisionSchema = Schema.Struct({ publication: ContentHash });
const LegacyReceiptSchema = Schema.Struct({
  surface_id: ComponentId,
  revision: positive,
  input_hash: ContentHash,
});
type Publication = typeof PublicationSchema.Type;

const callHash = (message: string, call: string) =>
  ContentHash.make(createHash("sha256").update(`${message}/${call}`).digest("hex"));
const publicationKey = (session: string, id: ContentHash) =>
  StorageKey.make(`web/surface-publication/${session}/${id}`);
const headKey = (session: string, surface: string) =>
  StorageKey.make(`web/surface-head/${session}/${surface}`);
const latestKey = (session: string, surface: string) =>
  StorageKey.make(`web/surface/${session}/${surface}`);
const revisionKey = (session: string, surface: string, revision: number) =>
  StorageKey.make(`web/surface-revision/${session}/${surface}/${revision}`);
const receiptKey = (session: string, id: ContentHash) =>
  StorageKey.make(`web/surface-call/${session}/${id}`);
const conflict = (message: string) => new CrewError("UI_SURFACE_CONFLICT", message);

/** One owner for immutable layout publication and its repairable indexes.
 * Reads never repair or publish. Native startup/retry performs bounded recovery. */
export class SurfacePublications {
  private readonly publications: PublicationStore;
  constructor(
    private store: Store,
    locks: Locks,
    associations?: PresentationAssociations,
  ) {
    this.publications = new PublicationStore({
      store,
      locks,
      associations,
      lockKey: LockKey.make("web-surfaces"),
      conflict,
      headPrefix: (session) => StoragePrefix.make(`web/surface-head/${session}/`),
      headKey,
    });
  }
  private immutable(key: StorageKey, value: unknown) {
    return this.publications.immutable(
      key,
      value,
      "Retained presentation identity cannot be rebound",
    );
  }
  private publication(value: unknown, key: string) {
    return Effect.gen(function* () {
      const record = yield* decode(PublicationSchema, value, key);
      if (
        hash(record.record) !== record.record_hash ||
        record.record.message_id !== record.message_id ||
        record.record.tool_call_id !== `${record.message_id}/${record.call_id}` ||
        record.input_hash !== hash(record.record.surface)
      )
        return yield* conflict("Retained presentation integrity or source identity does not match");
      return record;
    });
  }
  private commit(publication: Publication) {
    return Effect.gen({ self: this }, function* () {
      const { record, message_id, call_id } = publication;
      const session = SessionId.make(record.session_id),
        surface = record.surface.createSurface.surfaceId;
      const identity = callHash(message_id, call_id);
      const head = yield* this.publications.readHead(session, surface, (raw) =>
        decodeHead(raw, session, surface),
      );
      if (head?.pending && head.pending.record.tool_call_id !== record.tool_call_id)
        return yield* conflict("Another presentation reservation needs reconciliation");
      yield* this.immutable(publicationKey(session, identity), publication);
      yield* this.immutable(revisionKey(session, surface, record.revision), {
        publication: identity,
      });
      yield* this.immutable(receiptKey(session, identity), {
        surface_id: surface,
        revision: record.revision,
        input_hash: publication.input_hash,
      });
      const current = yield* this.store.get(latestKey(session, surface));
      if (current === undefined) yield* this.store.set(latestKey(session, surface), record);
      else {
        const latest = loadSurfaceRecord(current, latestKey(session, surface));
        if ("unavailable" in latest)
          return yield* conflict("Retained latest surface is unavailable; preserve its evidence");
        if (latest.revision < record.revision)
          yield* this.store.set(latestKey(session, surface), record);
        else if (latest.revision === record.revision && latest.tool_call_id !== record.tool_call_id)
          return yield* conflict("Surface revision is already owned by another native call");
      }
      yield* this.associate({
        session_id: session,
        message_id,
        tool_call_id: call_id,
        source: "tool",
        target: { kind: "surface", surface_id: surface, revision: record.revision },
      });
      yield* this.publications.finalizeHead(session, surface, {
        schema_version: 1,
        session_id: session,
        surface_id: surface,
        next_revision: Math.max(head?.next_revision ?? 1, record.revision + 1),
        committed_revision: Math.max(head?.committed_revision ?? 0, record.revision),
      });
    });
  }
  private recoverPending(session: SessionId, isolate = false) {
    // There are at most sixteen surface heads per retained Abra session. No
    // publication-history scan is needed to repair a missing receipt/association.
    return this.publications.recover(session, {
      isolate,
      decodeHead: (surface, raw) =>
        decodeHead(raw, session, surface).pipe(
          Effect.map((head) => ({ head, pending: head.pending })),
        ),
      commit: (pending, key) =>
        this.publication(pending, key).pipe(Effect.flatMap((pub) => this.commit(pub))),
      onFailure: (surface) =>
        Effect.succeed({
          surface_id: surface || "unavailable",
          unavailable: "Generated-view recovery is unavailable; retained evidence was preserved.",
        }),
    });
  }
  recover(session: SessionId) {
    return this.publications.withLock(() => this.recoverPending(session, true));
  }
  associate(attachment: typeof PresentationAttachmentSchema.Type) {
    return this.publications.associations.associate(attachment);
  }
  associations(session: SessionId, messages: readonly MessageId[]) {
    return Effect.gen({ self: this }, function* () {
      const page = yield* this.publications.associations.read(session, messages);
      return yield* this.publications.filterAttachments(
        page,
        "surface",
        (entry) =>
          this.read(session, entry.target.surface_id, entry.target.revision).pipe(
            Effect.result,
            Effect.map((record) => {
              if (
                record._tag === "Success" &&
                record.success.message_id === entry.message_id &&
                record.success.tool_call_id === `${entry.message_id}/${entry.tool_call_id}`
              )
                return "keep" as const;
              return record._tag === "Failure" &&
                record.failure.code === "SURFACE_REVISION_UNAVAILABLE"
                ? ("skip" as const)
                : ("diagnostic" as const);
            }),
          ),
        "Surface attachment has no confirmed publication.",
      );
    });
  }
  searchCommitted(session: SessionId, surface: string, revision: number) {
    return this.committedRevision(session, surface, true).pipe(
      Effect.map((head) => revision <= head),
    );
  }
  private committedRevision(session: SessionId, surface: string, metadataOnly = false) {
    return Effect.gen({ self: this }, function* () {
      yield* decode(ComponentId, surface, "Surface selection");
      const key = headKey(session, surface);
      const raw = yield* this.store.get(key);
      if (raw === undefined) {
        if (metadataOnly) return yield* conflict("Surface association has no committed head");
        const latest = yield* this.store.get(latestKey(session, surface));
        if (latest === undefined) return 0;
        // A publisher may have reserved the first revision between these two reads.
        const reserved = yield* this.store.get(key);
        if (reserved !== undefined)
          return (yield* decodeHead(reserved, session, surface)).committed_revision;
        const record = loadSurfaceRecord(latest, key);
        if (
          "unavailable" in record ||
          record.session_id !== session ||
          record.surface.createSurface.surfaceId !== surface ||
          record.history !== "latest-only"
        )
          return yield* conflict("Missing or invalid committed surface head");
        return record.revision;
      }
      return (yield* decodeHead(raw, session, surface)).committed_revision;
    });
  }
  list(session: SessionId) {
    return Effect.gen({ self: this }, function* () {
      const prefix = StoragePrefix.make(`web/surface/${session}/`);
      const rows = yield* this.store.entries(prefix);
      const entries = [];
      for (const row of rows) {
        const id = row.key.slice(prefix.length);
        const observed = yield* Effect.gen({ self: this }, function* () {
          const revision = yield* this.committedRevision(session, id);
          if (revision) return compactSurface(yield* this.rawRecord(session, id, revision));
        }).pipe(Effect.result);
        if (observed._tag === "Failure")
          entries.push({ surface_id: id, unavailable: observed.failure.message });
        else if (observed.success) entries.push(observed.success);
      }
      return entries;
    });
  }
  private rawRecord(session: SessionId, surface: string, revision: number) {
    return Effect.gen({ self: this }, function* () {
      const key = revisionKey(session, surface, revision),
        index = yield* this.store.get(key);
      if (index !== undefined) {
        const reference = yield* decode(RevisionSchema, index, key);
        const publication = yield* this.publication(
          yield* this.store.get(publicationKey(session, reference.publication)),
          key,
        );
        const record = publication.record;
        if (
          callHash(publication.message_id, publication.call_id) !== reference.publication ||
          record.session_id !== session ||
          record.surface.createSurface.surfaceId !== surface ||
          record.revision !== revision
        )
          return yield* conflict("Surface revision belongs to another selection");
        return observedSurface(record, publication.input_hash);
      }
      const raw =
        (yield* this.store.get(
          StorageKey.make(`web/surface-legacy/${session}/${surface}/${revision}`),
        )) ?? (yield* this.store.get(latestKey(session, surface)));
      const latest = loadSurfaceRecord(raw, latestKey(session, surface));
      if (
        !("unavailable" in latest) &&
        latest.history === "latest-only" &&
        latest.session_id === session &&
        latest.surface.createSurface.surfaceId === surface &&
        latest.revision === revision
      )
        return observedSurface(latest);
      return yield* new CrewError(
        "SURFACE_REVISION_UNAVAILABLE",
        "This exact layout revision was not retained. Legacy surfaces preserve only their latest known layout.",
      );
    });
  }
  read(session: SessionId, surface: string, revision: number) {
    return Effect.gen({ self: this }, function* () {
      yield* decode(positive, revision, "Surface revision");
      if (revision > (yield* this.committedRevision(session, surface)))
        return yield* new CrewError(
          "SURFACE_REVISION_UNAVAILABLE",
          "This exact layout revision was not retained or its publication is pending.",
        );
      return yield* this.rawRecord(session, surface, revision);
    });
  }
  readCurrent(session: SessionId, surface: string, revision: number) {
    return Effect.gen({ self: this }, function* () {
      if (!revision || revision !== (yield* this.committedRevision(session, surface)))
        return yield* conflict("The observed surface revision changed; reopen it before saving");
      return yield* this.rawRecord(session, surface, revision);
    });
  }
  publish(
    input: { session_id: SessionId; message_id: MessageId; call_id: string; surface: WorkSurface },
    observe: SurfaceObservation,
  ) {
    return this.publications.withLock(() =>
      domainEffect(
        Effect.gen({ self: this }, function* () {
          yield* this.recoverPending(input.session_id);
          const surface = yield* Effect.try({
            try: () => normalizeSurface(input.surface),
            catch: () => new CrewError("UI_SURFACE", "Invalid surface layout"),
          });
          const identity = callHash(input.message_id, input.call_id),
            key = publicationKey(input.session_id, identity);
          const inputHash = hash(surface),
            prior = yield* this.store.get(key);
          if (prior !== undefined) {
            const publication = yield* this.publication(prior, key);
            if (publication.input_hash !== inputHash)
              return yield* conflict("Native tool call identity is bound to another surface");
            yield* this.commit(publication);
            return {
              surface_id: publication.record.surface.createSurface.surfaceId,
              revision: publication.record.revision,
              version: "1.0" as const,
            };
          }
          const legacy = yield* this.store.get(receiptKey(input.session_id, identity));
          if (legacy !== undefined) {
            const receipt = yield* decode(LegacyReceiptSchema, legacy, "Legacy surface receipt");
            // Old receipts hashed JSON directly, before canonical key ordering.
            const oldHash = createHash("sha256").update(JSON.stringify(surface)).digest("hex");
            if (receipt.input_hash !== inputHash && receipt.input_hash !== oldHash)
              return yield* conflict(
                "Legacy native tool call identity is bound to different input",
              );
            return {
              surface_id: receipt.surface_id,
              revision: receipt.revision,
              version: "1.0" as const,
            };
          }
          const id = surface.createSurface.surfaceId,
            latest = yield* this.store.get(latestKey(input.session_id, id));
          const rawHead = yield* this.store.get(headKey(input.session_id, id));
          const head =
            rawHead === undefined ? undefined : yield* decodeHead(rawHead, input.session_id, id);
          const previous =
            latest === undefined
              ? undefined
              : loadSurfaceRecord(latest, latestKey(input.session_id, id));
          if (previous && "unavailable" in previous)
            return yield* conflict("Previous surface is unavailable; preserve its evidence");
          if (latest === undefined && rawHead === undefined) {
            const retained = yield* this.store.entries(
              StoragePrefix.make(`web/surface/${input.session_id}/`),
            );
            if (retained.length >= 16)
              return yield* new CrewError(
                "UI_SURFACE_LIMIT",
                "At most 16 retained surfaces per Abra conversation",
              );
          }
          const snapshot = yield* checkSurfaceDraft(surface, observe);
          const selected = selectBindingRows(
            bindingRequirements(surface),
            snapshot.work,
            snapshot.binding_coverage?.total,
          );
          const captured = yield* decode(
            Schema.Array(WorkItemSchema),
            selected.rows,
            "Surface observations",
          );
          if (head && previous && previous.revision !== head.committed_revision)
            return yield* conflict("Latest layout and committed surface head disagree");
          const committed = head?.committed_revision ?? previous?.revision ?? 0;
          const revision = committed + 1;
          const record: SurfaceRecord = {
            session_id: input.session_id,
            message_id: input.message_id,
            tool_call_id: `${input.message_id}/${input.call_id}`,
            history: "immutable",
            revision,
            at: snapshot.at,
            surface,
            snapshot: captured,
            coverage: {
              ...selected.coverage,
              ...(snapshot.binding_coverage ? { status: snapshot.binding_coverage.status } : {}),
            },
          };
          const publication: Publication = {
            schema_version: 1,
            input_hash: inputHash,
            record_hash: hash(record),
            message_id: input.message_id,
            call_id: input.call_id,
            record,
          };
          if (previous?.history === "latest-only")
            yield* this.immutable(
              StorageKey.make(`web/surface-legacy/${input.session_id}/${id}/${previous.revision}`),
              previous,
            );
          yield* this.publications.reserveAndCommit(
            input.session_id,
            id,
            {
              schema_version: 1,
              session_id: input.session_id,
              surface_id: id,
              next_revision: revision + 1,
              committed_revision: committed,
              pending: publication,
            },
            () => this.commit(publication),
          );
          return { surface_id: id, revision, version: "1.0" as const };
        }),
      ),
    );
  }
}
