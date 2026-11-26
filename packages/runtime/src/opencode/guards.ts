import { NativeAccessError } from "../errors.ts";
import { containsDirectory } from "@opencode/util/path";
import { toToolError } from "@abracode/agents/tool-boundary";
import {
  policyAllows,
  memoryReadTools,
  rolePolicy,
  protectedControlPath,
  workerToolAllowed,
  leadAllows,
} from "./role-policy.ts";
import { bundledAssets } from "@abracode/agents/bundled";
import { decode } from "../decode.ts";
import { AbsolutePath, ToolName, SessionId } from "@abracode/contracts/identities";

import { Effect, Result, Schema } from "effect";
import { type Context } from "@opencode/plugin/effect/plugin";
import { Patch } from "@opencode/util/patch";

import { pathExists, readFile, realpath } from "../filesystem.ts";
import { basename, resolve, dirname, isAbsolute, relative, sep } from "node:path";
import { CrewError, type Execution, type Role } from "../domain.ts";
import { type Controller } from "../workflow/controller.ts";
import { isActiveWorker, historicalWorkers } from "../workflow/worker-assignment.ts";
import { messageRequests, requiresResponse } from "@abracode/contracts/workflow/message-contracts";
import { nativeSession } from "./native-call.ts";
import { assertActiveLead, assertActiveWorker } from "./session-authority.ts";

const roleFallbackCache = new Map<Role, string>();
const readRoleFallback = (role: Role) => {
  const cached = roleFallbackCache.get(role);
  if (cached !== undefined) return Effect.succeed(cached);
  return readFile(resolve(bundledAssets, `${role}.md`), "utf8").pipe(
    Effect.tap((text) =>
      Effect.sync(() => {
        roleFallbackCache.set(role, text);
      }),
    ),
  );
};
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
  message: import("@abracode/contracts/identities").MessageId,
) {
  const role = roleFor(e, session);
  const retained = messageRequests(e.messages).find(
    (m) => m.prompt_id === message || m.response_recovery?.prompt_id === message,
  );
  const recovery =
    retained?.response_recovery?.prompt_id === message ? retained.response_recovery : undefined;
  const intent =
    retained && recovery
      ? {
          ...retained,
          prompt_id: recovery.prompt_id,
          prompt: recovery.prompt,
          delivery: "queue" as const,
        }
      : retained;
  if (
    (intent
      ? intent.generation !== e.control_generation ||
        intent.assignment_id !== e.prompt_id ||
        intent.recipient_session_id !== session ||
        intent.role !== role ||
        (recovery &&
          (!["admission_uncertain", "admitted"].includes(recovery.status) ||
            (recovery.status === "admission_uncertain" && !requiresResponse(intent)))) ||
        !["admission_uncertain", "admitted", "acknowledged", "answered"].includes(intent.status)
      : e.prompt_id !== message || e.worker_context_id !== message) ||
    !isActiveWorker(e, session, { role })
  )
    throw new NativeAccessError(
      "WORKER_PROMPT_ONLY",
      "Managed workers accept only controller-owned prompts. Talk to Abra.",
    );
  return intent;
}
export const requireOwnedPromptEffect = (...args: Parameters<typeof requireOwnedPrompt>) =>
  Effect.try({ try: () => requireOwnedPrompt(...args), catch: CrewError.from });
const editInput = Schema.Struct({
  patchText: Schema.optional(Schema.String),
  filePath: Schema.optional(Schema.String),
  path: Schema.optional(Schema.String),
});
function insideWriteRoot(file: string, root: string) {
  const child = relative(root, file);
  return !!child && child !== ".." && !child.startsWith(".." + sep) && !isAbsolute(child);
}
function contained(file: AbsolutePath, worktree: AbsolutePath, root: AbsolutePath) {
  return Effect.gen(function* () {
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
      if (yield* pathExists(cursor))
        return yield* new NativeAccessError(
          "WORKER_PATH",
          "Cannot write through an unresolved symlink",
        );
      if (parent === cursor)
        return yield* new NativeAccessError("WORKER_PATH", "Cannot resolve write root");
      tail.push(basename(cursor));
      cursor = AbsolutePath.make(parent);
    }
    const base = yield* realpath(worktree);
    const scope = resolve(base, relative(worktree, root));
    if (!insideWriteRoot(actual, scope) || !insideWriteRoot(file, root))
      return yield* new NativeAccessError(
        "WORKER_PATH",
        "Edits must stay inside the assigned write root and cannot follow escaping symlinks",
      );
    return { actual, base };
  });
}
export function installGuards(
  ctx: Context,
  controller: Controller,
  provide: <A, E>(effect: Effect.Effect<A, E>) => Effect.Effect<A, E> = (effect) => effect,
) {
  return Effect.gen(function* () {
    yield* ctx.session.hook("prompt", (event) =>
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
            return yield* new NativeAccessError(
              "LEAD_PROMPT",
              "Lead prompts cannot attach files, agents or skills",
            );
          const native = yield* nativeSession(ctx).get({ sessionID: event.sessionID });
          if (
            native.location.directory !== controller.queries.settings.home ||
            native.agent !== "project-lead"
          )
            return yield* new NativeAccessError(
              "LEAD_SESSION",
              "Managed lead moved or changed agent. Talk to Abra.",
            );
          return;
        }
        const assignment = yield* workerFor(controller, event.sessionID);
        if (!assignment) return;
        if (
          messageRequests(assignment.messages).some(
            (m) =>
              m.response_recovery?.prompt_id === event.messageID &&
              m.response_recovery.status === "admission_uncertain",
          ) &&
          !event.prompt.files?.length &&
          !event.prompt.agents?.length &&
          !event.prompt.skills?.length &&
          (yield* controller.refuseResolvedReminder(
            assignment,
            event.sessionID,
            event.messageID,
            event.prompt.text,
            event.delivery,
          ))
        )
          return yield* new NativeAccessError(
            "WORKER_PROMPT_ONLY",
            "The original response is already committed; unused reminder suppressed. Talk to Abra.",
          );
        const intent = yield* requireOwnedPromptEffect(
          assignment,
          event.sessionID,
          event.messageID,
        );
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
          return yield* new NativeAccessError(
            "WORKER_PROMPT_ONLY",
            "Managed workers accept only their retained controller assignment. Talk to Abra.",
          );
        const native = yield* nativeSession(ctx).get({ sessionID: event.sessionID });
        if (native.location.directory !== assignment.worktree_directory)
          return yield* new NativeAccessError(
            "SESSION_LOCATION",
            "Managed worker moved outside its assigned worktree. Talk to Abra.",
          );
      }).pipe(Effect.orDie, provide),
    );
    yield* ctx.session.hook("context", (event) =>
      Effect.gen(function* () {
        const lead = yield* controller.lead().principal(event.sessionID);
        if (lead || event.agent === "project-lead") {
          const activeLead = yield* assertActiveLead(controller, event.sessionID, event.agent, {
            lead,
            code: "LEAD_STALE",
            message: "Current registered lead required",
          });
          if (
            event.model.providerID !== activeLead.model.providerID ||
            event.model.id !== activeLead.model.id ||
            (event.model.variant ?? "default") !== (activeLead.model.variant ?? "default")
          )
            return yield* new NativeAccessError(
              "LEAD_MODEL",
              "Lead must use its captured model selection",
            );
          for (const name of Object.keys(event.tools))
            if (!leadAllows(name)) delete event.tools[name];
          return;
        }
        const e = yield* workerFor(controller, event.sessionID);
        if (e) {
          const role = roleFor(e, event.sessionID);
          const profile = e.configuration_snapshot?.definitions?.[role];
          const active = isActiveWorker(e, event.sessionID, { role });
          for (const key of Object.keys(event.tools))
            if (
              !active ||
              (memoryReadTools.includes(key) && !e.configuration_snapshot?.memory_reads) ||
              !workerToolAllowed(role, profile, key)
            )
              delete event.tools[key];
          const tools = Object.keys(event.tools)
            .sort()
            .map((name) => ToolName.make(name));
          yield* controller.recordWorkerTools(event.sessionID, event.model, tools);
          const guidance = yield* controller.workerContextRequest(
            e,
            role,
            event.sessionID,
            event.model,
            tools,
          );
          const text = guidance ?? (yield* readRoleFallback(role));
          if (text.trim()) event.system.push({ type: "text", text });
        } else if (event.agent === "abra") {
          for (const key of Object.keys(event.tools))
            if (!policyAllows("supervisor", key)) delete event.tools[key];
        }
      }).pipe(Effect.orDie, provide),
    );
    yield* ctx.shell.hook("create.before", (event) =>
      Effect.gen(function* () {
        delete event.env.ABRACODE_SERVER_PASSWORD;
        delete event.env.OPENCODE_PASSWORD;
        delete event.env.OPENCODE_SERVER_PASSWORD;
        const owned = yield* controller.queries.externalWorktrees();
        if (!owned.length) return;
        const cwd = yield* realpath(event.cwd);
        for (const directory of owned) {
          const result = yield* Effect.result(realpath(directory));
          if (Result.isFailure(result)) {
            if (result.failure.code === "ENOENT") continue;
            return yield* result.failure;
          }
          if (containsDirectory(result.success, cwd))
            return yield* new NativeAccessError(
              "EXTERNAL_CUSTODY",
              "Native shell execution cannot take external branch custody",
            );
        }
      }).pipe(Effect.orDie, provide),
    );
    // Permission actions can represent capabilities such as external_directory, distinct
    // from tool names. The native edit action supplies concrete resource paths; patch
    // contents, moves and resolved symlinks are checked at execute.before.
    yield* ctx.permission.hook("evaluate", (event) =>
      Effect.gen(function* () {
        if (event.effect === "deny" || event.action !== "edit" || event.source?.type !== "tool")
          return;
        const deny = () => {
          event.effect = "deny";
          event.message = "Managed session cannot edit this resource";
        };
        if (event.agent === "abra" || event.agent === "project-lead") return deny();
        const assigned = yield* workerFor(controller, event.sessionID);
        if (!assigned) {
          if (yield* controller.lead().principal(event.sessionID)) deny();
          return;
        }
        const role = roleFor(assigned, event.sessionID);
        const directory = assigned.worktree_directory;
        if (
          !directory ||
          !isActiveWorker(assigned, event.sessionID, { role }) ||
          !workerToolAllowed(role, assigned.configuration_snapshot?.definitions?.[role], "edit")
        )
          return deny();
        const root =
          rolePolicy(role).write_scope === "assigned-change"
            ? resolve(directory, "openspec/changes", assigned.openspec_change)
            : directory;
        for (const resource of event.resources) {
          const file = resolve(directory, resource);
          if (!insideWriteRoot(file, root) || protectedControlPath(file, directory, role))
            return deny();
        }
      }).pipe(
        Effect.catch(() =>
          Effect.sync(() => {
            event.effect = "deny";
            event.message = "Cannot verify managed session edit authority";
          }),
        ),
        provide,
      ),
    );
    yield* ctx.tool.hook("execute.before", (event) =>
      Effect.gen(function* () {
        const lead = yield* controller.lead().principal(event.sessionID);
        if (lead || event.agent === "project-lead") {
          yield* assertActiveLead(controller, event.sessionID, event.agent, {
            lead,
            allowed: leadAllows(event.tool),
            code: "LEAD_FORBIDDEN",
            message: "Project lead tool is outside its management scope",
          });
          return;
        }
        const e = yield* workerFor(controller, event.sessionID);
        if (!e) {
          if (event.agent === "abra" && !policyAllows("supervisor", event.tool))
            return yield* new NativeAccessError(
              "WORKER_TOOL",
              `supervisor cannot use ${event.tool}`,
            );
          return;
        }
        const role = roleFor(e, event.sessionID);
        if (
          (memoryReadTools.includes(event.tool) && !e.configuration_snapshot?.memory_reads) ||
          !workerToolAllowed(role, e.configuration_snapshot?.definitions?.[role], event.tool)
        )
          return yield* new NativeAccessError("WORKER_TOOL", `${role} cannot use ${event.tool}`);
        yield* assertActiveWorker(controller, event.sessionID, {
          execution: e,
          role,
          code: "INACTIVE_WORKER",
          message: "Worker no longer owns an active workflow phase",
        });
        if (["write", "edit", "patch"].includes(event.tool)) {
          if (rolePolicy(role).write_scope === "none")
            return yield* new NativeAccessError("READ_ONLY", "This role is read-only");
          const root =
            rolePolicy(role).write_scope === "assigned-change"
              ? AbsolutePath.make(
                  resolve(e.worktree_directory!, `openspec/changes/${e.openspec_change}`),
                )
              : e.worktree_directory!;
          const input = yield* decode(editInput, event.input, "Native edit input");
          let files: string[];
          if (event.tool === "patch") {
            if (typeof input.patchText !== "string")
              return yield* new NativeAccessError("EDIT_INPUT", "Native patch requires patchText");
            const parsed = Patch.parse(input.patchText);
            if (!(Result.isSuccess(parsed) && parsed.success.length > 0))
              return yield* new NativeAccessError("EDIT_INPUT", "Invalid or empty native patch");
            files = parsed.success.flatMap((hunk) => [
              hunk.path,
              ...(hunk.type === "update" && hunk.movePath ? [hunk.movePath] : []),
            ]);
          } else {
            const file = input.filePath ?? input.path;
            if (typeof file !== "string")
              return yield* new NativeAccessError("EDIT_INPUT", "Use native edit/write with path");
            files = [file];
          }
          // Validate every source and move destination before the native tool mutates any file.
          for (const file of files) {
            const absolute = isAbsolute(file)
              ? AbsolutePath.make(file)
              : AbsolutePath.make(resolve(e.worktree_directory!, file));
            const { actual, base } = yield* contained(absolute, e.worktree_directory!, root);
            if (
              protectedControlPath(absolute, e.worktree_directory!, role) ||
              protectedControlPath(actual, base, role)
            )
              return yield* new NativeAccessError(
                "CONTROL_FILE",
                "Worker cannot modify orchestration/permission files",
              );
          }
        }
      }).pipe(
        Effect.mapError((error) => toToolError(error.code, error.message)),
        provide,
      ),
    );
  });
}
