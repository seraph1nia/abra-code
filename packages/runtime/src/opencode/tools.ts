import { Effect } from "effect";
import type { Context } from "@opencode/plugin/effect/plugin";
import type { Tool } from "@opencode/schema/tool";
import type { ConfigApplication } from "../config/application.ts";
import type { Onboarding } from "../config/onboard.ts";
import type { ProjectSetup } from "../config/setup.ts";
import { CrewError } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { workSurfaceTool } from "../web/render-tool.ts";
import { nativeReviews, reviewTool, type NativeReviewOwner } from "../web/review-tool.ts";
import type { Controller } from "../workflow/controller.ts";
import { mermaidVerifierTool } from "./diagram-tool.ts";
import { memoryTools } from "./memory-tools.ts";
import { assertActiveLead, assertSupervisor } from "./session-authority.ts";
import type { ToolAccess } from "./tool-definition.ts";
import { inboxThoughtsTools } from "./tools/inbox-thoughts.ts";
import { leadTools } from "./tools/leads.ts";
import { projectTools } from "./tools/project.ts";
import { reviewTools } from "./tools/review.ts";
import { workTools } from "./tools/work.ts";
import { workerTools } from "./tools/worker.ts";

export function registerTools(
  ctx: Context,
  c: Controller,
  onboard: Onboarding,
  central: boolean,
  setup: ProjectSetup,
  provide: <A, E>(effect: Effect.Effect<A, E>) => Effect.Effect<A, E> = (effect) => effect,
  configuration?: ConfigApplication,
  reviews?: NativeReviewOwner,
) {
  return domainEffect(
    Effect.gen(function* () {
      const definitions = [
        ...(c.memory?.enabled ? memoryTools(ctx, c, central) : []),
        workSurfaceTool(ctx, c),
        ...(central ? [reviewTool(reviews ?? nativeReviews(ctx, c))] : []),
        mermaidVerifierTool(c, central),
        ...inboxThoughtsTools(c),
        ...leadTools(c),
        ...projectTools(c, onboard, setup, configuration),
        ...workTools(ctx, c),
        ...workerTools(c),
        ...reviewTools(c),
      ];
      yield* ctx.tool.transform((editor) => {
        editor.namespace({
          name: "abra",
          description: "Durable issue/OpenSpec/OpenCode orchestration",
        });
        const authorize = (access: ToolAccess, context: Tool.Context) =>
          domainEffect(
            Effect.gen(function* () {
              const lead = yield* c.lead().principal(context.sessionID);
              if (lead || context.agent === "project-lead") {
                yield* assertActiveLead(c, context.sessionID, context.agent, {
                  lead,
                  central,
                  allowed: !!access.lead,
                  code: "LEAD_FORBIDDEN",
                  message: "Project leads use only their scoped management endpoint",
                });
                return;
              }
              if (access.lead)
                return yield* new CrewError("LEAD_REQUIRED", "Registered lead session required");
              if (access.worker) return;
              yield* assertSupervisor(c, context.sessionID, {
                central,
                agent: context.agent,
              });
              yield* c.guardAttention(context.sessionID, context.messageID, access.diagnostic);
              yield* c.recordSupervisor(context.sessionID);
            }),
          );
        for (const d of definitions.filter((d) => central || d.worker))
          d.register(editor, authorize, provide);
      });
    }),
  );
}
