import { Effect, Schema } from "effect";
import {
  ReviewPublishSchema,
  ReviewRecordSchema,
  ReviewSelectionSchema,
  ReviewSubmitSchema,
  ReviewResponseQuerySchema,
  reviewAnswerErrors,
  reviewReference,
  type ReviewSource,
  type ReviewRecord,
  type ReviewSelection,
  type ReviewSubmit,
} from "@abracode/contracts/web/reviews";
import { ReceiptSchema, type SubmissionReceipt } from "@abracode/contracts/web/workspace-wire";
import {
  AbsolutePath,
  ContentHash,
  LockKey,
  MessageId,
  SessionId,
  StorageKey,
  StoragePrefix,
  timestamp,
} from "@abracode/contracts/identities";
import { CrewError } from "../domain.ts";
import { decode } from "../decode.ts";
import { domainEffect } from "../effect.ts";
import type { Store } from "../storage/store.ts";
import type { Locks } from "../storage/lock.ts";
import { canonicalJSON, presentationHash } from "../presentation/identity.ts";
import { SurfacePublications } from "./surface-publications.ts";
import { PresentationAssociations } from "../presentation/associations.ts";
import { committedScope } from "../visibility/invalidations.ts";
import { PublicationStore } from "./publication-store.ts";
import { ReviewAssets } from "./review-assets.ts";
const fail = (message: string) => new CrewError("REVIEW_REFUSED", message);
const PublicationSchema = Schema.Struct({ record: ReviewRecordSchema, input_hash: ContentHash });
const HeadSchema = Schema.Struct({
  schema_version: Schema.Literal(1),
  committed: Schema.optionalKey(ReviewSelectionSchema),
  pending: Schema.optionalKey(PublicationSchema),
});
type Head = typeof HeadSchema.Type;
type Publication = typeof PublicationSchema.Type;
type ReviewID = ReviewSelection["review_id"];
export type CommittedReview = ReturnType<typeof reviewReference>;
const ResponseSchema = Schema.Struct({
  input: ReviewSubmitSchema,
  text: Schema.String.check(Schema.isMaxLength(32768)),
});
const key = (session: string, suffix: string) => StorageKey.make(`web/review/${session}/${suffix}`);
const recordHash = (record: Omit<ReviewRecord, "hash">) => presentationHash(record);
const unsigned = ({ hash: _hash, ...record }: ReviewRecord) => record;
export type ReviewSourceReader = (
  session: SessionId,
  source: ReviewSource,
) => Effect.Effect<{ text: string; root?: AbsolutePath }, CrewError>;
export interface ReviewAdmissions {
  submit(
    session: SessionId,
    input: { request_id: string; text: string; delivery: "queue" | "steer" },
  ): Effect.Effect<SubmissionReceipt, CrewError>;
  receipt(session: SessionId, request: string): Effect.Effect<SubmissionReceipt | null, CrewError>;
}

/** Immutable reviews, assets and response reservations; observation never writes. */
export class Reviews {
  private readonly assets: ReviewAssets;
  private readonly publications: PublicationStore;
  private readonly surfaces: SurfacePublications;
  constructor(
    private store: Store,
    locks: Locks,
    private source: ReviewSourceReader,
    surfaces?: SurfacePublications,
    associations?: PresentationAssociations,
  ) {
    const sharedAssociations = associations ?? new PresentationAssociations(store, locks);
    this.publications = new PublicationStore({
      store,
      locks,
      associations: sharedAssociations,
      lockKey: LockKey.make("web-reviews"),
      conflict: fail,
      headPrefix: (session) => StoragePrefix.make(`web/review/${session}/head/`),
      headKey: (session, id) => key(session, `head/${id}`),
      maxHeads: 32,
    });
    this.assets = new ReviewAssets(store, this.publications);
    this.surfaces = surfaces ?? new SurfacePublications(store, locks, sharedAssociations);
  }
  private immutable(id: StorageKey, value: unknown) {
    return this.publications.immutable(
      id,
      value,
      "Retained review identity conflicts with existing content",
    );
  }
  private publication(value: unknown) {
    return Effect.gen(function* () {
      const saved = yield* decode(PublicationSchema, value, "Review publication");
      if (recordHash(unsigned(saved.record)) !== saved.record.hash)
        return yield* fail("Review integrity check failed");
      return saved;
    });
  }
  private attachment(record: ReviewRecord) {
    return {
      session_id: record.session_id,
      message_id: record.message_id,
      tool_call_id: record.call_id,
      source: "tool" as const,
      target: {
        kind: "review" as const,
        review_id: record.review.review_id,
        revision: record.revision,
      },
    };
  }
  private head(session: SessionId, id: ReviewID) {
    return this.publications.readHead(session, id, (raw) => this.decodeHead(session, id, raw));
  }
  private decodeHead(session: SessionId, id: ReviewID, raw: unknown) {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<Head, CrewError> {
      const head = yield* decode(HeadSchema, raw, "Review head");
      if (
        head.pending &&
        (head.pending.record.session_id !== session || head.pending.record.review.review_id !== id)
      )
        return yield* fail("Review reservation belongs to another selection");
      if (
        (!head.committed && !head.pending) ||
        (head.committed && head.committed.review_id !== id) ||
        (head.committed &&
          head.pending &&
          head.pending.record.revision !== head.committed.revision + 1)
      )
        return yield* fail("Invalid retained review head");
      return head;
    });
  }
  private commit(input: Publication): Effect.Effect<CommittedReview, CrewError> {
    return Effect.gen({ self: this }, function* () {
      const saved = yield* this.publication(input);
      const r = saved.record;
      const id = r.review.review_id;
      for (const asset of r.assets) yield* this.assets.read(r.session_id, asset);
      yield* this.immutable(
        key(r.session_id, `call/${presentationHash([r.message_id, r.call_id])}`),
        saved,
      );
      yield* this.immutable(key(r.session_id, `record/${id}/${r.revision}`), saved);
      yield* this.publications.associations.associate(this.attachment(r));
      yield* this.publications.finalizeHead(
        r.session_id,
        id,
        {
          schema_version: 1,
          committed: { review_id: id, revision: r.revision },
        } satisfies Head,
        () => this.clearDiagnostic(r.session_id, id),
      );
      return reviewReference(r);
    });
  }
  private clearDiagnostic(session: SessionId, id: ReviewID) {
    const diagnosticKey = key(session, `diagnostic/${id}`);
    return this.store.get(diagnosticKey).pipe(
      Effect.flatMap((value) => (value ? this.store.set(diagnosticKey, null) : Effect.void)),
      Effect.catch((error) =>
        Effect.logWarning("Unable to clear review recovery diagnostics", error.code),
      ),
    );
  }
  recover(session: SessionId) {
    return this.publications.withLock(() =>
      this.publications
        .recover(session, {
          isolate: true,
          decodeHead: (rawId, raw) =>
            Effect.gen({ self: this }, function* () {
              const reviewID = yield* decode(
                ReviewSelectionSchema.fields.review_id,
                rawId,
                "Review head key",
              );
              const head = yield* this.decodeHead(session, reviewID, raw);
              return { head: { reviewID, head }, pending: head.pending };
            }),
          commit: (pending) => this.commit(pending),
          onClean: (_rawId, { reviewID }) => this.clearDiagnostic(session, reviewID),
          onFailure: (rawId) =>
            this.store
              .set(
                key(session, `diagnostic/${rawId}`),
                "Publication recovery is unavailable. Retained evidence was preserved.",
              )
              .pipe(
                Effect.catch((error) =>
                  Effect.logWarning("Unable to retain review recovery diagnostics", error.code),
                ),
                Effect.as(undefined),
              ),
        })
        .pipe(Effect.asVoid),
    );
  }
  publish(
    session: SessionId,
    message: MessageId,
    call: string,
    input: typeof ReviewPublishSchema.Type,
  ) {
    return this.publications.withLock(() =>
      domainEffect(
        Effect.gen({ self: this }, function* () {
          const value = yield* decode(ReviewPublishSchema, input, "Review input");
          const id = value.review.review_id,
            inputHash = presentationHash(value),
            callKey = key(session, `call/${presentationHash([message, call])}`);
          let head = yield* this.head(session, id);
          const old = yield* this.store.get(callKey);
          if (old !== undefined) {
            const saved = yield* this.publication(old);
            if (
              saved.input_hash !== inputHash ||
              saved.record.session_id !== session ||
              saved.record.message_id !== message ||
              saved.record.call_id !== call ||
              saved.record.review.review_id !== id
            )
              return yield* fail("Native call is already bound to different review input");
            if (head?.committed && saved.record.revision <= head.committed.revision) {
              const committed = yield* this.rawRecord(session, {
                review_id: id,
                revision: saved.record.revision,
              });
              if (committed.hash !== saved.record.hash)
                return yield* fail("Committed review no longer matches its native call");
              if (saved.record.revision === head.committed.revision) {
                yield* this.clearDiagnostic(session, id);
                yield* committedScope({ presentations: true });
              }
              return reviewReference(committed);
            }
            if (head?.pending?.record.hash !== saved.record.hash)
              return yield* fail(
                "Original review publication has no matching retained reservation",
              );
            return yield* this.commit(head.pending);
          }
          if (head?.pending) {
            const pending = head.pending;
            const sameCall =
              pending.record.message_id === message && pending.record.call_id === call;
            if (sameCall && pending.input_hash !== inputHash)
              return yield* fail("Reserved call input conflicts");
            const committed = yield* this.commit(pending);
            if (sameCall) return committed;
            head = { schema_version: 1, committed };
          }
          if (
            !head &&
            (yield* this.store.entries(StoragePrefix.make(`web/review/${session}/head/`))).length >=
              32
          )
            return yield* fail("At most 32 review identities per Abra conversation");
          const source = yield* this.source(session, value.review.source);
          const assets = yield* this.assets.capture(session, source.root, value.previews ?? []);
          const referenced = value.review.fields.flatMap((f) =>
            f.component === "DesignChoiceGroup" ? f.options.map((o) => o.preview) : [],
          );
          if (
            referenced.some((id) => !assets.some((a) => a.id === id)) ||
            assets.some((a) => !referenced.includes(a.id))
          )
            return yield* fail("Design choices must reference exactly the supplied preview assets");
          if (value.review.responds_to) {
            const response = yield* this.store.get(
              key(session, `response/${value.review.responds_to}`),
            );
            if (response === undefined)
              return yield* fail("Follow-up review requires a retained submitted response");
            const savedResponse = yield* decode(ResponseSchema, response, "Review response");
            const receipt = yield* this.store.get(
              StorageKey.make(`web/receipt/${session}/${value.review.responds_to}`),
            );
            const admitted = yield* decode(ReceiptSchema, receipt, "Review admission receipt");
            if (
              savedResponse.input.request_id !== value.review.responds_to ||
              admitted.request_id !== value.review.responds_to ||
              admitted.text !== savedResponse.text ||
              admitted.status !== "admitted"
            )
              return yield* fail("Follow-up requires confirmed admission of the matching response");
          }
          const record = {
            schema_version: 1 as const,
            session_id: session,
            message_id: message,
            call_id: call,
            revision: (head?.committed?.revision ?? 0) + 1,
            at: yield* timestamp,
            review: value.review,
            source_text: source.text,
            assets,
          };
          const saved = { record: { ...record, hash: recordHash(record) }, input_hash: inputHash };
          yield* decode(ReviewRecordSchema, saved.record, "Published review");
          return yield* this.publications.reserveAndCommit(
            session,
            id,
            {
              schema_version: 1,
              ...(head?.committed ? { committed: head.committed } : {}),
              pending: saved,
            } satisfies Head,
            () => this.commit(saved),
          );
        }),
      ),
    );
  }
  private rawRecord(session: SessionId, selection: ReviewSelection) {
    return Effect.gen({ self: this }, function* () {
      yield* decode(
        ReviewSelectionSchema,
        { review_id: selection.review_id, revision: selection.revision },
        "Review selection",
      );
      const saved = yield* this.publication(
        yield* this.store.get(key(session, `record/${selection.review_id}/${selection.revision}`)),
      );
      if (
        saved.record.session_id !== session ||
        saved.record.review.review_id !== selection.review_id ||
        saved.record.revision !== selection.revision
      )
        return yield* fail("Review belongs to another selection");
      return saved.record;
    });
  }
  searchCommitted(session: SessionId, selection: ReviewSelection) {
    return Effect.gen({ self: this }, function* () {
      const head = yield* this.head(session, selection.review_id);
      if (!head) return yield* fail("Review association has no committed head");
      return selection.revision <= (head.committed?.revision ?? 0);
    });
  }
  private committedRecord(session: SessionId, selection: ReviewSelection) {
    return Effect.gen({ self: this }, function* () {
      const selected = yield* decode(
        ReviewSelectionSchema,
        {
          review_id: selection.review_id,
          revision: selection.revision,
        },
        "Review selection",
      );
      const head = yield* this.head(session, selected.review_id);
      if (!head?.committed || selected.revision > head.committed.revision) {
        if (head?.pending?.record.revision === selected.revision)
          return yield* new CrewError(
            "REVIEW_PENDING",
            "This review revision is awaiting publication.",
          );
        return yield* fail("No committed review for this revision");
      }
      return { record: yield* this.rawRecord(session, selected), latest: head.committed.revision };
    });
  }
  list(session: SessionId, issue?: string) {
    return Effect.gen({ self: this }, function* () {
      const prefix = StoragePrefix.make(`web/review/${session}/head/`);
      const rows = yield* this.store.entries(prefix);
      const reviews: CommittedReview[] = [];
      const diagnostics: string[] = [];
      for (const row of rows.slice(0, 32)) {
        const id = row.key.slice(prefix.length);
        const observed = yield* Effect.gen({ self: this }, function* () {
          const reviewID = yield* decode(
            ReviewSelectionSchema.fields.review_id,
            id,
            "Review head key",
          );
          const recovery = yield* this.store.get(key(session, `diagnostic/${id}`));
          if (typeof recovery === "string") diagnostics.push(`${id}: ${recovery}`);
          const head = yield* this.decodeHead(session, reviewID, row.value);
          if (head.pending && !recovery)
            diagnostics.push(`${id}: A revision is awaiting publication.`);
          if (!head.committed) return;
          const record = yield* this.rawRecord(session, head.committed);
          const source = record.review.source;
          if (!issue || ("issue_id" in source && source.issue_id === issue))
            return reviewReference(record);
        }).pipe(Effect.result);
        if (observed._tag === "Failure")
          diagnostics.push("A retained review is unavailable; its evidence was preserved.");
        else if (observed.success) reviews.push(observed.success);
      }
      return { reviews, diagnostics };
    });
  }
  private readRecordWithFreshness(session: SessionId, selection: ReviewSelection) {
    return Effect.gen({ self: this }, function* () {
      const { record, latest } = yield* this.committedRecord(session, selection);
      const source = yield* this.source(session, record.review.source).pipe(Effect.result);
      const unavailable =
        latest !== selection.revision
          ? "This review was superseded. Open the current review; your earlier draft is preserved."
          : source._tag === "Failure"
            ? "The reviewed source changed or is unavailable. Ask Abra for an updated review; your draft is preserved."
            : undefined;
      return {
        record,
        current_revision: latest,
        ...(unavailable ? { unavailable } : {}),
      };
    });
  }
  read(session: SessionId, selection: ReviewSelection) {
    return Effect.gen({ self: this }, function* () {
      const view = yield* this.readRecordWithFreshness(session, selection);
      const { reviews } = yield* this.list(session);
      return { ...view, revisions: reviews };
    });
  }
  presentations(session: SessionId, messages: readonly MessageId[]) {
    return Effect.gen({ self: this }, function* () {
      const page = yield* this.surfaces.associations(session, messages);
      return yield* this.publications.filterAttachments(
        page,
        "review",
        (entry) =>
          this.committedRecord(session, entry.target).pipe(
            Effect.result,
            Effect.map((result) => {
              if (
                result._tag === "Success" &&
                result.success.record.message_id === entry.message_id &&
                result.success.record.call_id === entry.tool_call_id
              )
                return "keep" as const;
              return result._tag === "Failure" && result.failure.code === "REVIEW_PENDING"
                ? ("skip" as const)
                : ("diagnostic" as const);
            }),
          ),
        "A retained review attachment has no confirmed publication.",
      );
    });
  }
  asset(session: SessionId, selection: ReviewSelection & { hash: ContentHash }) {
    return Effect.gen({ self: this }, function* () {
      const { record } = yield* this.committedRecord(session, selection);
      const asset = record.assets.find((a) => a.hash === selection.hash);
      if (!asset) return yield* fail("Image does not belong to this review");
      return yield* this.assets.read(session, asset);
    });
  }
  receipt(
    session: SessionId,
    selection: typeof ReviewResponseQuerySchema.Type,
    admissions: ReviewAdmissions,
  ) {
    return Effect.gen({ self: this }, function* () {
      const raw = yield* this.store.get(key(session, `response/${selection.request_id}`));
      if (raw === undefined) return null;
      const saved = yield* decode(ResponseSchema, raw, "Review response reservation");
      if (
        saved.input.review_id !== selection.review_id ||
        saved.input.revision !== selection.revision ||
        saved.input.hash !== selection.hash
      )
        return yield* fail("Response belongs to another review selection");
      const receipt = yield* admissions.receipt(session, selection.request_id);
      if (!receipt) return null;
      if (receipt.text !== saved.text || receipt.delivery !== "queue")
        return yield* fail("Admission receipt conflicts with review response");
      return {
        ...receipt,
        review_id: selection.review_id,
        revision: selection.revision,
        hash: selection.hash,
      };
    });
  }
  submit(session: SessionId, input: ReviewSubmit, admissions: ReviewAdmissions) {
    return domainEffect(
      Effect.gen({ self: this }, function* () {
        const reserved = yield* this.publications.withLock(() =>
          Effect.gen({ self: this }, function* () {
            const value = yield* decode(ReviewSubmitSchema, input, "Review response");
            const responseKey = key(session, `response/${value.request_id}`),
              prior = yield* this.store.get(responseKey);
            if (prior !== undefined) {
              const saved = yield* decode(ResponseSchema, prior, "Retained response");
              if (canonicalJSON(saved.input) !== canonicalJSON(value))
                return yield* fail("Response identity is already bound to different answers");
              return saved;
            }
            const view = yield* this.readRecordWithFreshness(session, value);
            if (view.unavailable) return yield* new CrewError("REVIEW_STALE", view.unavailable);
            const record = view.record;
            if (record.hash !== value.hash)
              return yield* fail("Review hash does not match the reviewed version");
            const errors = reviewAnswerErrors(record.review, value.answers);
            if (Object.keys(errors).length) return yield* fail(Object.values(errors).join("; "));
            const answers = record.review.fields.map((f) => ({
              question: f.label,
              field_id: f.id,
              answer: value.answers[f.id] ?? null,
              ...("options" in f
                ? {
                    selected_options: f.options
                      .filter((o) => {
                        const v = value.answers[f.id];
                        return Array.isArray(v) ? v.includes(o.value) : v === o.value;
                      })
                      .map((o) => ({ value: o.value, label: o.label })),
                  }
                : {}),
            }));
            const text = `Please revise the reviewed plan or respond to this report using my feedback. This is review input, not plan or merge approval. Follow the existing controller checkpoints. Read the retained review with abra_review_ui action read for captured source content. Publish a follow-up review with responds_to ${value.request_id} when a revision is available.\n\n${JSON.stringify({ review_id: value.review_id, revision: value.revision, hash: value.hash, source: record.review.source, title: record.review.title, answers }, null, 2)}`;
            if (text.length > 32768) return yield* fail("Review response exceeds admission limits");
            const saved = { input: value, text };
            yield* this.immutable(responseKey, saved);
            return saved;
          }),
        );
        const receipt = yield* admissions.submit(session, {
          request_id: reserved.input.request_id,
          text: reserved.text,
          delivery: "queue",
        });
        return {
          ...receipt,
          review_id: reserved.input.review_id,
          revision: reserved.input.revision,
          hash: reserved.input.hash,
        };
      }),
    );
  }
}
