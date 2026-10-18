import { validateDispatch } from "../config/dispatch.ts";
import {
  supervisionSummary,
  nativeActivity,
  supervisionClasses,
  type SupervisionSummary,
} from "../visibility/supervision.ts";
import { historicalWorkers } from "./worker-assignment.ts";
import { messageRequests, requiresResponse, MessagesPageSchema } from "./message-contracts.ts";
import { timestamp } from "../identities.ts";
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
  MessageId,
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
import { type Runtime, type PromptAdmission } from "../opencode/runtime.ts";
import { diagnosticText } from "../opencode/diagnostics.ts";
import { capacityBlockers } from "./capacity.ts";
import { TicketDiff } from "../visibility/ticket-diff.ts";
import { type DiffScope } from "../visibility/protocol.ts";
import { type LeadSummary } from "../visibility/protocol.ts";
import { scanLeads } from "./lead-contracts.ts";
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
      supervisionMode: this.config.supervision_mode,
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
  completions = (...args: Parameters<WorkGraph["completions"]>) => this.work.completions(...args);
  setup = (id: RepositoryId) => this.records.setup(id);
  recordDiagnostics = () => this.records.diagnostics();
  recordsExport = () => this.records.export();
  supervisor = () => this.records.supervisor();
  leadOverview = (bundle: ReadBundle) =>
    domainEffect(
      Effect.gen({ self: this }, function* () {
        const scan = yield* scanLeads(this.records);
        const observed_at = yield* timestamp;
        const leads = yield* Effect.forEach(
          scan.records,
          (lead) =>
            Effect.gen({ self: this }, function* () {
              const observed = yield* this.runtime.session(lead.session_id).pipe(Effect.result);
              const native = observed._tag === "Success" ? observed.success : undefined;
              const available =
                native?.directory === this.config.home && native.agent === "project-lead";
              const activity = nativeActivity(native);
              const state: LeadSummary["state"] = lead.stop_pending
                ? "stopping"
                : !lead.enabled
                  ? "disabled"
                  : !lead.provisioned
                    ? "provisioning"
                    : !available
                      ? "unavailable"
                      : activity === "unavailable" || activity === "unobserved"
                        ? "unknown"
                        : activity;
              const latest = lead.requests
                .flatMap((r) => (r.request.reply ? [r.request.reply] : []))
                .sort((a, b) => b.at.localeCompare(a.at))[0];
              return {
                id: lead.id,
                revision: lead.revision,
                repositories: lead.repositories,
                enabled: lead.enabled,
                session_id: lead.session_id,
                session_available: available ?? false,
                parent_session_id: lead.parent_session_id,
                state,
                observed_at,
                request_count: lead.requests.length,
                outstanding_count: lead.requests.filter((r) => requiresResponse(r.request)).length,
                requests: lead.requests
                  .filter((r) => requiresResponse(r.request))
                  .slice(0, 20)
                  .map((r) => ({
                    issue_id: r.issue_id,
                    request_id: r.request.request_id,
                    status: r.request.status,
                    question: diagnosticText(r.request.body ?? "Controller request", 1500),
                    reply: r.request.reply ? diagnosticText(r.request.reply.body, 1500) : undefined,
                  })),
                pending_proposals: lead.proposals
                  .filter((p) => !p.accepted)
                  .map((p) => p.request_id),
                assigned_work: bundle.issues
                  .filter(
                    (i) => lead.repositories.includes(i.repository_id) && i.status !== "closed",
                  )
                  .map((i) => i.id),
                latest_outcome: latest ? diagnosticText(latest.body, 1500) : undefined,
              };
            }),
          { concurrency: 4 },
        );
        return { leads, diagnostics: scan.errors.map((e) => diagnosticText(e.message)) };
      }),
    );
  automaticAuthority = Effect.fn("Queries.automaticAuthority")(
    function* (
      this: Queries,
    ): Effect.fn.Return<{ session_id?: SessionId; blocker?: ReadinessBlocker }, CrewError> {
      const session = yield* this.records.supervisor();
      if (!session)
        return {
          blocker: {
            code: "authority",
            message: "Automatic scheduling requires a retained Abra session",
          },
        };
      const state = yield* this.runtime.session(session).pipe(Effect.result);
      if (state._tag === "Failure")
        return {
          blocker: {
            code: "authority",
            message: `Retained Abra is unavailable: ${diagnosticText(state.failure.message)}`,
          },
        };
      if (state.success.directory !== this.config.home || state.success.agent !== "abra")
        return {
          blocker: {
            code: "authority",
            message: "Retained automatic-scheduling authority is not Abra in the central checkout",
          },
        };
      return { session_id: session };
    }.bind(this),
    domainEffect,
  );
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
          model_source: execution.configuration_snapshot?.dispatch_sources?.[role],
          outcome: state.outcome,
          busy: state.busy,
          executing: state.executing,
          native_activity: nativeActivity(state),
          observed_at: yield* timestamp,
          recent_messages: state.recent_messages,
          note: "Read-only recent native evidence (up to 12 messages); unavailable history is not reconstructed. Talk to Abra to give instructions.",
        };
      }),
    );
  supervision = (
    e: Execution | undefined,
    blockers: readonly ReadinessBlocker[] = [],
    closed = false,
  ) =>
    domainEffect(
      Effect.gen({ self: this }, function* () {
        const session = e?.active_role && e[`${e.active_role}_session_id`];
        const observed = session
          ? yield* this.runtime.session(session).pipe(Effect.result)
          : undefined;
        return supervisionSummary({
          execution: e,
          blockers,
          closed,
          native: observed?._tag === "Success" ? observed.success : undefined,
          unavailable: observed?._tag === "Failure",
          observed_at: yield* timestamp,
        });
      }),
    );
  supervisionAggregate = (bundle?: ReadBundle) =>
    domainEffect(
      Effect.gen({ self: this }, function* () {
        const observation = bundle ?? (yield* this.observe());
        const ready = yield* this.ready(observation);
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
            this.supervision(
              observation.executions.find((e) => e.issue_id === issue.id),
              ready.find((r) => r.issue.id === issue.id)?.blocker_details,
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
      }),
    );
  capturedWorkerPrompt = (e: Execution) =>
    e.worker_context_id
      ? readWorkerContext(this.records.store, e.worker_context_id)
      : Effect.fail(new CrewError("PROMPT_INTENT", "No retained worker context"));
  messages = Effect.fn("Queries.messages")(
    function* (this: Queries, id: IssueId, offset = 0, limit = 20) {
      if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 50
      )
        return yield* new CrewError(
          "MESSAGE_PAGE",
          "Use a nonnegative offset and limit between 1 and 50",
        );
      const e = yield* this.get(id);
      const messages = e.messages ?? [];
      const page = messages.slice(offset, offset + limit);
      const requests = messageRequests(page);
      const observations = new Map(
        yield* Effect.forEach(
          [...new Set(requests.map((m) => m.recipient_session_id))],
          (session) =>
            Effect.gen({ self: this }, function* () {
              const state = yield* this.runtime.session(session).pipe(Effect.result);
              const admissions = yield* this.runtime
                .promptAdmissions(
                  session,
                  requests
                    .filter((m) => m.recipient_session_id === session)
                    .flatMap((m) => [
                      { prompt_id: m.prompt_id, prompt: m.prompt },
                      ...(m.response_recovery
                        ? [
                            {
                              prompt_id: m.response_recovery.prompt_id,
                              prompt: m.response_recovery.prompt,
                            },
                          ]
                        : []),
                    ]),
                )
                .pipe(Effect.orElseSucceed(() => new Map<MessageId, PromptAdmission>()));
              return [
                session,
                { state: state._tag === "Success" ? state.success : undefined, admissions },
              ] as const;
            }),
          { concurrency: 4 },
        ),
      );
      const entries: Array<(typeof MessagesPageSchema.Type)["entries"][number]> = page.map(
        (record) => {
          if (record.type === "finding") return { record };
          const observation = observations.get(record.recipient_session_id)!;
          const activity = nativeActivity(observation.state, !observation.state);
          const decisionKey = record.source?.type === "decision" ? record.source.key : undefined;
          const escalation = e.attention?.findLast(
            (a) =>
              a.code === "message_pending" &&
              a.message_refs?.some((ref) => ref.request_id === record.request_id),
          );
          return {
            record,
            native: observation.admissions.get(record.prompt_id) ?? "unavailable",
            recovery_native: record.response_recovery
              ? (observation.admissions.get(record.response_recovery.prompt_id) ?? "unavailable")
              : undefined,
            native_state: activity === "unobserved" ? "unknown" : activity,
            native_outcome: observation.state?.outcome,
            escalation: escalation
              ? {
                  id: escalation.id,
                  status: escalation.status,
                  evidence: escalation.evidence,
                  disposition: escalation.disposition,
                }
              : undefined,
            decision: decisionKey
              ? e.decisions?.find(
                  (d) => d.key === decisionKey && d.generation === record.generation,
                )
              : undefined,
          };
        },
      );
      return {
        entries,
        total: messages.length,
        outstanding: messageRequests(messages).filter(requiresResponse).length,
        offset,
        limit,
        next_offset: offset + limit < messages.length ? offset + limit : undefined,
        observed_at: yield* timestamp,
      };
    }.bind(this),
    domainEffect,
  );
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
              const model_source = e.configuration_snapshot?.dispatch_sources?.[r];
              return yield* domainEffect(
                Effect.gen({ self: this }, function* () {
                  const state = yield* this.runtime.session(sessionID);
                  if (state.directory !== e.worktree_directory)
                    return yield* new CrewError(
                      "SESSION_LOCATION",
                      "Managed session moved out of owned worktree",
                    );
                  return { role: r, configured_model, model_source, ...state };
                }),
              ).pipe(
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
        const authority = this.config.auto_schedule
          ? (yield* this.automaticAuthority()).blocker
          : undefined;
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
            if (authority) block(authority.code, authority.message);
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
                if (!active.some((e) => e.issue_id === issue.id)) {
                  validateDispatch(this.config, p.dispatch);
                  validateDispatch(this.config, issue.dispatch);
                }
              } catch (error) {
                block("setup", CrewError.from(error).message);
              }
              if (issue.workflow_policy === "full-openspec" && !p.openspec)
                block("setup", "OpenSpec configuration is missing; use abra_project_setup");
              if (issue.workflow_policy !== "research-only" && !p.verification.length)
                block("setup", "Verification commands are missing");
            }
            const own = active.find((e) => e.issue_id === issue.id);
            if (own)
              block(
                "execution",
                own.current_phase === "interrupted"
                  ? "Execution is paused; explicit resume is required"
                  : own.error_or_recovery_reason &&
                      ["failed", "blocked", "recovery_required"].includes(own.current_phase)
                    ? `Execution is ${own.current_phase}: ${diagnosticText(own.error_or_recovery_reason)}`
                    : own.capacity_wait
                      ? `Execution is waiting for ${own.capacity_wait.role} capacity`
                      : own.active_role
                        ? `${own.active_role} execution is already assigned; inspect native activity`
                        : `Existing execution is ${own.current_phase}${own.error_or_recovery_reason ? `: ${diagnosticText(own.error_or_recovery_reason)}` : "; inspect its retained obligations"}`,
              );
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
