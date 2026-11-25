import { bindingRequirements } from "@abracode/contracts/web/bindings";
import { Effect, Schema } from "effect";
import type { Controller } from "../workflow/controller.ts";
import { IssueId, Timestamp } from "@abracode/contracts/identities";
import { domainEffect } from "../effect.ts";
import { defineTool } from "../opencode/tool-definition.ts";
import { Visibility } from "../visibility/read-model.ts";
import { CrewError } from "../domain.ts";
import { surfaceResources } from "@abracode/contracts/web/surfaces";
import { resolveOwnedResource } from "./resource-selection.ts";
import { ComponentId } from "@abracode/contracts/web/catalog";
import { SurfacePublicationSchema } from "@abracode/contracts/web/presentation-contracts";
import { checkSurfaceDraft, SurfacePublications } from "./surface-publications.ts";

export function workSurfaceTool(controller: Controller, publications: SurfacePublications) {
  return defineTool({
    name: "render_ui",
    description:
      "Publish one complete workspace view from Express source. Load abra-express for the catalog and examples. Set validate_only to check a draft.",
    input: Schema.Struct({
      surface_id: ComponentId,
      source: Schema.NonEmptyString,
      validate_only: Schema.optionalKey(Schema.Boolean),
    }),
    output: Schema.Union([
      SurfacePublicationSchema,
      Schema.Struct({ validated: Schema.Literal(true), surface_id: ComponentId }),
    ]),
    diagnostic: true,
    run: (input, session, call) =>
      Effect.gen(function* () {
        const { compileWorkView } = yield* Effect.promise(() => import("./express.ts"));
        const surface = yield* Effect.try({
          try: () => compileWorkView(input.surface_id, input.source),
          catch: (error) => new CrewError("UI_EXPRESS", CrewError.from(error).message),
        });
        const observe = domainEffect(
          Effect.gen(function* () {
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
            const binding = yield* new Visibility(controller).binding({
              issue_ids: selection.ids.map((id) => IssueId.make(id)),
              include_population: selection.unfiltered,
            });
            return {
              at: Timestamp.make(binding.observed_at),
              work: binding.work,
              binding_coverage: binding.coverage,
            };
          }),
        );
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
          },
          observe,
        );
      }),
  });
}
