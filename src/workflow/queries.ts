import { historicalWorkers } from "./worker-assignment.ts";
import { loadConfig } from "../config/load.ts";
import { declarationDigest } from "../config/declarations.ts";
import { workerProfile } from "../config/snapshot.ts";
import { WorkerContexts, readWorkerContext } from "./worker-context.ts";
import { WorkerContextSummarySchema } from "./worker-context-contracts.ts";
import { decode } from "../decode.ts";
import { codingPolicy } from "../config/policy.ts";
import { explainIssues } from "../work/model.ts";
import {
  ArtifactId,
  RelativePath,
  IssueId,
  RepositoryId,
  AbsolutePath,
  SessionId,
} from "../identities.ts";

import { Effect } from "effect";
import { domainEffect } from "../effect.ts";
import {
  CrewError,
  terminal,
  type Config,
  type Execution,
  type Role,
  type ReadinessBlocker,
} from "../domain.ts";
import { type Records } from "../storage/store.ts";
import { type WorkGraph } from "../work/graph.ts";
import { type OpenSpec } from "../openspec/adapter.ts";
import { type Git } from "../git/repository.ts";
import { type Runtime } from "../opencode/runtime.ts";
import { diagnosticText } from "../opencode/diagnostics.ts";
import { capacityBlockers } from "./capacity.ts";
import { TicketDiff } from "../visibility/ticket-diff.ts";
import { type DiffScope } from "../visibility/protocol.ts";
/** Read-only workflow surface. No adapter or storage mutation is exposed to observers. */
export class Queries {
  constructor(
    private config: Config,
    private records: Records,
    private work: WorkGraph,
    private spec: OpenSpec,
    private git: Git,
    private runtime: Runtime,
    private reportReader?: (e: Execution) => Effect.Effect<string, CrewError>,
  ) {}
  get settings() {
    return {
      home: this.config.home,
      autoSchedule: this.config.auto_schedule,
      reconcileInterval: this.config.reconcile_interval_ms,
    };
  }
  private sessionID(e: Execution, role = e.active_role) {
    return role ? e[`${role}_session_id`] : undefined;
  }
  afterCommit = () => this.records.coordinateCommit(() => Effect.void);
  feedback = (id: IssueId, page = 0) => this.records.feedback(id, page);
  projects = () => this.records.projects();
  project = (id: RepositoryId) => this.records.project(id);
  executions = () => this.records.executions();
  execution = (id: IssueId) => this.records.execution(id);
  issues = () => this.work.list;
  issue = (id: IssueId) => this.work.show(id);
  history = (id: IssueId) => this.work.history(id);
  setup = (id: RepositoryId) => this.records.setup(id);
  recordDiagnostics = () => this.records.diagnostics();
  recordsExport = () => this.records.export();
  supervisor = () => this.records.supervisor();
  specStatus = (e: Execution) => this.spec.status(e);
  specApply = (e: Execution) => this.spec.apply(e);
  specInstructions = (e: Execution, artifact: ArtifactId) => this.spec.instructions(e, artifact);
  dirty = (path: AbsolutePath) => this.git.dirty(path);
  session = (id: SessionId) => this.runtime.session(id);
  inspectWorker = (issue: IssueId, session: SessionId) =>
    domainEffect(
      Effect.gen({ self: this }, function* () {
        const execution = yield* this.get(issue);
        const assignment = yield* this.assignment(session);
        if (!assignment || assignment.issue_id !== issue)
          return yield* new CrewError("NOT_FOUND", "Worker is not assigned to this ticket");
        const state = yield* this.runtime
          .session(session)
          .pipe(
            Effect.mapError(
              (error) => new CrewError("WORKER_UNAVAILABLE", diagnosticText(error.message)),
            ),
          );
        const historical = historicalWorkers(execution).find((worker) => worker.id === session);
        const role =
          historical?.role ??
          (["explore", "apply", "review", "research"] as const).find(
            (role) => execution[`${role}_session_id`] === session,
          );
        if (!role) return yield* new CrewError("NOT_FOUND", "Worker role is unavailable");
        return {
          id: session,
          role,
          model: state.model,
          configured_model: workerProfile(execution, role, this.config)?.model,
          outcome: state.outcome,
          busy: state.busy,
          recent_messages: state.recent_messages,
          note: "Read-only recent native evidence (up to 12 messages); unavailable history is not reconstructed. Talk to Abra to give instructions.",
        };
      }),
    );
  capturedWorkerPrompt = (e: Execution) =>
    e.worker_context_id
      ? readWorkerContext(this.records.store, e.worker_context_id)
      : Effect.fail(new CrewError("PROMPT_INTENT", "No retained worker context"));
  assignment = (sessionID: SessionId) =>
    this.records
      .executions()
      .pipe(
        Effect.map((executions) =>
          executions.find((e) =>
            [
              e.explore_session_id,
              e.apply_session_id,
              e.review_session_id,
              e.research_session_id,
              e.session_intent?.id,
              ...historicalWorkers(e).map((s) => s.id),
            ].includes(sessionID),
          ),
        ),
      );
  diff = (id: IssueId, scope: DiffScope, file?: RelativePath) =>
    new TicketDiff({
      issue: this.issue,
      execution: this.execution,
      project: this.project,
      git: { run: this.git.run.bind(this.git), validate: this.git.validate },
    }).read(id, scope, file);
  report = (id: IssueId) =>
    this.get(id).pipe(
      Effect.flatMap((e) =>
        this.reportReader
          ? this.reportReader(e)
          : Effect.fail(new CrewError("REPORT_UNAVAILABLE", "Report reader unavailable")),
      ),
    );
  effectiveProject = Effect.fn("Queries.effectiveProject")(
    function* (this: Queries, e: Execution) {
      const p = yield* this.records.project(e.repository_id);
      if (!p) return yield* new CrewError("PROJECT_MISSING", "Repository is no longer registered");
      if (!(e.delivery_policy === p.delivery))
        return yield* new CrewError(
          "POLICY_DRIFT",
          "Registered delivery policy changed during execution",
        );
      return { ...p, verification: e.effective_policy.verification };
    }.bind(this),
    domainEffect,
  );
  get = Effect.fn("Queries.get")(
    function* (this: Queries, id: IssueId): Effect.fn.Return<Execution, CrewError> {
      const e = yield* this.records.execution(id);
      if (!e) return yield* new CrewError("EXECUTION_MISSING", `No execution for ${id}`);
      return e;
    }.bind(this),
    domainEffect,
  );
  diagnostics = Effect.fn("Queries.diagnostics")(
    function* (this: Queries, id: IssueId, role?: Role) {
      const e = yield* this.get(id);
      const sessions = yield* Effect.forEach(
        (["explore", "apply", "review", "research"] as const).filter((r) => !role || r === role),
        (r) =>
          domainEffect(
            Effect.gen({ self: this }, function* () {
              const sessionID =
                this.sessionID(e, r) ??
                (e.session_intent?.role === r ? e.session_intent.id : undefined);
              if (!sessionID) return undefined;
              const configured_model = workerProfile(e, r, this.config)?.model ?? e.worker_model;
              return yield* domainEffect(
                Effect.gen({ self: this }, function* () {
                  const state = yield* this.runtime.session(sessionID);
                  if (state.directory !== e.worktree_directory)
                    return yield* new CrewError(
                      "SESSION_LOCATION",
                      "Managed session moved out of owned worktree",
                    );
                  return { role: r, configured_model, ...state };
                }),
              ).pipe(
                Effect.catch((error) =>
                  Effect.succeed({
                    id: sessionID,
                    role: r,
                    configured_model,
                    diagnostic_error: diagnosticText(error.message),
                  }),
                ),
              );
            }),
          ),
        { concurrency: "unbounded" },
      );
      return {
        issue_id: e.issue_id,
        current_phase: e.current_phase,
        resume_phase: e.resume_phase,
        worktree_directory: e.worktree_directory,
        inherited_model: e.worker_model,
        last_error: e.error_or_recovery_reason
          ? diagnosticText(e.error_or_recovery_reason)
          : undefined,
        last_worker_failure: e.worker_failure,
        sessions: sessions.filter((s) => s !== undefined),
        contexts: yield* Effect.forEach(
          (["explore", "apply", "review", "research"] as const).filter((r) => !role || r === role),
          (r) =>
            new WorkerContexts(this.records, this.config).summary(e, r).pipe(
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
        ),
      };
    }.bind(this),
    domainEffect,
  );
  /** One request owns these observations; later reads always acquire fresh collections. */
  observe = () =>
    Effect.all(
      {
        issues: this.work.list,
        projects: this.records.projectScan(),
        executions: this.records.executionScan(),
        setups: this.records.setupScan(),
      },
      { concurrency: "unbounded" },
    ).pipe(
      Effect.map((scans) => ({
        issues: scans.issues,
        explanation: explainIssues(scans.issues),
        projects: scans.projects.values,
        executions: scans.executions.values,
        setups: scans.setups.values,
        diagnostics: [
          ...scans.projects.diagnostics,
          ...scans.executions.diagnostics,
          ...scans.setups.diagnostics,
        ],
      })),
    );
  ready = (bundle?: ReadBundle) =>
    domainEffect(
      Effect.gen({ self: this }, function* () {
        const { explanation, projects, executions, diagnostics, setups } =
          bundle ?? (yield* this.observe());
        const declarationConfig = yield* loadConfig(this.config.home).pipe(
          Effect.match({
            onSuccess: (config) => ({ repositories: config.repositories, error: "" }),
            onFailure: (error) => ({ repositories: [], error: error.message }),
          }),
        );
        const all = [...explanation.ready, ...explanation.blocked];
        const readyIDs = new Set(explanation.ready.map((i) => i.id));
        const active = executions.filter((e) => !terminal(e));
        return all
          .filter((i) => i.status !== "closed")
          .map((issue) => {
            const blockers: string[] = [];
            const blocker_details: ReadinessBlocker[] = [];
            const block = (code: ReadinessBlocker["code"], message: string) => {
              blockers.push(message);
              blocker_details.push({ code, message });
            };
            if (diagnostics.length)
              block(
                "execution",
                "Unavailable durable records require inspection before new admission",
              );
            const native = explanation.blocked.find((i) => i.id === issue.id);
            if (!readyIDs.has(issue.id))
              block(
                native?.blocked_by?.length ? "dependency" : "status",
                native?.blocked_by?.length
                  ? `Dependency blockers: ${native.blocked_by.map((d) => `${d.id} (${d.title}, ${d.status})`).join(", ")}`
                  : `Issue status/dependencies prevent readiness (${issue.status})`,
              );
            const repository = issue.repository_id;
            const p = projects.find((p) => p.id === repository);
            const declaration = declarationConfig.repositories.find(
              (item) => item.id === repository,
            );
            if (declarationConfig.error)
              block("setup", `Configuration unavailable: ${declarationConfig.error}`);
            else if (!declaration)
              block(
                "setup",
                "Repository is retained but no longer declared; restore the declaration and apply configuration for new work",
              );
            else if (p?.declaration_digest !== declarationDigest(declaration))
              block(
                "setup",
                "Repository declaration is pending or changed; use config:apply before new work",
              );
            if (!p) block("setup", "Repository is not registered");
            else {
              try {
                codingPolicy(p, issue.workflow_policy, issue.quality_profile);
              } catch (error) {
                block("setup", CrewError.from(error).message);
              }
              if (issue.workflow_policy === "full-openspec" && !p.openspec)
                block("setup", "OpenSpec configuration is missing; use abra_project_setup");
              if (issue.workflow_policy !== "research-only" && !p.verification.length)
                block("setup", "Verification commands are missing");
            }
            const own = active.find((e) => e.issue_id === issue.id);
            if (own) block("execution", "Existing execution must be resumed");
            if (p && (!own || own.capacity_wait))
              for (const capacity of capacityBlockers(
                this.config,
                p,
                [...executions, ...setups],
                own?.capacity_wait?.role ??
                  (issue.workflow_policy === "research-only"
                    ? "research"
                    : issue.workflow_policy === "lightweight-fix"
                      ? "apply"
                      : "explore"),
                !own,
                own?.execution_id,
              )) {
                blockers.push(capacity.message);
                blocker_details.push(capacity);
              }
            return {
              issue,
              repository_id: repository,
              eligible: blockers.length === 0,
              blockers,
              blocker_details,
              dependencies: native?.blocked_by ?? issue.dependencies ?? [],
              execution: active.find((e) => e.issue_id === issue.id),
            };
          })
          .sort(
            (a, b) => a.issue.priority - b.issue.priority || a.issue.id.localeCompare(b.issue.id),
          );
      }),
    );
}

export type ReadBundle = Effect.Success<ReturnType<Queries["observe"]>>;
