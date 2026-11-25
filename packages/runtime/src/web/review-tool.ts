import { Effect, Schema } from "effect";
import {
  ReviewSurfaceSourceSchema,
  ReviewPlanSourceSchema,
  ReviewReportSourceSchema,
  ReviewSourceSchema,
  ReviewPublishSchema,
  ReviewSelectionSchema,
  ReviewReferenceSchema,
  ReviewViewSchema,
  type ReviewSource,
} from "@abracode/contracts/web/reviews";
import { ContentHash, type SessionId } from "@abracode/contracts/identities";
import { CrewError } from "../domain.ts";
import { defineTool } from "../opencode/tool-definition.ts";
import type { Controller } from "../workflow/controller.ts";
import type { Store } from "../storage/store.ts";
import type { Locks } from "../storage/lock.ts";
import { PresentationAssociations } from "../presentation/associations.ts";
import { SurfacePublications } from "./surface-publications.ts";
import { presentationHash } from "../presentation/identity.ts";
import { Reviews, type ReviewSourceReader } from "./reviews.ts";

export function nativeReviews(controller: Controller, store: Store, locks: Locks) {
  const associations = new PresentationAssociations(store, locks);
  const surfaces = new SurfacePublications(store, locks, associations);
  const source: ReviewSourceReader = (session, selection) =>
    Effect.gen(function* () {
      if (selection.kind === "surface") {
        const record = yield* surfaces.read(session, selection.surface_id, selection.revision);
        if (presentationHash(record.surface) !== selection.hash)
          return yield* new CrewError(
            "REVIEW_REFUSED",
            "Surface hash does not match its exact revision",
          );
        const issue = record.snapshot.length === 1 ? record.snapshot[0]?.issue_id : undefined;
        const execution = issue ? yield* controller.queries.execution(issue) : undefined;
        const text = JSON.stringify(record.surface);
        return {
          text:
            text.length <= 65536
              ? text
              : text.slice(0, 65400) +
                "\n[Surface excerpt truncated; source identity selects the complete immutable revision.]",
          ...(execution?.worktree_directory ? { root: execution.worktree_directory } : {}),
        };
      }
      const execution = yield* controller.queries.execution(selection.issue_id);
      if (!execution)
        return yield* new CrewError("REVIEW_REFUSED", "Review source execution is unavailable");
      const root = execution.worktree_directory;
      if (selection.kind === "report") {
        const report = yield* controller.visualDocument(
          selection.issue_id,
          selection.request_id,
          selection.hash,
        );
        return {
          text:
            report.json.length <= 65536
              ? report.json
              : report.json.slice(0, 65400) +
                "\n[Report excerpt truncated; source identity selects the complete immutable document.]",
          ...(root ? { root } : {}),
        };
      }
      const text = yield* controller.queries.planDocument(execution, selection.path);
      if (
        execution.control_generation !== selection.generation ||
        presentationHash(text) !== selection.hash
      )
        return yield* new CrewError(
          "REVIEW_REFUSED",
          "Planning content or execution generation changed; publish an updated review",
        );
      return { text, ...(root ? { root } : {}) };
    });
  const reviews = new Reviews(store, locks, source, surfaces, associations);
  const resolveSource = (session: SessionId, selection: typeof sourceQuery.Type) =>
    Effect.gen(function* (): Effect.fn.Return<ReviewSource, CrewError> {
      if (selection.kind === "report") return selection;
      if (selection.kind === "surface") {
        const record = yield* surfaces.read(session, selection.surface_id, selection.revision);
        return { ...selection, hash: presentationHash(record.surface) };
      }
      const execution = yield* controller.queries.execution(selection.issue_id);
      if (!execution)
        return yield* new CrewError("REVIEW_REFUSED", "Planning source is unavailable");
      const text = yield* controller.queries.planDocument(execution, selection.path);
      return {
        ...selection,
        generation: execution.control_generation,
        hash: ContentHash.make(presentationHash(text)),
      };
    });
  return { reviews, surfaces, resolveSource };
}

const sourceQuery = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("plan"),
    issue_id: ReviewPlanSourceSchema.fields.issue_id,
    path: ReviewPlanSourceSchema.fields.path,
  }),
  Schema.Struct({
    kind: Schema.Literal("surface"),
    surface_id: ReviewSurfaceSourceSchema.fields.surface_id,
    revision: ReviewSurfaceSourceSchema.fields.revision,
  }),
  ReviewReportSourceSchema,
]);
export type NativeReviewOwner = ReturnType<typeof nativeReviews>;
export function reviewTool({ reviews, resolveSource }: NativeReviewOwner) {
  return defineTool({
    name: "review_ui",
    diagnostic: true,
    description:
      "Publish app-only interactive review controls beside an exact plan, saved report or generated surface. First use action source to obtain exact source/hash/generation. action publish takes review {review_id,title,source,fields:[{component:SingleSelect|MultiSelect|DesignChoiceGroup|CommentField,id,label,required?,options?}],responds_to?}, previews?:[{id,path}] relative to the source worktree. Options use {value,label,description?}; design options also require preview matching a supplied preview ID. PNG/JPEG/WebP only, 2 MiB each/8 MiB total. Reusing review_id publishes a new revision; never reuse a native call with changed input. action read returns an exact retained review and source excerpt. Use responds_to with the submitted feedback request_id for a resulting revision. No approvals or executable actions. Offline reports unchanged.",
    input: Schema.Union([
      Schema.Struct({ action: Schema.Literal("publish"), ...ReviewPublishSchema.fields }),
      Schema.Struct({ action: Schema.Literal("read"), ...ReviewSelectionSchema.fields }),
      Schema.Struct({ action: Schema.Literal("source"), source: sourceQuery }),
    ]),
    output: Schema.Union([
      ReviewReferenceSchema,
      ReviewViewSchema,
      Schema.Struct({ source: ReviewSourceSchema }),
    ]),
    run: (input, session, call) =>
      Effect.gen(function* () {
        if (input.action === "publish")
          return yield* reviews.publish(session, call.messageID, call.id, {
            review: input.review,
            ...(input.previews ? { previews: input.previews } : {}),
          });
        if (input.action === "read") return yield* reviews.read(session, input);
        const source = yield* resolveSource(session, input.source);
        return { source };
      }),
  });
}
