import { verifyDiagrams } from "../workflow/diagrams.ts";
import { collectDiagrams } from "@abracode/contracts/presentation/diagrams";
import {
  bindingRequirements,
  selectBindingRows,
  type BindingCoverage,
} from "@abracode/contracts/web/bindings";
import { committedScope } from "../visibility/invalidations.ts";
import { canonicalJSON as stable, presentationHash as hash } from "../presentation/identity.ts";
import { PresentationAssociations } from "../presentation/associations.ts";
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
} from "../identities.ts";
import type { Store } from "../storage/store.ts";
import type { Locks } from "../storage/lock.ts";
import { SurfaceRecordSchema, PresentationAttachmentSchema } from "./workspace-wire.ts";
import { normalizeSurface, validateSurface, type WorkSurface } from "./surfaces.ts";
import { ComponentId } from "./catalog.ts";
import { WorkItemSchema } from "./wire.ts";
import { loadSurfaceRecord } from "./surface-records.ts";
import type { SurfaceRecord } from "./contracts.ts";

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
  pending: Schema.optional(PublicationSchema),
});
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
  constructor(
    private store: Store,
    private locks: Locks,
  ) {}
  private immutable(key: StorageKey, value: unknown) {
    return Effect.gen({ self: this }, function* () {
      const prior = yield* this.store.get(key);
      if (prior !== undefined) {
        if (stable(prior) !== stable(value))
          return yield* conflict("Retained presentation identity cannot be rebound");
      } else yield* this.store.set(key, value);
    });
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
      const session = record.session_id,
        surface = record.surface.createSurface.surfaceId;
      const identity = callHash(message_id, call_id);
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
        session_id: SessionId.make(session),
        message_id,
        tool_call_id: call_id,
        source: "tool",
        target: { kind: "surface", surface_id: surface, revision: record.revision },
      });
      const key = headKey(session, surface),
        raw = yield* this.store.get(key);
      const head = raw === undefined ? undefined : yield* decode(HeadSchema, raw, key);
      if (head && (head.session_id !== session || head.surface_id !== surface))
        return yield* conflict("Surface head belongs to another selection");
      if (head?.pending && head.pending.record.tool_call_id !== record.tool_call_id)
        return yield* conflict("Another presentation reservation needs reconciliation");
      yield* this.store.set(key, {
        schema_version: 1,
        session_id: session,
        surface_id: surface,
        next_revision: Math.max(head?.next_revision ?? 1, record.revision + 1),
      });
      yield* committedScope({ presentations: true });
    });
  }
  private recoverPending(session: SessionId, isolate = false) {
    return Effect.gen({ self: this }, function* () {
      const heads = yield* this.store.entries(StoragePrefix.make(`web/surface-head/${session}/`));
      const diagnostics: { surface_id: string; unavailable: string }[] = [];
      // There are at most sixteen surface heads per retained Abra session. No
      // publication-history scan is needed to repair a missing receipt/association.
      for (const row of heads) {
        const recovered = yield* Effect.gen({ self: this }, function* () {
          const head = yield* decode(HeadSchema, row.value, row.key);
          if (
            head.session_id !== session ||
            row.key !== headKey(session, head.surface_id) ||
            (head.pending &&
              (head.pending.record.session_id !== session ||
                head.pending.record.surface.createSurface.surfaceId !== head.surface_id))
          )
            return yield* conflict("Surface reservation belongs to another selection");
          if (head.pending) yield* this.commit(yield* this.publication(head.pending, row.key));
        }).pipe(Effect.result);
        if (recovered._tag === "Failure") {
          if (!isolate) return yield* recovered.failure;
          diagnostics.push({
            surface_id: row.key.split("/").at(-1) ?? "unavailable",
            unavailable: "Generated-view recovery is unavailable; retained evidence was preserved.",
          });
        }
      }
      return diagnostics;
    });
  }
  recover(session: SessionId) {
    return this.locks.with(LockKey.make("web-surfaces"), () => this.recoverPending(session, true));
  }
  associate(attachment: typeof PresentationAttachmentSchema.Type) {
    return new PresentationAssociations(this.store, this.locks).associate(attachment);
  }
  associations(session: SessionId, messages: readonly MessageId[]) {
    return new PresentationAssociations(this.store, this.locks).read(session, messages);
  }
  read(session: SessionId, surface: string, revision: number) {
    return Effect.gen({ self: this }, function* () {
      yield* decode(ComponentId, surface, "Surface selection");
      yield* decode(positive, revision, "Surface revision");
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
          record.session_id !== session ||
          record.surface.createSurface.surfaceId !== surface ||
          record.revision !== revision
        )
          return yield* conflict("Surface revision belongs to another selection");
        return record;
      }
      const raw = yield* this.store.get(latestKey(session, surface));
      const latest = loadSurfaceRecord(raw, latestKey(session, surface));
      if (
        !("unavailable" in latest) &&
        latest.session_id === session &&
        latest.revision === revision
      )
        return latest;
      return yield* new CrewError(
        "SURFACE_REVISION_UNAVAILABLE",
        "This exact layout revision was not retained. Legacy surfaces preserve only their latest known layout.",
      );
    });
  }
  readCurrent(session: SessionId, surface: string, revision: number) {
    return Effect.gen({ self: this }, function* () {
      const record = yield* this.read(session, surface, revision);
      const latest = loadSurfaceRecord(
        yield* this.store.get(latestKey(session, surface)),
        latestKey(session, surface),
      );
      if (
        "unavailable" in latest ||
        latest.revision !== revision ||
        latest.tool_call_id !== record.tool_call_id
      )
        return yield* conflict("The observed surface revision changed; reopen it before saving");
      return record;
    });
  }
  publish(
    input: { session_id: SessionId; message_id: MessageId; call_id: string; surface: WorkSurface },
    observe: Effect.Effect<
      {
        at: Timestamp;
        work: readonly (typeof WorkItemSchema.Type)[];
        binding_coverage?: BindingCoverage;
      },
      CrewError
    >,
  ) {
    return this.locks.with(LockKey.make("web-surfaces"), () =>
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
            rawHead === undefined ? undefined : yield* decode(HeadSchema, rawHead, "Surface head");
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
          const snapshot = yield* observe;
          yield* Effect.try({
            try: () =>
              validateSurface(surface, new Set(snapshot.work.map((work) => work.issue_id))),
            catch: () => new CrewError("UI_SURFACE", "Surface references unavailable work"),
          });
          yield* verifyDiagrams(collectDiagrams(surface.createSurface.components));
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
          const revision = Math.max(head?.next_revision ?? 1, previous ? previous.revision + 1 : 1);
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
          yield* this.store.set(headKey(input.session_id, id), {
            schema_version: 1,
            session_id: input.session_id,
            surface_id: id,
            next_revision: revision + 1,
            pending: publication,
          });
          yield* this.commit(publication);
          return { surface_id: id, revision, version: "1.0" as const };
        }),
      ),
    );
  }
}
