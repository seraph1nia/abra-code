import { retainedEvidence } from "./worker-evidence.ts";
import type { EvidenceQuery } from "@abracode/contracts/web/worker-evidence";
import { archivedPlans } from "../visibility/archived-plans.ts";
import { CheckpointEvidence } from "./authorization.ts";
import { createHash } from "node:crypto";
import { executionContract } from "../visibility/execution-contract.ts";
import { retainedReadiness } from "./readiness.ts";
import { localDay } from "../visibility/fleet.ts";
import { changeDocument, changeDocuments } from "../visibility/documents.ts";
import {
  supervisionSummary,
  nativeActivity,
  supervisionClasses,
  type SupervisionSummary,
} from "../visibility/supervision.ts";
import {
  hasWorkerSession,
  historicalWorkers,
  nativeSessionIntent,
  workerSessionID,
} from "./worker-assignment.ts";
import { messageRequests, requiresResponse, MessagesPageSchema } from "./message-contracts.ts";
import { timestamp } from "../identities.ts";
import { loadConfig } from "../config/load.ts";
import { declarationDigest } from "../config/declarations.ts";
import { workerProfile } from "../config/snapshot.ts";
import { WorkerContexts, readWorkerContext } from "./worker-context.ts";
import { WorkerContextSummarySchema } from "./worker-context-contracts.ts";
import { decode } from "../decode.ts";
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

import { Clock, Effect, Schedule } from "effect";
import { domainEffect } from "../effect.ts";
import {
  CrewError,
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
import { summarizeCapacity, type CapacitySummary } from "./capacity.ts";
import { TicketDiff } from "../visibility/ticket-diff.ts";
import { type DiffScope } from "../visibility/protocol.ts";
import { type LeadSummary } from "../visibility/protocol.ts";
import {
  LeadEvidenceQuery,
  LeadEvidencePageSchema,
  LeadAttentionSchema,
} from "../visibility/lead-observation.ts";
import { scanLeads, type LeadRecord } from "./lead-contracts.ts";
import type { WorkDiscovery } from "@abracode/contracts/visibility/discovery-contracts";
type FinderCapacity = {
  revision: string | undefined;
  capacity: CapacitySummary;
  recordsUnavailable: boolean;
  authority?: ReadinessBlocker;
};
/** Read-only workflow surface. No adapter or storage mutation is exposed to observers. */
export class Queries {
  private finderCapacity?: FinderCapacity;
  constructor(
    private config: Config,
    private records: Records,
    private work: WorkGraph,
    private spec: OpenSpec,
    private git: Git,
    private runtime: Runtime,
    private reportReader?: (e: Execution) => Effect.Effect<string, CrewError>,
    private checkpoints = new CheckpointEvidence(git),
  ) {}
  get settings() {
    return {
      home: this.config.home,
      autoSchedule: this.config.auto_schedule,
      supervisionMode: this.config.supervision_mode,
      reconcileInterval: this.config.reconcile_interval_ms,
    };
  }
  executionContract = (e: Execution) => executionContract(e, this.config.supervision_mode);
  afterCommit = () => this.records.coordinateCommit(() => Effect.void);
  evidence = (query: EvidenceQuery) =>
    this.execution(query.issue_id).pipe(
      Effect.flatMap((e) => retainedEvidence(this.records.store, e, query)),
    );
  verification = (id: IssueId) =>
    Effect.gen({ self: this }, function* () {
      yield* this.issue(id);
      const e = yield* this.execution(id);
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
          ? yield* this.git
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
  /** Observation never collects a native answer or grants lifecycle authorization. */
  checkpoint = (session: SessionId, form: string) =>
    Effect.gen({ self: this }, function* () {
      for (const e of yield* this.records.executions()) {
        const approval = yield* this.checkpoints.observe(e, session, form);
        if (approval) return approval;
        const decision = e.decisions?.find((d) => d.form_session === session && d.form_id === form);
        if (decision)
          return {
            active: decision.status === "open" && decision.generation === e.control_generation,
            issue_id: e.issue_id,
            kind: "decision" as const,
            identity: `${e.issue_id}:${decision.generation}:${decision.key}`,
            generation: e.control_generation,
            ...(decision.finishing_target
              ? {
                  finishing_target: createHash("sha256")
                    .update(JSON.stringify(decision.finishing_target))
                    .digest("hex"),
                }
              : {}),
          };
      }
      return { active: false };
    });
  private observeLead = (lead: LeadRecord, bundle: ReadBundle) =>
    domainEffect(
      Effect.gen({ self: this }, function* () {
        const observed = yield* this.runtime.session(lead.session_id).pipe(Effect.result);
        const native = observed._tag === "Success" ? observed.success : undefined;
        const available = native?.directory === this.config.home && native.agent === "project-lead";
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
          observed_at: yield* timestamp,
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
          pending_proposals: lead.proposals.filter((p) => !p.accepted).map((p) => p.request_id),
          assigned_work: bundle.issues
            .filter((i) => lead.repositories.includes(i.repository_id) && i.status !== "closed")
            .map((i) => i.id),
          latest_outcome: latest ? diagnosticText(latest.body, 1500) : undefined,
        };
      }),
    );
  leadOverview = (bundle: ReadBundle) =>
    domainEffect(
      Effect.gen({ self: this }, function* () {
        const scan = yield* scanLeads(this.records);
        const leads = yield* Effect.forEach(
          scan.records,
          (lead) => this.observeLead(lead, bundle),
          { concurrency: 4 },
        );
        const repositories = new Map(bundle.issues.map((issue) => [issue.id, issue.repository_id]));
        const attention: Array<(typeof LeadAttentionSchema.Type.entries)[number]> = [];
        for (const lead of scan.records) {
          const scope = new Set([
            ...lead.repositories,
            ...lead.proposals.flatMap((proposal) =>
              proposal.batch.tasks.map((task) => task.repository_id),
            ),
            ...lead.requests.flatMap((request) => repositories.get(request.issue_id) ?? []),
          ]);
          for (const repository_id of scope) {
            const unanswered = lead.requests.filter(
              (request) =>
                repositories.get(request.issue_id) === repository_id &&
                requiresResponse(request.request),
            ).length;
            const proposals = lead.proposals.filter(
              (proposal) =>
                !proposal.accepted &&
                proposal.batch.tasks.some((task) => task.repository_id === repository_id),
            ).length;
            if (unanswered || proposals)
              attention.push({
                lead_id: lead.id,
                repository_id,
                state: leads.find((summary) => summary.id === lead.id)!.state,
                unanswered,
                proposals,
              });
          }
        }
        return {
          leads,
          diagnostics: scan.errors.map((error) => diagnosticText(error.message)),
          attention: {
            entries: attention.slice(0, 20),
            total: attention.length,
            truncated: attention.length > 20,
            diagnostic_count: scan.errors.length,
          },
        };
      }),
    );
  leadEvidence = (input: typeof LeadEvidenceQuery.Type) =>
    domainEffect(
      Effect.gen({ self: this }, function* () {
        const query = yield* decode(LeadEvidenceQuery, input, "Lead evidence query");
        const issue = query.issue_id ? yield* this.issue(query.issue_id) : undefined;
        const repository_id = issue?.repository_id ?? query.repository_id!;
        if (!issue && !(yield* this.project(repository_id)))
          return yield* new CrewError("NOT_FOUND", "Repository is not registered");
        const bundle = yield* this.observe();
        const requestsFor = (lead: LeadRecord) =>
          lead.requests.filter((request) =>
            issue
              ? request.issue_id === issue.id
              : bundle.issues.some(
                  (task) => task.id === request.issue_id && task.repository_id === repository_id,
                ),
          );
        const scan = yield* scanLeads(this.records);
        const proposalsFor = (lead: LeadRecord) =>
          lead.proposals.filter((proposal) =>
            proposal.batch.tasks.some((task) => task.repository_id === repository_id),
          );
        const scoped = scan.records
          .filter(
            (lead) =>
              lead.repositories.includes(repository_id) ||
              requestsFor(lead).length > 0 ||
              proposalsFor(lead).length > 0 ||
              lead.proposals.some((proposal) =>
                proposal.accepted?.tasks.some((task) => task.issue.repository_id === repository_id),
              ),
          )
          .sort((a, b) => a.id.localeCompare(b.id));
        const selected = query.lead_id
          ? scoped.find((lead) => lead.id === query.lead_id)
          : undefined;
        if (query.lead_id && !selected)
          return yield* new CrewError(
            "INVALID_SELECTION",
            "This lead has no configured or retained relationship to the selected task",
          );
        const offset = query.offset ?? 0;
        const entries = yield* Effect.forEach(
          selected ? [selected] : scoped.slice(offset, offset + 20),
          (lead) =>
            Effect.gen({ self: this }, function* () {
              const summary = yield* this.observeLead(lead, bundle);
              const requests = requestsFor(lead);
              const proposals = proposalsFor(lead);
              return {
                id: summary.id,
                revision: summary.revision,
                repositories: summary.repositories,
                enabled: summary.enabled,
                session_id: summary.session_id,
                session_available: summary.session_available,
                state: summary.state,
                observed_at: summary.observed_at,
                model: lead.model,
                request_count: requests.length,
                outstanding_count: requests.filter((request) => requiresResponse(request.request))
                  .length,
                proposal_count: proposals.length,
                pending_proposal_count: proposals.filter((proposal) => !proposal.accepted).length,
                scope: lead.repositories.includes(repository_id)
                  ? ("configured_repository" as const)
                  : ("retained_history" as const),
              };
            }),
          { concurrency: 4 },
        );
        let detail: typeof LeadEvidencePageSchema.Type.detail;
        if (selected) {
          const requests = requestsFor(selected);
          const proposals = proposalsFor(selected);
          const request_offset = query.request_offset ?? 0,
            proposal_offset = query.proposal_offset ?? 0;
          const captured = new Set([
            ...(issue ? [issue.id] : []),
            ...requests.map((request) => request.issue_id),
            ...proposals.flatMap(
              (proposal) =>
                proposal.accepted?.tasks
                  .filter((task) => task.issue.repository_id === repository_id)
                  .map((task) => task.issue.id) ?? [],
            ),
          ]);
          const related = bundle.issues.filter(
            (task) =>
              task.repository_id === repository_id &&
              (selected.repositories.includes(repository_id) || captured.has(task.id)),
          );
          detail = {
            lead_id: selected.id,
            retired_sessions: selected.retired_sessions,
            requests: requests
              .slice(request_offset, request_offset + 10)
              .map(({ issue_id, request }) => ({
                issue_id,
                request_id: request.request_id,
                generation: request.generation,
                recipient_session_id: request.recipient_session_id,
                body: request.body,
                response: request.response,
                source: request.source,
                status: request.status,
                created_at: request.created_at,
                acknowledged_at: request.acknowledged_at,
                reply: request.reply,
                recovery: request.response_recovery?.status,
              })),
            request_limit: 10,
            request_total: requests.length,
            request_offset,
            request_next: request_offset + 10 < requests.length ? request_offset + 10 : undefined,
            proposals: proposals.slice(proposal_offset, proposal_offset + 5).map((proposal) => ({
              request_id: proposal.request_id,
              revision: proposal.revision,
              accepted: !!proposal.accepted,
              tasks: proposal.batch.tasks
                .filter((task) => task.repository_id === repository_id)
                .map((task) => ({
                  key: task.client_key,
                  title: diagnosticText(task.title, 256),
                  description: diagnosticText(task.description, 1500),
                  repository_id: task.repository_id,
                  policy: task.workflow_policy,
                  priority: task.priority,
                  dependencies: (task.dependencies ?? []).slice(0, 32),
                  accepted_issue_id: proposal.accepted?.tasks.find(
                    (accepted) => accepted.client_key === task.client_key,
                  )?.issue.id,
                  limited:
                    task.title.length > 256 ||
                    task.description.length > 1500 ||
                    (task.dependencies?.length ?? 0) > 32,
                })),
            })),
            proposal_total: proposals.length,
            proposal_offset,
            proposal_next: proposal_offset + 5 < proposals.length ? proposal_offset + 5 : undefined,
            related_work: related
              .slice(0, 50)
              .map((task) => ({ issue_id: task.id, title: task.title, issue_status: task.status })),
            related_total: related.length,
          };
        }
        return yield* decode(
          LeadEvidencePageSchema,
          {
            issue_id: issue?.id,
            repository_id,
            observed_at: yield* timestamp,
            entries,
            total: scoped.length,
            offset,
            next_offset: !selected && offset + 20 < scoped.length ? offset + 20 : undefined,
            diagnostics: scan.errors.map((error) => diagnosticText(error.message)).slice(0, 20),
            detail,
          },
          "Lead evidence page",
        );
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
  planDocuments = (e: Execution) =>
    domainEffect(
      Effect.gen({ self: this }, function* () {
        if (e.archive_path || e.current_phase === "completed") {
          const archive = yield* archivedPlans(this.git, yield* this.project(e.repository_id), e);
          return {
            paths: archive.paths,
            observation: {
              source: "archive" as const,
              commit: archive.commit,
              limited: archive.limited,
            },
          };
        }
        const paths = yield* changeDocuments(e);
        return {
          paths,
          observation: { source: "worktree" as const, limited: paths.length >= 100 },
        };
      }),
    );
  planDocument = (e: Execution, path: RelativePath) =>
    domainEffect(
      Effect.gen({ self: this }, function* () {
        if (e.archive_path || e.current_phase === "completed") {
          const archive = yield* archivedPlans(this.git, yield* this.project(e.repository_id), e);
          return yield* archive.read(path);
        }
        const paths = yield* changeDocuments(e);
        if (!paths.includes(path))
          return yield* new CrewError("SPEC_PATH", "Select a document from the owned change");
        return yield* changeDocument(e, path);
      }),
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
        if (!hasWorkerSession(execution, session))
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
          execution_contract: this.executionContract(execution),
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
  supervisionAggregate = (
    bundle?: ReadBundle,
    readiness?: readonly {
      issue: { id: IssueId };
      blocker_details: readonly ReadinessBlocker[];
    }[],
  ) =>
    domainEffect(
      Effect.gen({ self: this }, function* () {
        const observation = bundle ?? (yield* this.observe());
        const ready = readiness ?? (yield* this.ready(observation));
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
  assignment = (sessionID: SessionId) => this.records.workerAssignment(sessionID);
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
      if (e.delivery_policy !== p.delivery)
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
              const intent = nativeSessionIntent(e);
              const sessionID =
                workerSessionID(e, r) ?? (intent?.role === r ? intent.id : undefined);
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
        execution_contract: this.executionContract(e),
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
  /** Capture retained state only; native/session and filesystem projections run afterward.
   * The global record lock plus graph revision validation covers intake commits
   * that intentionally occur outside that lock. Three nonblocking attempts and
   * a 500 ms attempt deadline bound contention and slow storage observations.
   */
  private capture<A>(read: (revision: string) => Effect.Effect<A, CrewError>) {
    return this.records
      .coordinateRead(() =>
        domainEffect(
          Effect.gen({ self: this }, function* () {
            const revision = yield* this.work.revision;
            const value = yield* read(revision);
            if (revision !== (yield* this.work.revision))
              return yield* new CrewError(
                "OBSERVATION_CHANGED",
                "Work graph changed during retained-state capture",
              );
            return value;
          }),
        ),
      )
      .pipe(
        Effect.timeoutOrElse({
          duration: "500 millis",
          orElse: () =>
            Effect.fail(
              new CrewError("OBSERVATION_TIMEOUT", "Retained-state capture exceeded its deadline"),
            ),
        }),
        Effect.retry({
          times: 2,
          schedule: Schedule.exponential("50 millis"),
          while: (error) =>
            ["LOCKED", "OBSERVATION_CHANGED", "OBSERVATION_TIMEOUT"].includes(error.code),
        }),
        Effect.mapError((error) =>
          ["LOCKED", "OBSERVATION_CHANGED", "OBSERVATION_TIMEOUT"].includes(error.code)
            ? new CrewError(
                "OBSERVATION_UNAVAILABLE",
                `Coherent retained state is temporarily unavailable: ${error.message}`,
              )
            : error,
        ),
        domainEffect,
      );
  }
  observe = (query?: WorkDiscovery, includeRecords = false) =>
    this.capture((revision) =>
      domainEffect(
        Effect.gen({ self: this }, function* () {
          const day = localDay(yield* Clock.currentTimeMillis);
          const scans = yield* Effect.all(
            {
              issues: this.work.list,
              page: query ? this.work.find(query) : Effect.undefined,
              closures: this.work.closureTimes,
              completions: this.work.completions(day.day_start, day.day_end),
              projects: this.records.projectScan(),
              executions: this.records.executionScan(),
              setups: this.records.setupScan(),
              recordsRevision: this.records.observationRevision,
              exported: includeRecords ? this.records.export() : Effect.undefined,
            },
            { concurrency: "unbounded" },
          );
          return {
            issues: scans.issues,
            exported: scans.exported,
            page: scans.page,
            closures: scans.closures,
            completions: scans.completions,
            day,
            explanation: explainIssues(scans.issues),
            projects: scans.projects.values,
            executions: scans.executions.values,
            setups: scans.setups.values,
            recordsRevision: scans.recordsRevision,
            diagnostics: [
              ...scans.projects.diagnostics,
              ...scans.executions.diagnostics,
              ...scans.setups.diagnostics,
            ],
            source: {
              work_revision: revision,
              captured_at: yield* timestamp,
              executions: scans.executions.values.map((e) => ({
                issue_id: e.issue_id,
                execution_id: e.execution_id,
                revision: e.revision,
              })),
              projects: scans.projects.values.map((p) => ({
                repository_id: p.id,
                revision: p.revision,
              })),
              setups: scans.setups.values.map((e) => ({
                repository_id: e.repository_id,
                execution_id: e.execution_id,
                revision: e.revision,
              })),
            },
          };
        }),
      ),
    );
  workList = (includeRecords = false) =>
    Effect.gen({ self: this }, function* () {
      const bundle = yield* this.observe(undefined, includeRecords);
      return {
        supervision: yield* this.supervisionAggregate(bundle),
        issues: bundle.issues,
        executions: bundle.executions,
        record_diagnostics: bundle.diagnostics,
        records: bundle.exported,
        retained_source: bundle.source,
      };
    });
  /** Bounded identifiers and total only; no fleet readiness or native worker inspection. */
  bindingPopulation = () =>
    this.capture((work_revision) =>
      Effect.gen({ self: this }, function* () {
        const first = yield* this.work.find({ state: "all", offset: 0, limit: 50 });
        const second =
          first.total > 50
            ? yield* this.work.find({ state: "all", offset: 50, limit: 50 })
            : undefined;
        return {
          ids: [...first.entries, ...(second?.entries ?? [])].map((issue) => issue.id),
          total: first.total,
          work_revision,
        };
      }),
    );
  /** One issue and its retained execution; no finder, fleet, lead or admission reads. */
  observeTask = (id: IssueId, includeHistory = false) =>
    this.capture((revision) =>
      Effect.gen({ self: this }, function* () {
        const graph = yield* this.work.task(id);
        const history = includeHistory ? yield* this.work.history(id) : undefined;
        const result = yield* this.records.execution(id).pipe(Effect.result);
        const execution = result._tag === "Success" ? result.success : undefined;
        return {
          ...graph,
          history,
          execution,
          execution_unavailable:
            result._tag === "Failure" ? diagnosticText(result.failure.message) : undefined,
          source: {
            work_revision: revision,
            captured_at: yield* timestamp,
            execution_revision: execution?.revision,
          },
        };
      }),
    );
  /** Refresh off the finder path. The stamp makes a delayed scan safe to discard. */
  refreshFinderReadiness = (bundle?: ReadBundle) =>
    Effect.gen({ self: this }, function* () {
      const retained = bundle
        ? {
            revision: bundle.recordsRevision,
            capacity: summarizeCapacity([...bundle.executions, ...bundle.setups]),
            recordsUnavailable: bundle.diagnostics.length > 0,
          }
        : yield* this.capture(() =>
            Effect.all(
              {
                revision: this.records.observationRevision,
                projects: this.records.projectScan(),
                executions: this.records.executionScan(),
                setups: this.records.setupScan(),
              },
              { concurrency: 4 },
            ).pipe(
              Effect.map(({ revision, projects, executions, setups }) => ({
                revision,
                capacity: summarizeCapacity([...executions.values, ...setups.values]),
                recordsUnavailable: [projects, executions, setups].some(
                  ({ diagnostics }) => diagnostics.length > 0,
                ),
              })),
            ),
          );
      const authority = this.config.auto_schedule
        ? (yield* this.automaticAuthority()).blocker
        : undefined;
      const before = this.finderCapacity;
      this.finderCapacity = { ...retained, authority };
      return (
        !before ||
        before.revision !== retained.revision ||
        before.authority?.message !== authority?.message
      );
    });

  private declarations() {
    return loadConfig(this.config.home).pipe(
      Effect.match({
        onSuccess: (config) => ({
          digests: new Map(config.repositories.map((d) => [d.id, declarationDigest(d)])),
          error: undefined,
        }),
        onFailure: (error) => ({ digests: new Map<RepositoryId, string>(), error: error.message }),
      }),
    );
  }

  observeFinder = (query: WorkDiscovery) =>
    Effect.gen({ self: this }, function* () {
      const retained = yield* this.capture((workRevision) =>
        Effect.gen({ self: this }, function* () {
          const page = yield* this.work.find(query);
          const repositories = [...new Set(page.entries.map((issue) => issue.repository_id))];
          const observed = yield* Effect.all(
            {
              related: this.work.taskEvidence(page.entries),
              recordRevision: this.records.observationRevision,
              executions: Effect.forEach(
                page.entries,
                (issue) => this.records.execution(issue.id).pipe(Effect.result),
                { concurrency: 4 },
              ),
              projects: Effect.forEach(
                repositories,
                (id) =>
                  this.records.project(id).pipe(
                    Effect.result,
                    Effect.map((result) => [id, result] as const),
                  ),
                { concurrency: 4 },
              ),
              observedAt: timestamp,
            },
            { concurrency: 4 },
          );
          const summary = this.finderCapacity;
          return {
            ...observed,
            page,
            workRevision,
            summary: summary?.revision === observed.recordRevision ? summary : undefined,
          };
        }),
      );
      const declarations = retained.page.entries.some(({ status }) => status !== "closed")
        ? yield* this.declarations()
        : undefined;
      const projects = new Map(retained.projects);
      return {
        ...retained.page,
        entries: retained.page.entries.map((issue, index) => {
          const result = retained.executions[index]!;
          const execution = result._tag === "Success" ? result.success : undefined;
          const project = projects.get(issue.repository_id);
          const related = retained.related[index]!;
          const ready =
            declarations && issue.status !== "closed"
              ? retainedReadiness(
                  this.config,
                  issue,
                  related.dependencies.filter((d) => d.status !== "closed"),
                  project?._tag === "Success" ? project.success : undefined,
                  execution,
                  {
                    declarationDigest: declarations.digests.get(issue.repository_id),
                    declarationError: declarations.error,
                    capacity: retained.summary?.capacity,
                    authority: retained.summary?.authority,
                    recordsUnavailable:
                      Boolean(retained.summary?.recordsUnavailable) ||
                      result._tag === "Failure" ||
                      project?._tag === "Failure",
                  },
                )
              : undefined;
          return {
            issue,
            execution,
            executionUnavailable:
              result._tag === "Failure" ? diagnosticText(result.failure.message) : undefined,
            readiness: ready && { ...ready, eligibility_observed: Boolean(retained.summary) },
            closedAt:
              execution && execution.current_phase !== "completed" ? undefined : related.closed_at,
          };
        }),
        workRevision: retained.workRevision,
        recordsRevision: retained.recordRevision,
        observedAt: retained.observedAt,
      };
    });

  readinessFor = (ids: readonly IssueId[]) =>
    this.capture(() =>
      Effect.gen({ self: this }, function* () {
        const { explanation, projects, executions, setups } = yield* Effect.all(
          {
            explanation: this.work.explainSelected(ids),
            projects: this.records.projectScan(),
            executions: this.records.executionScan(),
            setups: this.records.setupScan(),
          },
          { concurrency: "unbounded" },
        );
        const rows = yield* this.evaluateReadiness({
          explanation,
          projects: projects.values,
          executions: executions.values,
          setups: setups.values,
          diagnostics: [...projects.diagnostics, ...executions.diagnostics, ...setups.diagnostics],
        });
        return new Map(rows.map((row) => [row.issue.id, row]));
      }),
    );

  ready = (bundle?: ReadBundle) =>
    (bundle ? Effect.succeed(bundle) : this.observe()).pipe(
      Effect.flatMap((data) => this.evaluateReadiness(data)),
      Effect.map((rows) =>
        rows.sort(
          (a, b) => a.issue.priority - b.issue.priority || a.issue.id.localeCompare(b.issue.id),
        ),
      ),
    );

  private evaluateReadiness({
    explanation,
    projects,
    executions,
    diagnostics,
    setups,
  }: Pick<ReadBundle, "explanation" | "projects" | "executions" | "diagnostics" | "setups">) {
    return domainEffect(
      Effect.gen({ self: this }, function* () {
        const declarations = yield* this.declarations();
        const authority = this.config.auto_schedule
          ? (yield* this.automaticAuthority()).blocker
          : undefined;
        const capacity = summarizeCapacity([...executions, ...setups]);
        const byID = new Map(executions.map((e) => [e.issue_id, e]));
        const projectsByID = new Map(projects.map((p) => [p.id, p]));
        const blocked = new Map(explanation.blocked.map((row) => [row.id, row.blocked_by]));
        return [...explanation.ready, ...explanation.blocked]
          .filter((issue) => issue.status !== "closed")
          .map((issue) => ({
            ...retainedReadiness(
              this.config,
              issue,
              blocked.get(issue.id) ?? [],
              projectsByID.get(issue.repository_id),
              byID.get(issue.id),
              {
                declarationDigest: declarations.digests.get(issue.repository_id),
                declarationError: declarations.error,
                authority,
                capacity,
                recordsUnavailable: diagnostics.length > 0,
              },
            ),
            dependencies: blocked.get(issue.id) ?? issue.dependencies,
          }));
      }),
    );
  }
}

export type ReadBundle = Effect.Success<ReturnType<Queries["observe"]>>;
