import { canonicalJSON } from "../../presentation/identity.ts";
import { sha256 } from "../../digest.ts";
import { WorkflowError } from "../../errors.ts";
import { Effect } from "effect";
import { type IssueId, type SessionId, timestamp } from "@abracode/contracts/identities";
import { workerRoles } from "../../config/dispatch.ts";
import { workerProfile } from "../../config/snapshot.ts";
import { decode } from "../../decode.ts";
import {
  CrewError,
  type Config,
  type Execution,
  type Issue,
  type ReadinessBlocker,
  type Role,
} from "../../domain.ts";
import { type Git } from "../../git/repository.ts";
import { diagnosticText } from "../../opencode/diagnostics.ts";
import { type Runtime } from "../../opencode/runtime.ts";
import { type Records } from "../../storage/store.ts";
import { executionContract } from "./execution-contract.ts";
import {
  nativeActivity,
  supervisionClasses,
  supervisionSummary,
  type SupervisionSummary,
} from "./supervision.ts";
import { type CheckpointEvidence } from "../authorization.ts";
import {
  hasWorkerSession,
  historicalWorkers,
  nativeSessionIntent,
  workerSessionID,
} from "../worker-assignment.ts";
import { WorkerContexts } from "../worker-context.ts";
import { WorkerContextSummarySchema } from "../worker-context-contracts.ts";
import type { ReadBundle } from "./snapshot.ts";

export type WorkerQueryDeps = {
  config: Config;
  records: Records;
  runtime: Runtime;
  checkpoints: CheckpointEvidence;
  get: (id: IssueId) => Effect.Effect<Execution, CrewError>;
  executionContract: (e: Execution) => ReturnType<typeof executionContract>;
  sessionAvailability: (
    e: Execution,
    id: SessionId,
  ) => Effect.Effect<"available" | "unavailable" | "unverified">;
  observe: () => Effect.Effect<ReadBundle, CrewError>;
  ready: (bundle?: ReadBundle) => Effect.Effect<
    readonly {
      issue: { id: IssueId };
      blocker_details: readonly ReadinessBlocker[];
    }[],
    CrewError
  >;
};

/** Observation never collects a native answer or grants lifecycle authorization. */
export function observeCheckpoint(
  deps: Pick<WorkerQueryDeps, "records" | "checkpoints">,
  session: SessionId,
  form: string,
) {
  return Effect.gen(function* () {
    const executions = yield* deps.records.executions;
    const matches = yield* Effect.forEach(
      executions,
      (e) =>
        Effect.gen(function* () {
          const approval = yield* deps.checkpoints.observe(e, session, form);
          if (approval) return approval;
          const decision = e.decisions?.find(
            (d) => d.form_session === session && d.form_id === form,
          );
          if (!decision) return undefined;
          return {
            active:
              decision.status === "open" &&
              decision.generation === e.control_generation &&
              (!decision.proposal_fingerprint ||
                (e.current_phase === "awaiting_plan_approval" &&
                  decision.proposal_fingerprint === e.plan_fingerprint &&
                  (yield* deps.checkpoints.plan(e).pipe(Effect.orElseSucceed(() => undefined))) ===
                    e.plan_fingerprint)),
            issue_id: e.issue_id,
            kind: "decision" as const,
            identity: `${e.issue_id}:${decision.generation}:${decision.key}`,
            generation: e.control_generation,
            ...(decision.choices && { design_choices: sha256(canonicalJSON(decision.choices)) }),
            ...(decision.finishing_target
              ? {
                  finishing_target: sha256(JSON.stringify(decision.finishing_target)),
                }
              : {}),
          };
        }),
      { concurrency: "unbounded" },
    );
    return matches.find((match) => match !== undefined) ?? { active: false };
  });
}

export function inspectWorker(
  deps: Pick<
    WorkerQueryDeps,
    "config" | "runtime" | "get" | "executionContract" | "sessionAvailability"
  >,
  issue: IssueId,
  session: SessionId,
) {
  return Effect.gen(function* () {
    const execution = yield* deps.get(issue);
    if (!hasWorkerSession(execution, session))
      return yield* new WorkflowError("NOT_FOUND", "Worker is not assigned to this ticket");
    if ((yield* deps.sessionAvailability(execution, session)) === "unavailable")
      return yield* new WorkflowError(
        "WORKER_UNAVAILABLE",
        "The native session is missing or belongs to another task",
      );
    const state = yield* deps.runtime
      .session(session)
      .pipe(
        Effect.mapError(
          (error) => new WorkflowError("WORKER_UNAVAILABLE", diagnosticText(error.message)),
        ),
      );
    const historical = historicalWorkers(execution).find((worker) => worker.id === session);
    const role =
      historical?.role ?? workerRoles.find((r) => execution[`${r}_session_id`] === session);
    if (!role) return yield* new WorkflowError("NOT_FOUND", "Worker role is unavailable");
    return {
      id: session,
      execution_contract: deps.executionContract(execution),
      role,
      model: state.model,
      configured_model: workerProfile(execution, role, deps.config)?.model,
      model_source: execution.configuration_snapshot?.dispatch_sources?.[role],
      outcome: state.outcome,
      busy: state.busy,
      executing: state.executing,
      native_activity: nativeActivity(state),
      observed_at: yield* timestamp,
      recent_messages: state.recent_messages,
      note: "Read-only recent native evidence (up to 12 messages); unavailable history is not reconstructed. Talk to Abra to give instructions.",
    };
  });
}

export function observeSupervision(
  deps: Pick<WorkerQueryDeps, "runtime">,
  e: Execution | undefined,
  blockers: readonly ReadinessBlocker[] = [],
  closed = false,
) {
  return Effect.gen(function* () {
    const session = e?.active_role && e[`${e.active_role}_session_id`];
    const observed = session ? yield* deps.runtime.session(session).pipe(Effect.result) : undefined;
    return supervisionSummary({
      execution: e,
      blockers,
      closed,
      native: observed?._tag === "Success" ? observed.success : undefined,
      unavailable: observed?._tag === "Failure",
      observed_at: yield* timestamp,
    });
  });
}

export function supervisionAggregate(
  deps: Pick<WorkerQueryDeps, "runtime" | "observe" | "ready">,
  bundle?: ReadBundle,
  readiness?: readonly {
    issue: { id: IssueId };
    blocker_details: readonly ReadinessBlocker[];
  }[],
) {
  return Effect.gen(function* () {
    const observation = bundle ?? (yield* deps.observe());
    const ready = readiness ?? (yield* deps.ready(observation));
    const executionByIssue = new Map(observation.executions.map((e) => [e.issue_id, e]));
    const readinessByIssue = new Map(ready.map((r) => [r.issue.id, r]));
    const active = new Set(
      observation.executions.filter((e) => e.active_role).map((e) => e.issue_id),
    );
    const rows = [...observation.issues]
      .sort(
        (a, b) =>
          Number(a.status === "closed") - Number(b.status === "closed") ||
          Number(!active.has(a.id)) - Number(!active.has(b.id)) ||
          a.priority - b.priority ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      )
      .slice(0, 128);
    const tasks = yield* Effect.forEach(
      rows,
      (issue) =>
        observeSupervision(
          deps,
          executionByIssue.get(issue.id),
          readinessByIssue.get(issue.id)?.blocker_details,
          issue.status === "closed",
        ).pipe(Effect.map((summary) => ({ issue_id: issue.id, ...summary }))),
      { concurrency: 4 },
    );
    const counts = Object.fromEntries(supervisionClasses.map((kind) => [kind, 0])) as Record<
      SupervisionSummary["primary"],
      number
    >;
    for (const task of tasks) counts[task.primary] = (counts[task.primary] ?? 0) + 1;
    return {
      observed_at: yield* timestamp,
      counts,
      tasks,
      total: observation.issues.length,
      truncated: rows.length < observation.issues.length,
    };
  });
}

export function queryDiagnostics(
  deps: Pick<WorkerQueryDeps, "config" | "records" | "runtime" | "get" | "executionContract">,
  id: IssueId,
  role?: Role,
) {
  return Effect.gen(function* () {
    const e = yield* deps.get(id);
    const selectedRoles = workerRoles.filter((r) => !role || r === role);
    const sessions = yield* Effect.forEach(
      selectedRoles,
      (r) =>
        Effect.gen(function* () {
          const intent = nativeSessionIntent(e);
          const sessionID = workerSessionID(e, r) ?? (intent?.role === r ? intent.id : undefined);
          if (!sessionID) return undefined;
          const configured_model = workerProfile(e, r, deps.config)?.model ?? e.worker_model;
          const model_source = e.configuration_snapshot?.dispatch_sources?.[r];
          return yield* Effect.gen(function* () {
            const state = yield* deps.runtime.session(sessionID);
            if (state.directory !== e.worktree_directory)
              return yield* new WorkflowError(
                "SESSION_LOCATION",
                "Managed session moved out of owned worktree",
              );
            return { role: r, configured_model, model_source, ...state };
          }).pipe(
            Effect.catch((error) =>
              Effect.succeed({
                id: sessionID,
                role: r,
                configured_model,
                model_source,
                diagnostic_error: diagnosticText(error.message),
              }),
            ),
          );
        }),
      { concurrency: "unbounded" },
    );
    const contexts = yield* Effect.forEach(selectedRoles, (r) =>
      new WorkerContexts(deps.records, deps.config).summary(e, r).pipe(
        Effect.catch((error) =>
          decode(
            WorkerContextSummarySchema,
            {
              role: r,
              provenance: "invalid",
              references: [],
              skills: [],
              required_tools: [],
              decisions: [],
              omitted: 0,
              current_inventory: "not_observed",
              native_context: "not_captured",
              status: {
                schema_version: 1,
                execution_id: e.execution_id,
                role: r,
                generation: e.control_generation,
                stage: "blocked",
                blocker: {
                  code: error.code,
                  message: diagnosticText(error.message).slice(0, 2048),
                  clearing_action:
                    "Repair retained context evidence without reconstructing historic instructions",
                },
                at: e.updated_at,
              },
            },
            "Invalid context summary",
          ),
        ),
      ),
    );
    return {
      issue_id: e.issue_id,
      execution_contract: deps.executionContract(e),
      current_phase: e.current_phase,
      resume_phase: e.resume_phase,
      worktree_directory: e.worktree_directory,
      inherited_model: e.worker_model,
      last_error: e.error_or_recovery_reason
        ? diagnosticText(e.error_or_recovery_reason)
        : undefined,
      last_worker_failure: e.worker_failure,
      sessions: sessions.filter((s) => s !== undefined),
      contexts,
    };
  });
}

export function queryVerification(
  deps: {
    issue: (id: IssueId) => Effect.Effect<Issue, CrewError>;
    execution: (id: IssueId) => Effect.Effect<Execution | undefined, CrewError>;
    git: Pick<Git, "fingerprint">;
  },
  id: IssueId,
) {
  return Effect.gen(function* () {
    yield* deps.issue(id);
    const e = yield* deps.execution(id);
    if (!e) return { checks: [] };
    const receipt = e.verification_receipt;
    const checks = [...(e.check_history ?? [])];
    if (receipt && !checks.some((c) => c.fingerprint === receipt.fingerprint)) {
      checks.push({
        at: receipt.at,
        fingerprint: receipt.fingerprint,
        commands: receipt.commands.map((command) =>
          (Array.isArray(command) ? command : command.argv).join(" "),
        ),
      });
    }
    const observed =
      e.worktree_directory && (checks.length || e.review_receipt)
        ? yield* deps.git
            .fingerprint(e.worktree_directory)
            .pipe(Effect.orElseSucceed(() => undefined))
        : undefined;
    return {
      checks,
      ...(e.worker_references && { references: e.worker_references }),
      ...(e.worker_evidence && { evidence: e.worker_evidence }),
      ...(observed && { observed }),
      ...(e.review_receipt && { review: e.review_receipt }),
      ...(e.scope && { scope: e.scope.contract }),
      ...(e.plan_fingerprint && { plan: e.plan_fingerprint }),
    };
  });
}
