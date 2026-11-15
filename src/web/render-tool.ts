import { Effect, Schema } from "effect";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { FileLocks } from "../storage/lock.ts";
import type { Context } from "@opencode/plugin/effect/plugin";
import type { Controller } from "../workflow/controller.ts";
import { NativeStore } from "../storage/store.ts";
import { StorageKey, StoragePrefix, AbsolutePath, LockKey } from "../identities.ts";
import { domainEffect } from "../effect.ts";
import { CrewError } from "../domain.ts";
import { defineTool } from "../opencode/tool-definition.ts";
import { Visibility } from "../visibility/read-model.ts";
import { validateSurface } from "./surfaces.ts";
import type { SurfaceRecord } from "./contracts.ts";

export function workSurfaceTool(ctx: Context, controller: Controller) {
  const store = new NativeStore(ctx.storage);
  const locks = new FileLocks(
    AbsolutePath.make(join(controller.queries.settings.home, ".abracode/locks")),
  );
  return defineTool({
    name: "render_ui",
    description: `Render an A2UI v1.0 work view in the AbraCode workspace. Pass a complete createSurface message: {version:"1.0",createSurface:{surfaceId:"stable-id",catalogId:"https://abracode.local/catalog/v1",components:[{id:"root",component:"Column",children:["heading","work"]},{id:"heading",component:"Text",text:"Work overview"},{id:"work",component:"Kanban",issueIds:["existing-work-id"],mode:"live"}]}}. Catalog: Column/Row children, Text text, WorkTable/StatusSummary/Kanban/DependencyGraph/Timeline/DecisionSummary issueIds + mode live|snapshot, ReportLink issueId. Use existing IDs from work_list; omit issueIds for all current work. Root must be id root. No HTML, scripts, URLs, approval widgets, or arbitrary callbacks. Reusing surfaceId atomically replaces its previous revision.`,
    input: Schema.Struct({ surface: Schema.Json }),
    output: Schema.Struct({
      surface_id: Schema.String,
      revision: Schema.Int,
      version: Schema.Literal("1.0"),
    }),
    diagnostic: true,
    run: (input, session, call) =>
      locks.with(LockKey.make("web-surfaces"), () =>
        domainEffect(
          Effect.gen(function* () {
            const snapshot = yield* new Visibility(controller).snapshot();
            const surface = yield* Effect.try({
              try: () =>
                validateSurface(input.surface, new Set(snapshot.work.map((w) => w.issue_id))),
              catch: (error) =>
                new CrewError(
                  "UI_SURFACE",
                  error instanceof Error ? error.message : "Invalid UI surface",
                ),
            });
            const id = surface.createSurface.surfaceId;
            const key = StorageKey.make(`web/surface/${session}/${id}`);
            const callID = `${call.messageID}/${call.id}`;
            const inputHash = createHash("sha256").update(JSON.stringify(surface)).digest("hex");
            const receiptKey = StorageKey.make(
              `web/surface-call/${session}/${createHash("sha256").update(callID).digest("hex")}`,
            );
            const receipt = yield* store.get(receiptKey);
            if (
              receipt &&
              typeof receipt === "object" &&
              "input_hash" in receipt &&
              "revision" in receipt &&
              typeof receipt.revision === "number"
            ) {
              if (receipt.input_hash !== inputHash)
                return yield* new CrewError(
                  "UI_SURFACE_CONFLICT",
                  "Native tool call identity is bound to another surface",
                );
              return { surface_id: id, revision: receipt.revision, version: "1.0" as const };
            }
            const previous = yield* store.get(key);
            if (
              previous === undefined &&
              (yield* store.entries(StoragePrefix.make(`web/surface/${session}/`))).length >= 16
            )
              return yield* new CrewError(
                "UI_SURFACE_LIMIT",
                "At most 16 retained work surfaces per Abra session; revise an existing surface",
              );
            const referenced = new Set(
              surface.createSurface.components.flatMap((component) => [
                ...(component.issueIds ?? []),
                ...(component.issueId ? [component.issueId] : []),
              ]),
            );
            if (referenced.size > 100)
              return yield* new CrewError(
                "UI_SURFACE_LIMIT",
                "Bind at most 100 work items per surface",
              );
            const captured = referenced.size
              ? snapshot.work.filter((work) => referenced.has(work.issue_id))
              : snapshot.work.slice(0, 100);
            const revision =
              typeof previous === "object" &&
              previous !== null &&
              "revision" in previous &&
              typeof previous.revision === "number"
                ? previous.revision + 1
                : 1;
            const record: SurfaceRecord = {
              session_id: session,
              tool_call_id: callID,
              revision,
              at: snapshot.at,
              surface,
              snapshot: captured,
            };
            // Commit a validated whole surface; failed validation leaves the prior revision intact.
            yield* Effect.gen(function* () {
              yield* store.set(key, record);
              yield* store.set(receiptKey, { surface_id: id, revision, input_hash: inputHash });
            }).pipe(Effect.uninterruptible);
            return { surface_id: id, revision, version: "1.0" as const };
          }),
        ),
      ),
  });
}
