import { ProposalReviewSource } from "@abracode/contracts/visibility/proposal-review";
import { proposalReviewSurface } from "@abracode/contracts/web/proposal-review-surface";
import { proposalReviewView } from "../visibility/proposal-review.ts";
import { bindingRequirements } from "@abracode/contracts/web/bindings";
import { Effect, Schema } from "effect";
import type { Controller } from "../workflow/controller.ts";
import { IssueId, Timestamp } from "@abracode/contracts/identities";
import { defineTool } from "../opencode/tool-definition.ts";
import { readBindings } from "../visibility/bindings.ts";
import { CrewError } from "../domain.ts";
import { surfaceResources } from "@abracode/contracts/web/surfaces";
import { resolveOwnedResource } from "./resource-selection.ts";
import { SurfaceId } from "@abracode/contracts/web/catalog";
import { SurfacePublicationSchema } from "@abracode/contracts/web/presentation-contracts";
import { checkSurfaceDraft, SurfacePublications } from "./surface-publications.ts";

export function workSurfaceTool(controller: Controller, publications: SurfacePublications) {
  return defineTool({
    name: "render_ui",
    description:
      "Publish one complete workspace view from Express source. Load abra-express for the catalog and examples. For an independent proposal review pass proposal_review {issue_id,fingerprint} instead of source. Set validate_only to check a draft.",
    input: Schema.Union([
      Schema.Struct({
        surface_id: SurfaceId,
        source: Schema.NonEmptyString,
        validate_only: Schema.optionalKey(Schema.Boolean),
      }),
      Schema.Struct({
        surface_id: SurfaceId,
        proposal_review: ProposalReviewSource,
        validate_only: Schema.optionalKey(Schema.Boolean),
      }),
    ]),
    output: Schema.Union([
      SurfacePublicationSchema,
      Schema.Struct({ validated: Schema.Literal(true), surface_id: SurfaceId }),
    ]),
    diagnostic: true,
    run: (input, session, call) =>
      Effect.gen(function* () {
        const surface = yield* Effect.gen(function* () {
          if ("proposal_review" in input) {
            const e = yield* controller.queries.execution(input.proposal_review.issue_id);
            const revision = e?.proposal_reviews?.find(
              (r) => r.fingerprint === input.proposal_review.fingerprint,
            );
            if (!e || !revision)
              return yield* new CrewError(
                "UI_SURFACE",
                "The selected proposal review revision is unavailable",
              );
            return yield* Effect.try({
              try: () => proposalReviewSurface(input.surface_id, proposalReviewView(e, revision)),
              catch: CrewError.from,
            });
          }
          const { compileWorkView } = yield* Effect.promise(() => import("./express.ts"));
          return yield* Effect.try({
            try: () => compileWorkView(input.surface_id, input.source),
            catch: (error) => new CrewError("UI_EXPRESS", CrewError.from(error).message),
          });
        });
        const observe = Effect.gen(function* () {
          for (const target of surfaceResources(surface))
            yield* resolveOwnedResource(controller.queries, target).pipe(
              Effect.mapError(
                (error) =>
                  new CrewError(
                    error.code,
                    `${target.action} for ${target.issue_id}: ${error.message}`,
                  ),
              ),
            );
          const selection = bindingRequirements(surface);
          const binding = yield* readBindings(controller.queries, {
            issue_ids: selection.ids.map((id) => IssueId.make(id)),
            include_population: selection.unfiltered,
          });
          return {
            at: Timestamp.make(binding.observed_at),
            work: binding.work,
            binding_coverage: binding.coverage,
          };
        });
        if (input.validate_only) {
          yield* checkSurfaceDraft(surface, observe);
          return { validated: true as const, surface_id: input.surface_id };
        }
        return yield* publications.publish(
          {
            session_id: session,
            message_id: call.messageID,
            call_id: call.id,
            surface,
            ...("proposal_review" in input && { proposal_review: input.proposal_review }),
          },
          observe,
        );
      }),
  });
}
