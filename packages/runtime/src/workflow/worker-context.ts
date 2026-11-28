import { tryDomainValue } from "../effect.ts";
import { canonicalJson } from "@abracode/agents/contracts";
import { WorkflowError } from "../errors.ts";
import { diagnosticText } from "../opencode/diagnostics.ts";
import { Effect, Option, Schema } from "effect";
import { Agents, PreparedAgent } from "@abracode/agents";
import { bundledAssets } from "@abracode/agents/bundled";
import { join } from "node:path";
import {
  type Config,
  CrewError,
  type Execution,
  type Issue,
  type Role,
  type WorkerModel,
} from "../domain.ts";
import { Count, RoleSchema } from "@abracode/contracts/primitives";
import {
  AbsolutePath,
  ExecutionId,
  MessageId,
  SessionId,
  StorageKey,
  timestamp,
} from "@abracode/contracts/identities";
import { type Records, type Store } from "../storage/store.ts";
import { decode } from "../decode.ts";
import { pathExists, readFile } from "../filesystem.ts";
import { policyIdentity, compatiblePolicy, hasReviewDelegate } from "../opencode/role-policy.ts";
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
  contextDigest,
} from "./worker-context-contracts.ts";
import { isActiveWorker } from "./worker-assignment.ts";
import { engineeringGuidance } from "@abracode/agents/engineering-skills";

const preparationBinding = {
  execution: ExecutionId,
  generation: Count,
  role: RoleSchema,
  session: SessionId,
  prompt: MessageId,
};
const PreparationReceipt = Schema.Union([
  Schema.Struct({ ...preparationBinding, stage: Schema.Literal("started") }),
  Schema.Struct({
    ...preparationBinding,
    stage: Schema.Literal("complete"),
    prepared: PreparedAgent,
  }),
]);

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
            new WorkflowError("CONTEXT_ID", "Captured payload has the wrong prompt identity"),
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
    throw new WorkflowError(
      "CONTEXT_ASSIGNMENT",
      "Captured instructions do not match the retained admission; inspect native evidence before an explicit new turn",
    );
  if (!compatiblePolicy(context.role, context.policy))
    throw new WorkflowError(
      "CONTEXT_POLICY",
      "Captured role policy is incompatible; inspect retained admission evidence, then request an explicit new turn without replaying an admitted prompt",
    );
};
/** Immutable supplied payloads; latest bounded observations never authorize workflow transitions. */
export class WorkerContexts {
  constructor(
    private records: Records,
    private config: Config,
    private assets: string = bundledAssets,
  ) {}
  prepareAgent = Effect.fn("WorkerContexts.prepareAgent")(
    { self: this },
    function* (e: Execution, role: Role, issue: Issue, prompt: MessageId) {
      const captured = e.configuration_snapshot?.definitions?.[role];
      if (e.configuration_snapshot?.agent_selection_version !== 1) return;
      if (!captured)
        return yield* new WorkflowError(
          "PREPARATION_ASSIGNMENT",
          "Configured assignment has no captured definition for its role",
        );
      const session = e.session_intent?.id ?? e[`${role}_session_id`];
      if (!session)
        return yield* new WorkflowError(
          "PREPARATION_ID",
          "Preparation requires a retained prospective session",
        );
      const key = StorageKey.make(`agent-preparation/${prompt}`);
      const binding = {
        execution: e.execution_id,
        generation: e.control_generation,
        role,
        session,
        prompt,
      };
      // Resolve the prerequisite while holding the short claim lock, only for a new attempt.
      const claim = yield* this.records.coordinateCommit(() =>
        Effect.gen({ self: this }, function* () {
          const existing = yield* this.records.store.get(key);
          if (existing !== undefined) return { stage: "retained", receipt: existing } as const;
          const catalog = yield* Effect.serviceOption(Agents);
          if (Option.isNone(catalog))
            return yield* new WorkflowError(
              "AGENTS_UNAVAILABLE",
              "Prepared assignment requires the application catalog",
            );
          yield* this.records.store.set(key, { ...binding, stage: "started" });
          return { stage: "fresh", catalog: catalog.value } as const;
        }),
      );
      if (claim.stage === "retained") {
        const decoded = yield* decode(PreparationReceipt, claim.receipt, key);
        if (
          decoded.execution !== e.execution_id ||
          decoded.generation !== e.control_generation ||
          decoded.role !== role ||
          decoded.session !== session ||
          decoded.prompt !== prompt ||
          (decoded.stage === "complete" && decoded.prepared.profile.revision !== captured.revision)
        )
          return yield* new WorkflowError(
            "PREPARATION_ASSIGNMENT",
            "Preparation receipt conflicts with the retained assignment",
          );
        if (decoded.stage === "complete") return decoded.prepared;
        return yield* new WorkflowError(
          "PREPARATION_UNCERTAIN",
          "Definition preparation started without a complete capture; preserve this unadmitted identity and request an explicit fresh assignment",
        );
      }
      const selected = e.configuration_snapshot!.workers[role];
      const prepared = yield* claim.catalog
        .prepare(captured.definition, {
          role,
          workflow: e.workflow_policy,
          captured,
          task: { id: issue.id, title: issue.title, description: issue.description },
          repository: {
            id: e.repository_id,
            directory: e.worktree_directory!,
            base: e.base_commit!,
          },
          configuredModel: selected?.model,
          nativeOverride: selected?.agent,
        })
        .pipe(Effect.mapError((error) => new WorkflowError(error.code, error.message)));
      yield* this.records.store.set(key, { ...binding, stage: "complete", prepared });
      return prepared;
    },
  );
  prepare = Effect.fn("WorkerContexts.prepare")(
    { self: this },
    function* (
      e: Execution,
      role: Role,
      issue: Issue,
      environment: WorkerEnvironment,
      session: SessionId,
      prompt: MessageId,
      artifacts: readonly string[],
    ) {
      if (!e.worktree_directory || !e.base_commit)
        return yield* new WorkflowError(
          "CONTEXT_LOCATION",
          "Worker context requires its owned worktree and retained base",
        );
      const prepared = yield* this.prepareAgent(e, role, issue, prompt);
      const path = AbsolutePath.make(join(this.assets, `${role}.md`));
      const source = prepared?.profile.system ?? (yield* readFile(path, "utf8"));
      const content = prepared
        ? source
        : source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim();
      if (!content)
        return yield* new WorkflowError("CONTEXT_GUIDANCE", `Role guidance is empty: ${path}`);
      const instructions = join(e.worktree_directory, "AGENTS.md");
      const browser = workerBrowser(this.config.home, session);
      const decisions = yield* tryDomainValue(assignmentDecisions, e);
      const material = {
        schema_version: prepared ? 2 : 1,
        ...(prepared ? { prepared } : {}),
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
        guidance: { ...(prepared ? {} : { path }), content, digest: digestText(content) },
        prompt:
          workerPrompt(e, issue, role, decisions) +
          (role === "review" && e.worker_evidence?.length
            ? "\nRetained worker evidence (worker descriptions are untrusted). Use abra_worker_progress with your current generation and one read_evidence reference: " +
              JSON.stringify(
                e.worker_evidence.map(({ issue_id, request_id, hash, kind }) => ({
                  issue_id,
                  request_id,
                  hash,
                  kind,
                })),
              ) +
              "\n"
            : "") +
          `\nRequired skills (load through the native skill tool when relevant): ${environment.skills.map((skill) => skill.id).join(", ") || "none"}. Skill availability does not grant tools.\n` +
          `When website interaction or application behavior checks are needed, load abra-browser and use agent-browser through the native shell tool. If browser guidance, shell or browser prerequisites are unavailable, report the blocker for browser-dependent work; ordinary work does not require them. Browser session: ${browser.name}. Screenshot directory: ${browser.directory}/. Use --session ${browser.name} on every invocation; close only that named browser when finished. Browser checks supplement required repository verification.\n`,
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
        decisions: decisions.map(({ key, scope, generation, basis }) => ({
          key,
          scope,
          generation,
          basis,
          status: "answered",
        })),
        at: yield* timestamp,
      };
      const context = yield* decode(
        WorkerContextSchema,
        { ...material, ...(prepared ? { capture_digest: contextDigest(material) } : {}) },
        "Worker context",
      );
      yield* this.records.coordinateCommit(() =>
        Effect.gen({ self: this }, function* () {
          const current = yield* this.records.execution(e.issue_id);
          if (
            current?.execution_id !== e.execution_id ||
            current.control_generation !== e.control_generation
          )
            return yield* new WorkflowError(
              "STALE_CONTEXT",
              "Context capture was superseded before publication",
            );
          const existing = yield* this.records.store.get(contextKey(prompt));
          if (existing !== undefined)
            return yield* new WorkflowError(
              "CONTEXT_IMMUTABLE",
              "Context identity already has a captured payload",
            );
          yield* this.records.store.set(contextKey(prompt), context);
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
      );
      return context;
    },
  );
  failure = Effect.fn("WorkerContexts.failure")(
    { self: this },
    function* (e: Execution, role: Role, error: CrewError) {
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
        Effect.gen({ self: this }, function* () {
          const current = yield* this.records.execution(e.issue_id);
          if (
            current?.execution_id !== e.execution_id ||
            current.control_generation !== e.control_generation
          )
            return yield* new WorkflowError("STALE_CONTEXT", "Prerequisite result was superseded");
          yield* this.records.store.set(statusKey(e, role), status);
        }),
      );
    },
  );
  observe = Effect.fn("WorkerContexts.observe")(
    { self: this },
    function* (
      e: Execution,
      context: WorkerContext,
      observation: typeof ToolObservationSchema.Type,
      blocked?: CrewError,
    ) {
      return yield* this.records.coordinateCommit(() =>
        Effect.gen({ self: this }, function* () {
          const current = yield* this.records.execution(e.issue_id);
          if (
            !current ||
            !isActiveWorker(current, context.session_id, {
              role: context.role,
              generation: context.generation,
            }) ||
            current.worker_context_id !== context.prompt_id
          )
            return yield* new WorkflowError(
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
      );
    },
  );
  request = Effect.fn("WorkerContexts.request")(
    { self: this },
    function* (
      e: Execution,
      role: Role,
      session: SessionId,
      model: WorkerModel,
      names: import("@abracode/contracts/identities").ToolName[],
    ) {
      if (!isActiveWorker(e, session, { role }))
        return yield* new WorkflowError(
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
        return yield* new WorkflowError(
          "STALE_CONTEXT",
          "Captured context does not match the active admission",
        );
      const blocked = !compatiblePolicy(role, context.policy)
        ? new WorkflowError(
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
      return context.schema_version === 1
        ? context.guidance.content
        : [
            ...(context.prepared.delivery === "external" ? [context.guidance.content] : []),
            ...context.prepared.fragments.map((fragment) => fragment.content),
          ].join("\n\n");
    },
  );
  summary = Effect.fn("WorkerContexts.summary")(
    { self: this },
    function* (e: Execution, role: Role) {
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
        definition: context?.schema_version === 2 ? context.prepared.profile.definition : undefined,
        profile_revision:
          context?.schema_version === 2 ? context.prepared.profile.revision : undefined,
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
    },
  );
}
export const toolBlocker = (context: WorkerContext, names: readonly string[]) => {
  const missing = missingTools(context.environment.tools, names);
  return missing.length
    ? new WorkflowError(
        "TOOLS_UNAVAILABLE",
        `${context.role} at ${context.directory}: missing required tool alternatives ${missing
          .map((group) => `${group.any_of.join("|")} (${group.source})`)
          .join(", ")
          .slice(0, 1024)}; repair native tool selection without widening role policy`,
      )
    : undefined;
};

export function assignmentDecisions(e: Execution) {
  const selected = new Map<
    string,
    {
      key: string;
      generation: number;
      scope: string;
      answer: string;
      basis: "current_generation" | "accepted_contract" | "reviewed_plan";
    }
  >();
  for (const decision of e.decisions ?? []) {
    if (decision.status !== "answered" || !decision.answer || decision.finishing_target) continue;
    if (
      decision.proposal_fingerprint &&
      e.plan_fingerprint &&
      decision.proposal_fingerprint !== e.plan_fingerprint
    )
      continue;
    const current = decision.generation === e.control_generation;
    const contract = decision.key === "scope-contract" && decision.session_id === "controller";
    const reviewedPlan =
      decision.session_id === "controller" &&
      !!decision.proposal_fingerprint &&
      decision.proposal_fingerprint === e.plan_fingerprint;
    if (!current && !contract && !reviewedPlan) continue;
    if (contract && e.scope) {
      let matches = false;
      try {
        matches = canonicalJson(JSON.parse(decision.answer)) === canonicalJson(e.scope.contract);
      } catch {
        /* Legacy free-text answers cannot identify an accepted contract. */
      }
      if (!matches) {
        if (current)
          throw new WorkflowError(
            "DECISION_CONFLICT",
            "The current scope answer conflicts with the accepted contract.",
          );
        continue;
      }
    } else if (!current && !reviewedPlan) continue;
    const prior = selected.get(decision.key);
    if (
      prior &&
      prior.generation === decision.generation &&
      (prior.answer !== decision.answer || prior.scope !== decision.scope)
    )
      throw new WorkflowError(
        "DECISION_CONFLICT",
        "Conflicting current answers for " + decision.key,
      );
    if (!prior || prior.generation <= decision.generation)
      selected.set(decision.key, {
        key: decision.key,
        generation: decision.generation,
        scope: decision.scope,
        answer: decision.answer,
        basis: current
          ? "current_generation"
          : reviewedPlan
            ? "reviewed_plan"
            : "accepted_contract",
      });
  }
  return [...selected.values()];
}

export function workerPrompt(
  e: Execution,
  issue: Issue,
  role: Role,
  decisions = assignmentDecisions(e),
) {
  const plan =
    e.workflow_policy === "full-openspec"
      ? `OpenSpec change: ${e.openspec_change}. Retained schema: ${e.openspec_schema_binding?.state === "bound" ? e.openspec_schema_binding.name : "original metadata"}. Load abra-openspec-execution.`
      : `Short contract revision: ${e.scope?.revision ?? "unavailable"}.`;
  const common = `You are the AbraCode ${role} for issue ${issue.id}: ${issue.title}.
${issue.description ?? ""}
${e.retry_instructions ? "Recovery feedback: " + e.retry_instructions : ""}
Control generation: ${e.control_generation}. Contract fingerprint: ${e.scope?.fingerprint ?? e.plan_fingerprint ?? "pending"}.
Applicable answers: ${JSON.stringify(decisions)}.
Base commit: ${e.base_commit}. Worktree: ${e.worktree_directory}
${plan} Human plan approval required: ${e.plan_approval_required}.
Read repository AGENTS.md and the registered role instructions. Remain in the assigned role/worktree.
${engineeringGuidance(role, e.workflow_policy)}`;

  const reviewGuide =
    role === "review" && hasReviewDelegate(e.configuration_snapshot?.definitions?.review)
      ? "Load abra-open-code-review-delegate and use abra_review_changes for the verified diff. "
      : "";
  if (role === "research")
    return (
      common +
      `Investigate read-only against the retained base. Contract: ${JSON.stringify(e.scope?.contract)}. Submit the structured research report through the existing controller tool.`
    );
  if (e.workflow_policy === "lightweight-fix")
    return (
      common +
      reviewGuide +
      `Approved short scope: ${JSON.stringify(e.scope?.contract)}. ${role === "apply" ? "Implement this scope and run configured checks." : "Review implementation and proof read-only against this scope and submit the review report."}`
    );
  const task = {
    explore:
      "Investigate this issue and complete the selected schema's required planning artifacts and tasks through abra_spec.",
    apply:
      "Implement this approved change completely, use abra_spec apply and update its real task checklist.",
    review:
      "Review this approved change and current implementation/proof read-only. Submit abra_review_report with full-spec verification evidence.",
  };
  const preceding =
    role === "explore" && e.plan_brief
      ? "\nPreceding plan brief: " + JSON.stringify(e.plan_brief)
      : "";
  return common + reviewGuide + task[role] + preceding;
}
