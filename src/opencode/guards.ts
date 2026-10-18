import { permittedTools, policyAllows, rolePolicy, protectedControlPath } from "./role-policy.ts";
import { externalOwns } from "../validation/contracts.ts";
import { decode } from "../decode.ts";
import { AbsolutePath, ToolName, SessionId } from "../identities.ts";

import { domainEffect } from "../effect.ts";
import { Effect, Result, Schema } from "effect";
import { type Context } from "@opencode/plugin/effect/plugin";
import { Tool } from "@opencode/schema/tool";
import { Patch } from "@opencode/util/patch";

import { readFile, realpath } from "../filesystem.ts";
import { resolve, dirname, isAbsolute, sep } from "node:path";
import { CrewError, type Execution, type Role } from "../domain.ts";
import { type Controller } from "../workflow/controller.ts";
import { isActiveWorker, historicalWorkers } from "../workflow/worker-assignment.ts";
import { messageRequests } from "../workflow/message-contracts.ts";
export function workerFor(controller: Controller, sessionID: SessionId) {
  return controller.queries.assignment(sessionID);
}
export function roleFor(e: Execution, id: SessionId): Role {
  const retained = historicalWorkers(e).find((s) => s.id === id);
  if (retained) return retained.role;
  return e.research_session_id === id
    ? "research"
    : e.review_session_id === id
      ? "review"
      : e.apply_session_id === id
        ? "apply"
        : e.session_intent?.id === id
          ? e.session_intent.role
          : "explore";
}
export { permittedTools } from "./role-policy.ts";
/** A native queue flag or client metadata is not controller ownership. */
export function requireOwnedPrompt(
  e: Execution,
  session: SessionId,
  message: import("../identities.ts").MessageId,
) {
  const role = roleFor(e, session);
  const intent = messageRequests(e.messages).find((m) => m.prompt_id === message);
  if (
    (intent
      ? intent.generation !== e.control_generation ||
        intent.assignment_id !== e.prompt_id ||
        intent.recipient_session_id !== session ||
        intent.role !== role ||
        !["admission_uncertain", "admitted", "acknowledged", "answered"].includes(intent.status)
      : e.prompt_id !== message || e.worker_context_id !== message) ||
    !isActiveWorker(e, session, { role })
  )
    throw new CrewError(
      "WORKER_PROMPT_ONLY",
      "Managed workers accept only controller-owned prompts. Talk to Abra.",
    );
  return intent;
}
const editInput = Schema.Struct({
  patchText: Schema.optional(Schema.String),
  filePath: Schema.optional(Schema.String),
  path: Schema.optional(Schema.String),
});
function contained(file: AbsolutePath, root: AbsolutePath) {
  return domainEffect(
    Effect.gen(function* () {
      let cursor = file;
      const tail: string[] = [];
      let actual: AbsolutePath;
      while (true) {
        const resolved = yield* Effect.result(realpath(cursor));
        if (Result.isSuccess(resolved)) {
          actual = AbsolutePath.make(resolve(resolved.success, ...tail.reverse()));
          break;
        }
        if (resolved.failure.code !== "ENOENT") return yield* resolved.failure;
        const parent = dirname(cursor);
        if (!(parent !== cursor))
          return yield* new CrewError("WORKER_PATH", "Cannot resolve write root");
        tail.push(cursor.slice(parent.length + 1));
        cursor = AbsolutePath.make(parent);
      }
      const base = yield* realpath(root);
      if (!actual.startsWith(base + "/"))
        return yield* new CrewError(
          "WORKER_PATH",
          "Edits must stay inside the assigned write root and cannot follow escaping symlinks",
        );
    }),
  );
}
export function installGuards(
  ctx: Context,
  controller: Controller,
  provide: <A, E>(effect: Effect.Effect<A, E>) => Effect.Effect<A, E> = (effect) => effect,
) {
  return domainEffect(
    Effect.gen(function* () {
      yield* ctx.session.hook("prompt", (event) =>
        domainEffect(
          Effect.gen(function* () {
            if (
              yield* controller
                .lead()
                .prompt(event.sessionID, event.messageID, event.prompt.text, event.delivery)
            ) {
              if (
                event.prompt.files?.length ||
                event.prompt.agents?.length ||
                event.prompt.skills?.length
              )
                return yield* new CrewError(
                  "LEAD_PROMPT",
                  "Lead prompts cannot attach files, agents or skills",
                );
              return;
            }
            const assignment = yield* workerFor(controller, event.sessionID);
            if (!assignment) return;
            const intent = requireOwnedPrompt(assignment, event.sessionID, event.messageID);
            const captured = yield* controller.queries.capturedWorkerPrompt(assignment);
            if (
              captured.generation !== assignment.control_generation ||
              captured.session_id !== event.sessionID ||
              captured.prompt_id !== assignment.prompt_id ||
              (intent?.prompt ?? captured.prompt) !== event.prompt.text ||
              (intent?.delivery ?? "queue") !== event.delivery ||
              event.prompt.files?.length ||
              event.prompt.agents?.length ||
              event.prompt.skills?.length
            )
              return yield* new CrewError(
                "WORKER_PROMPT_ONLY",
                "Managed workers accept only their retained controller assignment. Talk to Abra.",
              );
          }),
        ).pipe(Effect.orDie, provide),
      );
      yield* ctx.session.hook("context", (event) =>
        domainEffect(
          Effect.gen(function* () {
            const lead = yield* controller.lead().principal(event.sessionID);
            if (lead || event.agent === "project-lead") {
              if (
                !lead ||
                !lead.enabled ||
                lead.stop_pending ||
                lead.session_id !== event.sessionID ||
                event.agent !== "project-lead"
              )
                return yield* new CrewError("LEAD_STALE", "Current registered lead required");
              if (
                event.model.providerID !== lead.model.providerID ||
                event.model.id !== lead.model.id ||
                (event.model.variant ?? "default") !== (lead.model.variant ?? "default")
              )
                return yield* new CrewError(
                  "LEAD_MODEL",
                  "Lead must use its captured model selection",
                );
              for (const name of Object.keys(event.tools))
                if (name !== "abra_lead_action") delete event.tools[name];
              return;
            }
            const e = yield* workerFor(controller, event.sessionID);
            if (e) {
              const role = roleFor(e, event.sessionID);
              const allow = permittedTools(role);
              for (const key of Object.keys(event.tools))
                if (!allow.has(ToolName.make(key))) delete event.tools[key];
              yield* controller.recordWorkerTools(
                event.sessionID,
                event.model,
                Object.keys(event.tools)
                  .sort()
                  .map((name) => ToolName.make(name)),
              );
              const guidance = yield* controller.workerContextRequest(
                e,
                role,
                event.sessionID,
                event.model,
                Object.keys(event.tools)
                  .sort()
                  .map((name) => ToolName.make(name)),
              );
              event.system.push({
                type: "text",
                text:
                  guidance ??
                  (yield* readFile(
                    resolve(controller.queries.settings.home, ".opencode/agents", `${role}.md`),
                    "utf8",
                  )),
              });
            } else if (event.agent === "abra") {
              for (const key of Object.keys(event.tools))
                if (!policyAllows("supervisor", key)) delete event.tools[key];
            }
          }),
        ).pipe(Effect.orDie, provide),
      );
      yield* ctx.shell.hook("create.before", (event) =>
        domainEffect(
          Effect.gen(function* () {
            delete event.env.ABRACODE_SERVER_PASSWORD;
            delete event.env.OPENCODE_PASSWORD;
            delete event.env.OPENCODE_SERVER_PASSWORD;
            const cwd = yield* realpath(event.cwd);
            for (const e of yield* controller.queries.executions())
              if (externalOwns(e) && e.worktree_directory) {
                const root = yield* realpath(e.worktree_directory);
                if (cwd === root || cwd.startsWith(root + sep))
                  return yield* new CrewError(
                    "EXTERNAL_CUSTODY",
                    "Native shell execution cannot take external branch custody",
                  );
              }
          }),
        ).pipe(Effect.orDie, provide),
      );
      yield* ctx.tool.hook("execute.before", (event) =>
        domainEffect(
          Effect.gen(function* () {
            const lead = yield* controller.lead().principal(event.sessionID);
            if (lead || event.agent === "project-lead") {
              if (
                !lead ||
                !lead.enabled ||
                lead.stop_pending ||
                lead.session_id !== event.sessionID ||
                event.agent !== "project-lead" ||
                event.tool !== "abra_lead_action"
              )
                return yield* new CrewError(
                  "LEAD_FORBIDDEN",
                  "Project lead tool is outside its management scope",
                );
              return;
            }
            const e = yield* workerFor(controller, event.sessionID);
            if (!e) {
              if (event.agent === "abra" && !policyAllows("supervisor", event.tool))
                return yield* new CrewError("WORKER_TOOL", `supervisor cannot use ${event.tool}`);
              return;
            }
            const role = roleFor(e, event.sessionID);
            if (!permittedTools(role).has(ToolName.make(event.tool)))
              return yield* new CrewError("WORKER_TOOL", `${role} cannot use ${event.tool}`);
            if (!isActiveWorker(e, event.sessionID, { role }))
              return yield* new CrewError(
                "INACTIVE_WORKER",
                "Worker no longer owns an active workflow phase",
              );
            if (["write", "edit", "patch"].includes(event.tool)) {
              if (rolePolicy(role).write_scope === "none")
                return yield* new CrewError("READ_ONLY", "This role is read-only");
              const root =
                rolePolicy(role).write_scope === "assigned-change"
                  ? AbsolutePath.make(
                      resolve(e.worktree_directory!, `openspec/changes/${e.openspec_change}`),
                    )
                  : e.worktree_directory!;
              const input = yield* decode(editInput, event.input, "Native edit input");
              let files: string[];
              if (event.tool === "patch") {
                if (!(typeof input.patchText === "string"))
                  return yield* new CrewError("EDIT_INPUT", "Native patch requires patchText");
                const parsed = Patch.parse(input.patchText);
                if (!(Result.isSuccess(parsed) && parsed.success.length > 0))
                  return yield* new CrewError("EDIT_INPUT", "Invalid or empty native patch");
                files = parsed.success.flatMap((hunk) => [
                  hunk.path,
                  ...(hunk.type === "update" && hunk.movePath ? [hunk.movePath] : []),
                ]);
              } else {
                const file = input.filePath ?? input.path;
                if (!(typeof file === "string"))
                  return yield* new CrewError("EDIT_INPUT", "Use native edit/write with path");
                files = [file];
              }
              // Validate every source and move destination before the native tool mutates any file.
              for (const file of files) {
                const absolute = isAbsolute(file)
                  ? AbsolutePath.make(file)
                  : AbsolutePath.make(resolve(e.worktree_directory!, file));
                yield* contained(absolute, root);
                if (protectedControlPath(absolute, e.worktree_directory!, role))
                  return yield* new CrewError(
                    "CONTROL_FILE",
                    "Worker cannot modify orchestration/permission files",
                  );
              }
            }
          }),
        ).pipe(
          Effect.mapError((error) => new Tool.Error({ message: error.message })),
          provide,
        ),
      );
    }),
  );
}
