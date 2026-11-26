import { Effect } from "effect";
import type { Context } from "@opencode/plugin/effect/plugin";
import type { Tool } from "@opencode/schema/tool";
import type { ConfigApplication } from "../config/application.ts";
import type { Onboarding } from "../config/onboard.ts";
import type { ProjectSetup } from "../config/setup.ts";
import { workSurfaceTool } from "../web/render-tool.ts";
import { reviewTool, type NativeReviewOwner } from "../web/review-tool.ts";
import type { Controller } from "../workflow/controller.ts";
import { mermaidVerifierTool } from "./diagram-tool.ts";
import { memoryTools } from "./memory-tools.ts";
import { authorizePrincipal } from "./session-authority.ts";
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
  reviews: NativeReviewOwner,
  provide: <A, E>(effect: Effect.Effect<A, E>) => Effect.Effect<A, E> = (effect) => effect,
  configuration?: ConfigApplication,
) {
  return Effect.gen(function* () {
    const definitions = [
      ...(c.memory?.enabled ? memoryTools(ctx, c, central) : []),
      workSurfaceTool(c, reviews.surfaces),
      ...(central ? [reviewTool(reviews)] : []),
      mermaidVerifierTool(c, central),
      ...inboxThoughtsTools(c),
      ...leadTools(c),
      ...projectTools(c, onboard, setup, configuration),
      ...workTools(c),
      ...workerTools(c),
      ...reviewTools(c),
    ];
    yield* ctx.tool.transform((editor) => {
      editor.namespace({
        name: "abra",
        description: "Durable issue/OpenSpec/OpenCode orchestration",
      });
      const authorize = (access: ToolAccess, context: Tool.Context) =>
        authorizePrincipal(c, central, access, context);
      for (const d of definitions.filter(
        (d) => central || d.audience === "worker" || d.audience === "supervisor_or_worker",
      ))
        d.register(editor, authorize, provide);
    });
  });
}
