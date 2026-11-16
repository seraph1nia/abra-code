import { bindingRequirements } from "@abracode/contracts/web/bindings";
import { Effect, Schema } from "effect";
import { join } from "node:path";
import { FileLocks } from "../storage/lock.ts";
import type { Context } from "@opencode/plugin/effect/plugin";
import type { Controller } from "../workflow/controller.ts";
import { NativeStore } from "../storage/store.ts";
import { AbsolutePath, IssueId, Timestamp } from "../identities.ts";
import { domainEffect } from "../effect.ts";
import { defineTool } from "../opencode/tool-definition.ts";
import { Visibility } from "../visibility/read-model.ts";
import { SurfaceSchema, surfaceResources } from "./surfaces.ts";
import { resolveOwnedResource } from "./resource-selection.ts";
import { renderInstructions } from "./catalog.ts";
import { SurfacePublicationSchema } from "./presentation-contracts.ts";
import { SurfacePublications } from "./surface-publications.ts";

export function workSurfaceTool(ctx: Context, controller: Controller) {
  const publications = new SurfacePublications(
    new NativeStore(ctx.storage),
    new FileLocks(AbsolutePath.make(join(controller.queries.settings.home, ".abracode/locks"))),
  );
  return defineTool({
    name: "render_ui",
    description: renderInstructions,
    input: Schema.Struct({ surface: SurfaceSchema }),
    output: SurfacePublicationSchema,
    diagnostic: true,
    run: (input, session, call) =>
      publications.publish(
        {
          session_id: session,
          message_id: call.messageID,
          call_id: call.id,
          surface: input.surface,
        },
        domainEffect(
          Effect.gen(function* () {
            for (const target of surfaceResources(input.surface))
              yield* resolveOwnedResource(controller.queries, target);
            const selection = bindingRequirements(input.surface);
            const binding = yield* new Visibility(controller).binding({
              issue_ids: selection.ids.map((id) => IssueId.make(id)),
              include_population: selection.unfiltered,
            });
            return {
              home: controller.queries.settings.home,
              at: Timestamp.make(binding.observed_at),
              work: binding.work,
              binding_coverage: binding.coverage,
              work_revision: binding.work_revision,
            };
          }),
        ),
      ),
  });
}
