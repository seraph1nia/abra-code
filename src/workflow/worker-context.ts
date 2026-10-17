import { diagnosticText } from "../opencode/diagnostics.ts";
import { Effect } from "effect";
import { join } from "node:path";
import {
  type Config,
  CrewError,
  type Execution,
  type Issue,
  type Role,
  type WorkerModel,
} from "../domain.ts";
import { AbsolutePath, MessageId, SessionId, StorageKey, timestamp } from "../identities.ts";
import { type Records, type Store } from "../storage/store.ts";
import { decode } from "../decode.ts";
import { domainEffect } from "../effect.ts";
import { pathExists, readFile } from "../filesystem.ts";
import { policyIdentity } from "../opencode/role-policy.ts";
import { workerBrowser } from "../opencode/browser.ts";
import {
  digestText,
  missingTools,
  type WorkerEnvironment,
  type ToolObservationSchema,
} from "../opencode/worker-environment.ts";
import {
  ContextStatusSchema,
  WorkerContextSchema,
  type WorkerContext,
  WorkerContextSummarySchema,
} from "./worker-context-contracts.ts";
import { workerPrompt } from "./prompts.ts";

const contextKey = (id: MessageId) => StorageKey.make(`worker-context/${id}`);
const statusKey = (e: Execution, role: Role) =>
  StorageKey.make(`worker-context-status/${e.execution_id}/${role}`);
export const readWorkerContext = (store: Store, id: MessageId) =>
  store.get(contextKey(id)).pipe(
    Effect.flatMap((value) => decode(WorkerContextSchema, value, contextKey(id))),
    Effect.tap((context) =>
      context.prompt_id === id
        ? Effect.void
        : Effect.fail(
            new CrewError("CONTEXT_ID", "Captured payload has the wrong prompt identity"),
          ),
    ),
  );
export const compatibleContext = (
  context: WorkerContext,
  assignment?: Pick<
    WorkerContext,
    "execution_id" | "generation" | "role" | "session_id" | "prompt_id"
  >,
) => {
  if (
    assignment &&
    (context.execution_id !== assignment.execution_id ||
      context.generation !== assignment.generation ||
      context.role !== assignment.role ||
      context.session_id !== assignment.session_id ||
      context.prompt_id !== assignment.prompt_id)
  )
    throw new CrewError(
      "CONTEXT_ASSIGNMENT",
      "Captured instructions do not match the retained admission; inspect native evidence before an explicit new turn",
    );
  if (context.policy !== policyIdentity(context.role))
    throw new CrewError(
      "CONTEXT_POLICY",
      "Captured role policy is incompatible; inspect retained admission evidence, then request an explicit new turn without replaying an admitted prompt",
    );
};
/** Immutable supplied payloads; latest bounded observations never authorize workflow transitions. */
export class WorkerContexts {
  constructor(
    private records: Records,
    private config: Config,
  ) {}
  prepare = Effect.fn("WorkerContexts.prepare")(
    function* (
      this: WorkerContexts,
      e: Execution,
      role: Role,
      issue: Issue,
      environment: WorkerEnvironment,
      session: SessionId,
      prompt: MessageId,
      artifacts: readonly string[],
    ) {
      if (!e.worktree_directory || !e.base_commit)
        return yield* new CrewError(
          "CONTEXT_LOCATION",
          "Worker context requires its owned worktree and retained base",
        );
      const path = AbsolutePath.make(join(this.config.home, ".opencode/agents", `${role}.md`));
      const source = yield* readFile(path, "utf8");
      const content = source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim();
      if (!content)
        return yield* new CrewError("CONTEXT_GUIDANCE", `Role guidance is empty: ${path}`);
      const instructions = join(e.worktree_directory, "AGENTS.md");
      const browser = workerBrowser(this.config.home, session);
      const context = yield* decode(
        WorkerContextSchema,
        {
          schema_version: 1,
          issue_id: e.issue_id,
          execution_id: e.execution_id,
          repository_id: e.repository_id,
          generation: e.control_generation,
          role,
          session_id: session,
          prompt_id: prompt,
          workflow: e.workflow_policy,
          directory: e.worktree_directory,
          base: e.base_commit,
          policy: policyIdentity(role),
          environment,
          guidance: { path, content, digest: digestText(content) },
          prompt:
            workerPrompt(e, issue, role) +
            `\nRequired skills (load through the native skill tool when relevant): ${environment.skills.map((skill) => skill.id).join(", ") || "none"}. Skill availability does not grant tools.\n` +
            `For website interaction and application behavior checks, load abra-browser and use agent-browser through the native shell tool. Browser session: ${browser.name}. Screenshot directory: ${browser.directory}/. Use --session ${browser.name} on every invocation; close only that named browser when finished. Browser checks supplement required repository verification.\n`,
          scope_fingerprint:
            e.workflow_policy === "full-openspec" ? e.plan_fingerprint : e.scope?.fingerprint,
          approvals: e.approval_receipts,
          scope_reference:
            e.workflow_policy === "full-openspec"
              ? `openspec/changes/${e.openspec_change}`
              : `execution:${e.execution_id}/scope:${e.scope?.revision ?? "retained"}`,
          references: [
            {
              path: instructions,
              status: (yield* pathExists(instructions)) ? "discovered" : "unavailable",
            },
            ...artifacts.map((artifact) => ({ path: artifact, status: "declared" })),
          ],
          decisions: (e.decisions ?? []).map((decision) => ({
            key: decision.key,
            status: decision.status,
          })),
          at: yield* timestamp,
        },
        "Worker context",
      );
      const existing = yield* this.records.store.get(contextKey(prompt));
      if (existing !== undefined)
        return yield* new CrewError(
          "CONTEXT_IMMUTABLE",
          "Context identity already has a captured payload",
        );
      yield* this.records.store.set(contextKey(prompt), context);
      yield* this.records.coordinateCommit(() =>
        domainEffect(
          Effect.gen({ self: this }, function* () {
            const current = yield* this.records.execution(e.issue_id);
            if (
              current?.execution_id !== e.execution_id ||
              current.control_generation !== e.control_generation
            )
              return yield* new CrewError(
                "STALE_CONTEXT",
                "Context capture was superseded before publication",
              );
            yield* this.records.store.set(statusKey(e, role), {
              schema_version: 1,
              execution_id: e.execution_id,
              role,
              generation: e.control_generation,
              directory: e.worktree_directory,
              context_id: prompt,
              stage: "captured",
              at: context.at,
            });
          }),
        ),
      );
      return context;
    }.bind(this),
    domainEffect,
  );
  failure = Effect.fn("WorkerContexts.failure")(
    function* (this: WorkerContexts, e: Execution, role: Role, error: CrewError) {
      const priorRaw = yield* this.records.store.get(statusKey(e, role));
      const prior =
        priorRaw === undefined
          ? undefined
          : yield* decode(ContextStatusSchema, priorRaw, statusKey(e, role));
      const status = yield* decode(
        ContextStatusSchema,
        {
          schema_version: 1,
          execution_id: e.execution_id,
          role,
          generation: e.control_generation,
          directory: e.worktree_directory,
          stage: "preflight",
          context_id: prior?.context_id,
          observation: prior?.observation,
          blocker: {
            code: error.code,
            message: diagnosticText(error.message, 2048),
            clearing_action:
              "Repair the named worker-location prerequisite and retry; do not widen role permissions",
          },
          at: yield* timestamp,
        },
        "Context prerequisite failure",
      );
      yield* this.records.coordinateCommit(() =>
        domainEffect(
          Effect.gen({ self: this }, function* () {
            const current = yield* this.records.execution(e.issue_id);
            if (
              current?.execution_id !== e.execution_id ||
              current.control_generation !== e.control_generation
            )
              return yield* new CrewError("STALE_CONTEXT", "Prerequisite result was superseded");
            yield* this.records.store.set(statusKey(e, role), status);
          }),
        ),
      );
    }.bind(this),
    domainEffect,
  );
  observe = Effect.fn("WorkerContexts.observe")(
    function* (
      this: WorkerContexts,
      e: Execution,
      context: WorkerContext,
      observation: typeof ToolObservationSchema.Type,
      blocked?: CrewError,
    ) {
      return yield* this.records.coordinateCommit(() =>
        domainEffect(
          Effect.gen({ self: this }, function* () {
            const current = yield* this.records.execution(e.issue_id);
            if (
              !current ||
              current.control_generation !== context.generation ||
              current.worker_context_id !== context.prompt_id ||
              current.active_role !== context.role ||
              current[`${context.role}_session_id`] !== context.session_id
            )
              return yield* new CrewError(
                "STALE_CONTEXT",
                "Worker context observation was superseded",
              );
            yield* this.records.store.set(statusKey(e, context.role), {
              schema_version: 1,
              execution_id: e.execution_id,
              role: context.role,
              generation: context.generation,
              directory: context.directory,
              context_id: context.prompt_id,
              stage: blocked ? "blocked" : "request",
              observation,
              blocker: blocked
                ? {
                    code: blocked.code,
                    message: diagnosticText(blocked.message, 2048),
                    clearing_action:
                      "Repair the effective tool selection or request an explicit new turn; permissions cannot be expanded by requirements",
                  }
                : undefined,
              at: observation.at,
            });
          }),
        ),
      );
    }.bind(this),
    domainEffect,
  );
  request = Effect.fn("WorkerContexts.request")(
    function* (
      this: WorkerContexts,
      e: Execution,
      role: Role,
      session: SessionId,
      model: WorkerModel,
      names: import("../identities.ts").ToolName[],
    ) {
      if (
        e.active_role !== role ||
        e[`${role}_session_id`] !== session ||
        !["exploring", "planning", "applying", "verifying", "researching"].includes(e.current_phase)
      )
        return yield* new CrewError(
          "INACTIVE_WORKER",
          "Worker no longer owns an active workflow phase",
        );
      if (!e.worker_context_id) return undefined;
      const context = yield* readWorkerContext(this.records.store, e.worker_context_id);
      if (
        context.session_id !== session ||
        context.generation !== e.control_generation ||
        context.role !== role ||
        context.prompt_id !== e.prompt_id
      )
        return yield* new CrewError(
          "STALE_CONTEXT",
          "Captured context does not match the active admission",
        );
      const blocked =
        context.policy !== policyIdentity(role)
          ? new CrewError(
              "CONTEXT_POLICY",
              "Captured policy is incompatible; inspect retained prompt evidence and explicitly request a new turn",
            )
          : toolBlocker(context, names);
      const observation = {
        model,
        names,
        at: yield* timestamp,
        missing: missingTools(context.environment.tools, names),
      };
      yield* this.observe(e, context, observation, blocked);
      if (blocked) return yield* blocked;
      return context.guidance.content;
    }.bind(this),
    domainEffect,
  );
  summary = Effect.fn("WorkerContexts.summary")(
    function* (this: WorkerContexts, e: Execution, role: Role) {
      const raw = yield* this.records.store.get(statusKey(e, role));
      const status =
        raw === undefined ? undefined : yield* decode(ContextStatusSchema, raw, statusKey(e, role));
      const context = status?.context_id
        ? yield* readWorkerContext(this.records.store, status.context_id)
        : undefined;
      const arrays = context
        ? [
            context.references,
            context.environment.skills,
            context.environment.tools,
            context.decisions,
          ]
        : [];
      const value = {
        role,
        provenance: context ? "captured" : "legacy_unavailable",
        context_id: context?.prompt_id,
        captured_at: context?.at,
        generation: context?.generation,
        policy: context?.policy,
        directory: context?.directory ?? status?.directory,
        scope_reference: context?.scope_reference,
        scope_fingerprint: context?.scope_fingerprint,
        selection: context
          ? { agent: context.environment.agent, model: context.environment.model }
          : undefined,
        references: context?.references.slice(0, 32) ?? [],
        skills: context?.environment.skills.slice(0, 32) ?? [],
        required_tools: context?.environment.tools.slice(0, 32) ?? [],
        decisions: context?.decisions.slice(0, 32) ?? [],
        omitted: arrays.reduce((n, a) => n + Math.max(0, a.length - 32), 0),
        current_inventory: "not_observed",
        native_context: "not_captured",
        status,
      };
      return yield* decode(WorkerContextSummarySchema, value, "Worker context summary");
    }.bind(this),
    domainEffect,
  );
}
export const toolBlocker = (context: WorkerContext, names: readonly string[]) => {
  const missing = missingTools(context.environment.tools, names);
  return missing.length
    ? new CrewError(
        "TOOLS_UNAVAILABLE",
        `${context.role} at ${context.directory}: missing required tool alternatives ${missing
          .map((group) => `${group.any_of.join("|")} (${group.source})`)
          .join(", ")
          .slice(0, 1024)}; repair native tool selection without widening role policy`,
      )
    : undefined;
};
