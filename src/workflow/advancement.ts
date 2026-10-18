import { Leads } from "./leads.ts";
import { decode } from "../decode.ts";
import { BatchInputSchema, type BatchInput } from "../work/batch.ts";
import { WorkerContexts } from "./worker-context.ts";
import { type Messages } from "./messages.ts";
import { MessageSendSchema, messageRequests, requiresResponse } from "./message-contracts.ts";
import { ExternalValidation } from "./external-validation.ts";
import { externalOwns } from "../validation/contracts.ts";
import { PRFeedback } from "./pr-feedback.ts";
import { measureReconcile } from "../observability.ts";
import {
  OperationAction,
  StorageKey,
  ToolName,
  FindingId,
  ExecutionId,
  BranchName,
  ChangeName,
  timestamp,
  IssueId,
  SessionId,
  RequestId,
} from "../identities.ts";

import { Finalization } from "./finalization.ts";
import { Finishing } from "./finishing.ts";
import { admitSynchronization, activeSynchronization } from "./synchronization.ts";
import { ExecutionTransitions } from "./transitions.ts";
import { synchronizeExecution, Records } from "../storage/store.ts";

import { initialRole, phaseRole } from "./roles.ts";
import { createExecution } from "./execution.ts";

import { fullPlanFingerprint } from "./planning.ts";
import { Corrections } from "./corrections.ts";
import { createHash, randomUUID } from "node:crypto";
import { Scopes } from "./scopes.ts";
import { Reports } from "./reports.ts";
import { type Scope } from "../work/scope.ts";
import { AttentionService } from "./attention.ts";
import { Obligations } from "./obligations.ts";
import { Clock, Effect } from "effect";
import { domainEffect } from "../effect.ts";

import {
  CrewError,
  identifier,
  terminal,
  type Config,
  type Execution,
  type Project,
} from "../domain.ts";

import { type Locks } from "../storage/lock.ts";
import { type WorkGraph } from "../work/graph.ts";
import { WorkIntake, type WorkInput } from "../work/intake.ts";
import { OpenSpec } from "../openspec/adapter.ts";
import { Git } from "../git/repository.ts";
import { type Delivery } from "../git/delivery.ts";
import { type Runtime } from "../opencode/runtime.ts";
import { RepositorySources } from "../git/source.ts";
import { Workspaces } from "../git/workspaces.ts";
import { collectApproval, assertApprovalActor } from "./authorization.ts";
import { Queries } from "./queries.ts";
import { CodingChecks } from "./checks.ts";
import { specVerificationPassed } from "./review-contracts.ts";
import { WorkerSessions, workerSessionID } from "./sessions.ts";
import { Capacity } from "./capacity.ts";
import { Operations } from "./operations.ts";
import { type Coordination } from "./coordination.ts";

export class Advancement {
  private finalization: Finalization;
  private finishing: Finishing;
  private transitions: ExecutionTransitions;
  private corrections: Corrections;
  readonly prFeedback: PRFeedback;
  readonly external: ExternalValidation;
  readonly reports: Reports;
  readonly leads: Leads;
  private scopes: Scopes;
  readonly attention: AttentionService;
  readonly obligations: Obligations;
  private coordination: Coordination;
  private operations: Operations;
  private capacity: Capacity;
  private sessions: WorkerSessions;
  private checks: CodingChecks;
  readonly queries: Queries;
  readonly workerContexts: WorkerContexts;
  readonly messages: Messages;
  private sources: RepositorySources;
  private workspaces: Workspaces;
  constructor(
    private config: Config,
    private records: Records,
    private work: WorkGraph,
    private spec: OpenSpec,
    private git: Git,
    private runtime: Runtime,
    private delivery: Delivery,
    locks: Locks,
    resources?: { sources: RepositorySources; workspaces: Workspaces },
  ) {
    this.workerContexts = new WorkerContexts(records, config);
    this.coordination = records.coordinate(locks);
    this.obligations = new Obligations(records, runtime, work, this.coordination);
    this.attention = new AttentionService(config, records, runtime, this.coordination, locks);
    this.operations = new Operations(records, locks, this.coordination);
    this.capacity = new Capacity(config, records, this.coordination);
    this.scopes = new Scopes(records);
    this.corrections = new Corrections(records, git, config);
    this.reports = new Reports(
      config.home,
      records,
      git,
      locks,
      work,
      runtime.notify.bind(runtime),
    );
    this.queries = new Queries(config, records, work, spec, git, runtime, (e) =>
      this.reports.read(e),
    );
    this.sessions = new WorkerSessions(
      config,
      records,
      runtime,
      this.capacity,
      this.coordination,
      this.queries,
      git,
    );
    this.messages = this.sessions.messages;
    this.leads = new Leads(
      config,
      records,
      work,
      runtime,
      locks,
      this.obligations,
      (a, s) => this.createWorkBatch(a, s),
      (a, s) => this.workMessage(a, s),
    );
    this.checks = new CodingChecks(
      records,
      git,
      spec,
      this.sessions,
      this.coordination,
      this.queries,
    );
    this.sources = resources?.sources ?? new RepositorySources(git, config.repository_root);
    this.workspaces =
      resources?.workspaces ?? new Workspaces(git, this.sources, runtime, config.worktree_root);
    this.transitions = new ExecutionTransitions(
      records,
      work,
      runtime,
      this.coordination,
      this.queries,
      this.operations,
      this.sessions,
    );
    this.external = new ExternalValidation(records, git, runtime, {
      capacity: this.capacity,
      work,
      operations: this.operations,
      queries: this.queries,
      sessions: this.sessions,
    });
    this.prFeedback = new PRFeedback({
      records,
      work,
      spec,
      delivery,
      runtime,
      operations: this.operations,
      sessions: this.sessions,
      queries: this.queries,
      corrections: this.corrections,
      transitions: this.transitions,
    });
    this.finishing = new Finishing({
      git,
      records,
      delivery,
      workspaces: this.workspaces,
      sessions: this.sessions,
      obligations: this.obligations,
      synchronize: (e, p, observation) =>
        Effect.gen({ self: this }, function* () {
          const next = yield* admitSynchronization(git, records, e, observation);
          if (next === "planning") {
            yield* this.spec.create(e);
            yield* this.launch(e, "explore");
          } else yield* this.verify(e, p);
          return e;
        }),
    });
    this.finalization = new Finalization({
      finishing: this.finishing,
      feedback: this.prFeedback,
      git,
      spec,
      records,
      delivery,
      work,
      reports: this.reports,
      workspaces: this.workspaces,
      coordination: this.coordination,
      obligations: this.obligations,
      sessions: this.sessions,
      transitions: this.transitions,
    });
  }
  locked<T>(action: () => Effect.Effect<T, CrewError>) {
    return this.coordination.with(action);
  }
  close = () => this.operations.close();
  recordSupervisor = (sessionID: SessionId) =>
    this.records.store.set(StorageKey.make("supervisor/session"), sessionID);
  recordWorkerTools = (
    sessionID: SessionId,
    model: import("../domain.ts").WorkerModel,
    names: ToolName[],
  ) =>
    timestamp.pipe(
      Effect.flatMap((at) =>
        this.records.store.set(StorageKey.make(`worker-tools/${sessionID}`), { model, names, at }),
      ),
    );
  private prepareIntake = Effect.fn("Advancement.prepareIntake")(
    function* (this: Advancement, input: WorkInput) {
      if (input.report_reference) {
        const reference = input.report_reference;
        const research = yield* this.get(reference.issue_id);
        if (
          !(
            research.workflow_policy === "research-only" &&
            research.current_phase === "completed" &&
            research.report_receipt?.report_id === reference.report_id &&
            research.report_receipt.hash === reference.hash
          )
        )
          return yield* new CrewError(
            "REPORT_REFERENCE",
            "Follow-on work requires the exact completed research report",
          );
        if (!((input.workflow_policy ?? this.config.default_workflow) !== "research-only"))
          return yield* new CrewError(
            "REPORT_FOLLOW_ON",
            "Choose an implementation policy for a research follow-on",
          );
        yield* this.reports.verify(research);
        input = {
          ...input,
          dependencies: [...new Set([...(input.dependencies ?? []), research.issue_id])],
        };
      }
      return input;
    }.bind(this),
    domainEffect,
  );
  createWork = Effect.fn("Advancement.createWork")(
    function* (this: Advancement, input: WorkInput, supervisor: SessionId) {
      input = yield* this.prepareIntake(input);
      return yield* this.locked(() =>
        domainEffect(
          Effect.gen({ self: this }, function* () {
            const issue = yield* new WorkIntake(
              this.work,
              this.records,
              this.config.default_workflow,
              this.config,
            ).create(input, supervisor);
            const readiness = (yield* this.ready()).find((row) => row.issue.id === issue.id);
            return { issue, readiness };
          }),
        ),
      );
    }.bind(this),
    domainEffect,
  );
  createWorkBatch = Effect.fn("Advancement.createWorkBatch")(
    function* (this: Advancement, input: BatchInput, supervisor: SessionId) {
      input = yield* decode(BatchInputSchema, input, "Work batch");
      const tasks: Array<BatchInput["tasks"][number]> = [];
      for (const task of input.tasks) {
        const { client_key, dependencies, ...fields } = task;
        const prepared = yield* this.prepareIntake({
          ...fields,
          dependencies: (dependencies ?? []).flatMap((d) =>
            d.type === "existing" ? [d.issue_id] : [],
          ),
        });
        const { request_id: _id, dependencies: existing, ...definition } = prepared;
        tasks.push({
          ...definition,
          client_key,
          dependencies: [
            ...(dependencies ?? []).filter((d) => d.type === "local"),
            ...(existing ?? []).map((issue_id) => ({ type: "existing" as const, issue_id })),
          ],
        });
      }
      return yield* this.locked(() =>
        domainEffect(
          Effect.gen({ self: this }, function* () {
            const result = yield* new WorkIntake(
              this.work,
              this.records,
              this.config.default_workflow,
              this.config,
            ).createBatch({ ...input, tasks }, supervisor);
            const readiness = yield* this.ready();
            return {
              ...result,
              tasks: result.tasks.map((task) => ({
                ...task,
                readiness: readiness.find((row) => row.issue.id === task.issue.id),
              })),
            };
          }),
        ),
      );
    }.bind(this),
    domainEffect,
  );
  get = (...args: Parameters<Queries["get"]>) => this.queries.get(...args);
  diagnostics = (...args: Parameters<Queries["diagnostics"]>) => this.queries.diagnostics(...args);
  recordWorkerFailure = (...args: Parameters<WorkerSessions["recordFailure"]>) =>
    this.sessions.recordFailure(...args);
  private project = (e: Execution) => this.queries.effectiveProject(e);
  ready = (...args: Parameters<Queries["ready"]>) => this.queries.ready(...args);
  start = Effect.fn("Advancement.start")(
    function* (this: Advancement, id: IssueId, supervisor?: SessionId) {
      identifier(id);
      return yield* this.operations.owned(id, OperationAction.make("start"), () =>
        domainEffect(
          Effect.gen({ self: this }, function* () {
            const existing = yield* this.records.execution(id);
            if (existing) return yield* this.reconcileOne(existing);
            const e = yield* this.coordination.with(() =>
              domainEffect(
                Effect.gen({ self: this }, function* () {
                  const candidate = (yield* this.ready()).find((x) => x.issue.id === id);
                  if (!candidate?.eligible)
                    return yield* new CrewError(
                      "NOT_READY",
                      JSON.stringify(candidate?.blockers ?? ["Issue not found/open"]),
                    );
                  const project = yield* this.records.project(candidate.repository_id!);
                  if (!project)
                    return yield* new CrewError(
                      "PROJECT_MISSING",
                      "Repository is no longer registered",
                    );
                  const e = yield* createExecution(
                    project,
                    {
                      issue_id: id,
                      repository_id: project.id,
                      execution_id: ExecutionId.make(`abra-${randomUUID()}`),
                      intent: {
                        title: candidate.issue.title,
                        description: candidate.issue.description,
                      },
                      quality_profile: candidate.issue.quality_profile,
                      dispatch: candidate.issue.dispatch,
                      workflow_policy: candidate.issue.workflow_policy,
                      current_phase: "claiming",
                      branch: BranchName.make(`work/${id}`),
                      openspec_change: ChangeName.make(
                        `abra-${id.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`,
                      ),
                      supervisor_session_id: supervisor,
                    },
                    this.config,
                  );
                  if (
                    !(yield* this.capacity.reserve(
                      e,
                      initialRole(e.workflow_policy),
                      project,
                      true,
                    ))
                  )
                    return yield* new CrewError(
                      "NOT_READY",
                      "Native worker capacity changed before admission",
                    );
                  return yield* this.records.save(e);
                }),
              ),
            );
            yield* this.operations.intent(e, OperationAction.make("start"));
            return yield* domainEffect(
              Effect.gen({ self: this }, function* () {
                yield* this.coordination.with(() =>
                  this.records.save(e).pipe(Effect.andThen(this.work.claim(id, e.execution_id))),
                );
                yield* this.transitions.move(e, "provisioning");
                return yield* this.provision(e);
              }),
            ).pipe(
              Effect.tapError((error) => this.transitions.fail(e, error, "recovery_required")),
            );
          }),
        ),
      );
    }.bind(this),
    domainEffect,
  );
  private provision = Effect.fn("Advancement.provision")(
    function* (this: Advancement, e: Execution) {
      const p = yield* this.project(e);
      yield* this.git.validate(p);
      if (!p.project_id) {
        p.project_id = yield* this.runtime.project(p.path);
        yield* this.records.saveProject(p);
      }
      yield* this.workspaces.provision(p, e, () => this.records.save(e));
      if (e.workflow_policy !== "full-openspec") {
        e.capacity_observed_idle = true;
        delete e.capacity_reservation;
        yield* this.transitions.move(e, "planning");
        return yield* this.checkpoint(e);
      }
      if (!e.openspec_update_commit) {
        // Refresh before admitting any writer. Retain its commit separately from the fetched base
        // so Explore's change-only guard excludes controller-generated instruction updates.
        if (yield* this.git.dirty(e.worktree_directory!))
          return yield* new CrewError(
            "OPENSPEC_UPDATE_DIRTY",
            "OpenSpec update requires a clean owned worktree; inspect and preserve unfinished provisioning changes before retrying",
          );
        yield* this.spec.update(e);
        e.openspec_update_commit = yield* this.git.commit(
          e.worktree_directory!,
          e.issue_id,
          `Refresh OpenSpec instructions for ${e.issue_id}`,
        );
        yield* this.records.save(e);
      }
      yield* this.spec.create(e);
      yield* this.transitions.move(e, "exploring");
      yield* this.launch(e, "explore");
      return e;
    }.bind(this),
    domainEffect,
  );
  private sessionID = workerSessionID;
  private idle = (...args: Parameters<WorkerSessions["idle"]>) => this.sessions.idle(...args);
  private launch = (...args: Parameters<WorkerSessions["launch"]>) => this.sessions.launch(...args);
  reviseScope = (id: IssueId, input: Scope) =>
    this.operations.owned(id, OperationAction.make("scope-revision"), () =>
      domainEffect(
        Effect.gen({ self: this }, function* () {
          const e = yield* this.get(id);
          yield* this.idle(e);
          yield* this.scopes.validateRevision(e, input);
          const issue = yield* this.work.show(id);
          if (issue.status === "blocked") yield* this.work.resume(id, e.execution_id);
          return yield* this.scopes.revise(e, input, (e) => this.records.saveControl(e));
        }),
      ),
    );
  private correctFailure = Effect.fn("Advancement.correctFailure")(
    function* (this: Advancement, e: Execution, error: CrewError) {
      if (
        !["VERIFICATION_FAILED", "REVIEW_FAILED"].includes(error.code) ||
        e.stop_status ||
        e.workflow_policy === "research-only"
      )
        return;
      const source = error.code === "REVIEW_FAILED" ? "review" : "check";
      const text =
        source === "review"
          ? [
              e.review_receipt?.findings ?? error.message,
              ...(e.review_receipt?.spec_verification?.conflicts.map(
                (c) => `Conflict (${c.sources.join("; ")}): ${c.summary}`,
              ) ?? []),
            ].join("\n")
          : error.message;
      const fp = yield* this.git.fingerprint(e.worktree_directory!);
      if (source === "review" && e.review_receipt?.fingerprint !== fp) return;
      yield* this.checks.assertPlan(e, yield* this.project(e));
      const key = FindingId.make(
        `${source}-${createHash("sha256").update(fp).update(text).digest("hex")}`,
      );
      const role = yield* this.corrections.prepare(
        e,
        source,
        [key],
        text,
        source === "check" ? "in_scope" : (e.review_receipt?.scope_status ?? "uncertain"),
      );
      if (role) {
        yield* this.launch(e, role);
        return e;
      }
    }.bind(this),
    domainEffect,
  );
  advance = Effect.fn("Advancement.advance")(
    function* (this: Advancement, id: IssueId) {
      return yield* this.operations.owned(id, OperationAction.make("advance"), () =>
        domainEffect(
          Effect.gen({ self: this }, function* () {
            const e = yield* this.get(id);
            return yield* this.checkpoint(e).pipe(
              Effect.catch((error) =>
                Effect.gen({ self: this }, function* () {
                  const corrected = yield* this.correctFailure(e, error);
                  if (corrected) return corrected;
                  if (!["APPROVAL_REQUIRED", "MERGE_APPROVAL"].includes(error.code))
                    yield* this.transitions.fail(e, error);
                  return yield* error;
                }),
              ),
            );
          }),
        ),
      );
    }.bind(this),
    domainEffect,
  );
  private checkpoint: (e: Execution) => Effect.Effect<Execution, CrewError> = Effect.fn(
    "Advancement.checkpoint",
  )(
    function* (this: Advancement, e: Execution) {
      const p = yield* this.project(e);
      yield* this.git.validate(p, e);
      if (yield* this.obligations.recheck(e)) return e;
      if (
        messageRequests(e.messages).some(
          (m) =>
            m.generation === e.control_generation &&
            m.assignment_id === e.prompt_id &&
            requiresResponse(m),
        )
      )
        return e;
      yield* this.idle(e);
      yield* this.corrections.assertArchives(e);
      const completedRole = yield* this.sessions.requireCompleted(e);
      switch (e.current_phase) {
        case "exploring":
        case "planning": {
          yield* this.transitions.move(e, "planning");
          if (e.workflow_policy !== "full-openspec") {
            if (!(yield* this.scopes.initialize(e, yield* this.work.show(e.issue_id)))) return e;
            yield* this.transitions.move(e, "awaiting_plan_approval");
            if (e.plan_approval_required === false) return yield* this.beginApply(e, p);
            return e;
          }
          yield* this.spec.plan(e);
          // Ensure Explore left only planning files, including no source commits.
          const changed = yield* this.git.run(e.worktree_directory!, [
            "diff",
            "--name-only",
            activeSynchronization(e)?.planning_base_tree ??
              e.planning_base_commit ??
              e.openspec_update_commit ??
              e.base_commit!,
          ]);
          const untracked = yield* this.git.run(e.worktree_directory!, [
            "ls-files",
            "--others",
            "--exclude-standard",
          ]);
          if (
            ![changed, untracked]
              .join("\n")
              .split("\n")
              .filter(Boolean)
              .every((n) => n.startsWith(`openspec/changes/${e.openspec_change}/`))
          )
            return yield* new CrewError(
              "EXPLORE_SOURCE_EDIT",
              "Explore modified files outside assigned OpenSpec change",
            );
          yield* this.git.run(e.worktree_directory!, [
            "add",
            "--",
            `openspec/changes/${e.openspec_change}`,
          ]);
          e.plan_fingerprint = yield* fullPlanFingerprint(this.git, e);
          yield* this.transitions.move(e, "awaiting_plan_approval");
          if (e.plan_approval_required === false) return yield* this.beginApply(e, p);
          yield* this.transitions.notice(
            e,
            "Planning validated. Request approval with abra_work_approve.",
          );
          return e;
        }
        case "awaiting_plan_approval":
          return yield* this.beginApply(e, p);
        case "researching": {
          yield* this.reports.verify(e);
          yield* this.transitions.move(e, "cleaning");
          return yield* this.finalization.cleanup(e, p);
        }
        case "applying": {
          if (e.workflow_policy === "full-openspec") yield* this.spec.implemented(e);
          yield* this.assertPlan(e, p);
          if (e.effective_policy.validation?.engine === "no-mistakes") {
            yield* this.transitions.move(e, "validating_external");
            return yield* this.checkpoint(e);
          }
          yield* this.transitions.move(e, "verifying");
          return yield* this.checkpoint(e);
        }
        case "validating_external": {
          const external = yield* this.external.advance(e, p);
          return external.current_phase === "verifying"
            ? yield* this.checkpoint(external)
            : external;
        }
        case "verifying": {
          if (
            p.delivery === "github-pr" &&
            e.effective_policy.publication &&
            e.effective_policy.publication !== "ready" &&
            !e.provisional
          ) {
            if (!this.delivery.provisional)
              return yield* new CrewError(
                "DRAFT_UNSUPPORTED",
                "Delivery adapter does not support provisional publication",
              );
            const draft = yield* this.delivery.provisional(p, e);
            if (!draft.pr)
              return yield* new CrewError(
                "DRAFT_PR",
                "Draft publication did not produce an owned PR",
              );
            e.provisional = {
              head: draft.commit,
              pr: draft.pr,
              at: yield* Clock.currentTimeMillis,
            };
            e.pull_request_reference = draft.pr;
            yield* this.records.save(e);
          }
          if (completedRole === "review") {
            if (!e.review_receipt)
              return yield* new CrewError(
                "REVIEW_MISSING",
                "Independent Review completed without a matching report",
              );
          }
          if (!e.review_receipt) return yield* this.verify(e, p);
          const fp = yield* this.git.fingerprint(e.worktree_directory!);
          if (!(e.review_receipt.passed && e.review_receipt.fingerprint === fp))
            return yield* new CrewError(
              "REVIEW_FAILED",
              "Review failed or reviewed content changed",
            );
          if (
            e.workflow_policy === "full-openspec" &&
            !specVerificationPassed(e.review_receipt.spec_verification)
          )
            return yield* new CrewError(
              "SPEC_VERIFICATION_REQUIRED",
              "Full-spec Review evidence is missing or incomplete; retry independent Review",
            );
          if (!(e.verification_receipt?.fingerprint === fp))
            return yield* new CrewError(
              "VERIFICATION_STALE",
              "Repository checks do not cover current content",
            );
          if (e.workflow_policy === "full-openspec") yield* this.spec.implemented(e);
          yield* this.assertPlan(e, p);
          yield* this.transitions.move(e, "archiving");
          return yield* this.finalization.archive(e, p);
        }
        case "archiving":
          return yield* this.finalization.archive(e, p);
        case "delivering":
          return yield* this.finalization.deliver(e, p);
        case "awaiting_merge":
          return yield* this.finalization.finish(e, p);
        case "cleaning":
          return yield* this.finalization.cleanup(e, p);
        case "completed":
          return e;
        default:
          return yield* new CrewError(
            "PHASE",
            `Cannot advance ${e.current_phase}; use retry/resume/reconcile`,
          );
      }
    }.bind(this),
    domainEffect,
  );
  private assertPlan = (...args: Parameters<CodingChecks["assertPlan"]>) =>
    this.checks.assertPlan(...args);
  private beginApply = Effect.fn("Advancement.beginApply")(
    function* (this: Advancement, e: Execution, p: Project) {
      if (e.workflow_policy === "full-openspec") yield* this.spec.plan(e);
      yield* this.assertPlan(e, p);
      if (activeSynchronization(e)) {
        yield* this.transitions.move(e, "verifying");
        return yield* this.verify(e, p);
      }
      const research = e.workflow_policy === "research-only";
      yield* this.transitions.move(e, research ? "researching" : "applying");
      yield* this.launch(e, research ? "research" : "apply");
      return e;
    }.bind(this),
    domainEffect,
  );
  private verify = (...args: Parameters<CodingChecks["verify"]>) => this.checks.verify(...args);
  reviewReport = (...args: Parameters<CodingChecks["reviewReport"]>) =>
    this.checks.reviewReport(...args);
  approve = Effect.fn("Advancement.approve")(
    function* (this: Advancement, id: IssueId, kind: "plan" | "merge", supervisor: SessionId) {
      return yield* this.operations.owned(id, OperationAction.make("approve"), () =>
        domainEffect(
          Effect.gen({ self: this }, function* () {
            const e = yield* this.get(id);
            const p = yield* this.project(e);
            yield* assertApprovalActor(e, supervisor);
            if (
              kind === "merge" &&
              ["cleaning", "completed"].includes(e.current_phase) &&
              e.approval_receipts.some(
                (a) =>
                  a.kind === "merge" &&
                  a.fingerprint === e.delivered_commit &&
                  a.authorized_at &&
                  !a.rejected_at,
              )
            ) {
              // The receipt is already committed; do not touch a retired worktree or create a form.
              return e;
            }
            yield* this.idle(e);
            if (
              !(e.current_phase === (kind === "plan" ? "awaiting_plan_approval" : "awaiting_merge"))
            )
              return yield* new CrewError(
                "APPROVAL_PHASE",
                "Approval does not match current phase",
              );
            if (kind === "merge" && !(yield* this.finishing.prepare(e, p))) return e;
            const fp =
              kind === "plan"
                ? e.workflow_policy === "full-openspec"
                  ? yield* fullPlanFingerprint(this.git, e)
                  : this.scopes.assert(e)
                : e.delivered_commit!;
            if (!(fp && (kind !== "plan" || fp === e.plan_fingerprint)))
              return yield* new CrewError("STALE_CHECKPOINT", "Checkpoint changed");
            const { decision, receipt } = yield* collectApproval(
              this.runtime,
              e,
              kind,
              supervisor,
              fp,
              () => this.records.save(e),
            );
            if (decision === "pending")
              return { execution: e, approval_required: true, form_id: receipt.form_id };
            if (decision === "rejected") {
              if (kind === "plan") yield* this.transitions.move(e, "planning");
              yield* this.transitions.fail(
                e,
                new CrewError(
                  "APPROVAL_REJECTED",
                  "Human rejected this checkpoint; revise before requesting approval",
                ),
              );
              return yield* new CrewError("APPROVAL_REJECTED", "Human rejected this checkpoint");
            }
            return yield* kind === "plan" ? this.beginApply(e, p) : Effect.succeed(e);
          }),
        ),
      );
    }.bind(this),
    domainEffect,
  );
  finish = Effect.fn("Advancement.finish")(
    function* (this: Advancement, id: IssueId) {
      return yield* this.operations.owned(id, OperationAction.make("finish"), () =>
        domainEffect(
          Effect.gen({ self: this }, function* () {
            const e = yield* this.get(id);
            const p = yield* this.project(e);
            return yield* (
              e.workflow_policy === "research-only" && e.current_phase === "researching"
                ? this.checkpoint(e)
                : this.finalization.finish(e, p)
            ).pipe(
              Effect.tapError((error) =>
                Effect.gen({ self: this }, function* () {
                  e.error_or_recovery_reason = error.message;
                  yield* this.records.save(e);
                }),
              ),
            );
          }),
        ),
      );
    }.bind(this),
    domainEffect,
  );
  workMessage = Effect.fn("Advancement.workMessage")(
    function* (this: Advancement, input: typeof MessageSendSchema.Type, sender: SessionId) {
      return yield* this.operations.owned(input.issue_id, OperationAction.make("message"), () =>
        Effect.gen({ self: this }, function* () {
          const e = yield* this.get(input.issue_id);
          const saved = yield* this.messages.request(e, sender, input);
          return messageRequests(saved.messages).find((m) => m.request_id === input.request_id)!;
        }),
      );
    }.bind(this),
    domainEffect,
  );
  control = Effect.fn("Advancement.control")(
    function* (
      this: Advancement,
      id: IssueId,
      action: "pause" | "interrupt" | "resume" | "retry" | "steer" | "advance" | "replan",
      text?: string,
      request?: { id: RequestId; sender: SessionId },
    ) {
      if (action === "advance") return yield* this.advance(id);
      if (action === "pause" || action === "interrupt") return yield* this.transitions.pause(id);
      return yield* this.operations.owned(id, OperationAction.make("control"), () =>
        domainEffect(
          Effect.gen({ self: this }, function* () {
            const e = yield* this.get(id);
            if (action === "steer") {
              if (!(text && this.sessionID(e)))
                return yield* new CrewError(
                  "STEER",
                  "An active session and steering text are required",
                );
              if (!request)
                return yield* new CrewError(
                  "MESSAGE_ID",
                  "Steering requires a stable request identity and trusted sender",
                );
              return yield* this.sessions.messages.send(e, request.sender, request.id, text);
            }
            if (action === "replan" && externalOwns(e))
              return yield* new CrewError(
                "EXTERNAL_CUSTODY",
                "Abort and return external custody before invalidating the plan",
              );
            if (action === "replan") {
              if (!(!e.stop_status && e.current_phase !== "interrupted"))
                return yield* new CrewError(
                  "CONTROL_PAUSED",
                  "Resume paused work explicitly before replanning",
                );
            }
            if (action === "replan" && e.workflow_policy !== "full-openspec") {
              return yield* new CrewError(
                "SCOPE_REVISION",
                "Use abra_work_scope with the complete revised contract",
              );
            }
            if (action === "replan") {
              if (
                ["archiving", "delivering", "awaiting_merge", "cleaning", "completed"].includes(
                  e.current_phase,
                )
              )
                return yield* new CrewError(
                  "REPLAN_PHASE",
                  "Replan must precede archival/delivery",
                );
              yield* this.idle(e);
              const issue = yield* this.work.show(e.issue_id);
              if (issue.status === "blocked") yield* this.work.resume(e.issue_id, e.execution_id);
              delete e.active_role;
              delete e.plan_fingerprint;
              delete e.verification_receipt;
              delete e.review_receipt;
              e.retry_instructions = text;
              yield* this.transitions.move(e, "planning");
              yield* this.launch(e, "explore");
              return e;
            }
            if (
              !["blocked", "failed", "interrupted", "recovery_required"].includes(e.current_phase)
            )
              return yield* new CrewError("CONTROL_PHASE", "Execution does not need retry/resume");
            if (!(e.stop_status !== "requested"))
              return yield* new CrewError(
                "STOP_PENDING",
                "Wait for owned operation and native worker termination before replacing a writer",
              );
            delete e.stop_status;
            let phase = e.resume_phase;
            if (
              action === "retry" &&
              phase === "verifying" &&
              e.workflow_policy === "full-openspec" &&
              e.review_receipt?.passed &&
              !specVerificationPassed(e.review_receipt.spec_verification)
            ) {
              delete e.review_receipt;
              delete e.verification_receipt;
              e.retry_instructions =
                text ?? "Complete specification verification for the approved change";
            } else if (
              action === "retry" &&
              phase === "verifying" &&
              (e.review_receipt?.passed === false || text)
            ) {
              if (
                e.review_receipt?.passed === false &&
                e.review_receipt.scope_status !== "in_scope" &&
                e.decisions?.some(
                  (d) => d.generation === e.control_generation && d.status === "open",
                )
              )
                return yield* new CrewError(
                  "REVIEW_SCOPE_DECISION",
                  "Resolve the Review scope conflict before retrying; use replan for changed requirements or revise the short scope",
                );
              e.retry_instructions = text ?? e.review_receipt?.findings;
              delete e.review_receipt;
              delete e.verification_receipt;
              phase = "applying";
            }
            if (!phase)
              return yield* new CrewError("RECOVERY_REQUIRED", "No verifiable resume checkpoint");
            yield* this.idle(e);
            const issue = yield* this.work.show(e.issue_id);
            if (
              !(
                issue.assignee === e.execution_id ||
                (phase === "claiming" && issue.status === "open" && !issue.assignee)
              )
            )
              return yield* new CrewError(
                "CLAIM_LOST",
                "Cannot resume work owned by another execution",
              );
            if (issue.status === "blocked") yield* this.work.resume(e.issue_id, e.execution_id);
            yield* this.transitions.move(e, phase);
            if (
              e.capacity_wait ||
              ["claiming", "provisioning", "awaiting_plan_approval", "awaiting_merge"].includes(
                phase,
              )
            )
              return yield* this.reconcileOne(e);
            if (["exploring", "planning", "applying", "researching"].includes(phase)) {
              yield* this.launch(
                e,
                phase === "researching" ? "research" : phase === "applying" ? "apply" : "explore",
              );
              return e;
            }
            return yield* this.checkpoint(e);
          }),
        ),
      );
    }.bind(this),
    domainEffect,
  );
  reconcile: (id?: IssueId) => Effect.Effect<Execution[], CrewError> = Effect.fn(
    "Advancement.reconcile",
  )(
    function* (this: Advancement, id?: IssueId) {
      const records = id
        ? [yield* this.get(id)]
        : (yield* this.records.executions()).filter(
            (e) => !terminal(e) || e.finishing?.completion_notice?.status === "pending",
          );
      return yield* Effect.forEach(
        records,
        (record) =>
          this.operations
            .owned(record.issue_id, OperationAction.make("reconcile"), () =>
              domainEffect(
                Effect.gen({ self: this }, function* () {
                  const e = yield* this.get(record.issue_id);
                  return yield* this.reconcileOne(e).pipe(
                    Effect.catch((error) =>
                      domainEffect(
                        Effect.gen({ self: this }, function* () {
                          if (e.stop_status === "requested")
                            return yield* this.records.save({
                              ...e,
                              error_or_recovery_reason: error.message,
                            });
                          const corrected = yield* this.correctFailure(e, error);
                          if (corrected) return corrected;
                          if (
                            error.code === "FORGE_OBSERVATION_FAILED" &&
                            e.current_phase === "awaiting_merge"
                          )
                            return yield* this.finalization.wait(e, {
                              category: "retryable",
                              code: error.code,
                              reason: error.message,
                              owner: "forge",
                            });
                          return yield* this.transitions.fail(
                            e,
                            error,
                            ["VERIFICATION_FAILED", "REVIEW_FAILED"].includes(error.code)
                              ? "blocked"
                              : "recovery_required",
                          );
                        }),
                      ),
                    ),
                  );
                }),
              ),
            )
            .pipe(
              Effect.catchIf(
                (error) => ["LOCKED", "STOP_REQUESTED", "STALE_OPERATION"].includes(error.code),
                () => this.get(record.issue_id),
              ),
            ),
        { concurrency: Math.max(2, this.config.max_workers) },
      );
    }.bind(this),
    domainEffect,
    measureReconcile,
  );
  private reconcileOne: (e: Execution) => Effect.Effect<Execution, CrewError> = Effect.fn(
    "Advancement.reconcileOne",
  )(
    function* (this: Advancement, e: Execution) {
      if (terminal(e))
        return e.finishing?.completion_notice?.status === "pending"
          ? yield* this.finalization.notifyCompletion(e)
          : e;
      synchronizeExecution(e, yield* this.obligations.collectPending(e));
      if (e.stop_status === "requested") return yield* this.transitions.confirmStop(e);
      if (e.current_phase === "recovery_required") {
        const p = yield* this.project(e);
        const issue = yield* this.work.show(e.issue_id);
        const recovered =
          (issue.status === "in_progress" && issue.assignee === e.execution_id
            ? yield* this.finishing.recoverAdmission(e, p)
            : undefined) ??
          (yield* this.finalization.recoverPublication(e, p)) ??
          (yield* this.finalization.recoverFinalization(e, p));
        if (recovered) return recovered;
      }
      const assessment = yield* this.prFeedback.poll(e);
      if (["blocked", "interrupted", "failed", "recovery_required"].includes(e.current_phase))
        return e;
      if (e.current_phase === "awaiting_merge" && e.delivery_wait) {
        if (!(e.delivery_wait.fingerprint === e.delivered_commit))
          return yield* new CrewError("DELIVERY_CHANGED", "Waiting delivery head changed");
        if ((yield* Clock.currentTimeMillis) < e.delivery_wait.next_check_at) return e;
      }
      let issue = yield* this.work.show(e.issue_id);
      if (e.current_phase === "claiming") {
        if (issue.status === "open" && !issue.assignee) {
          if (!(yield* this.work.ready).some((i) => i.id === e.issue_id))
            return yield* new CrewError(
              "NOT_READY",
              "Issue dependencies changed before claim recovery",
            );
          yield* this.work.claim(e.issue_id, e.execution_id);
        } else {
          if (!(issue.assignee === e.execution_id && issue.status === "in_progress"))
            return yield* new CrewError(
              "CLAIM_AMBIGUOUS",
              "Claim belongs elsewhere or issue is not in progress",
            );
        }
        issue = yield* this.work.show(e.issue_id);
        yield* this.transitions.move(e, "provisioning");
      }
      if (e.current_phase !== "cleaning") {
        if (
          !(
            (issue.status === "in_progress" ||
              (["blocked", "failed", "recovery_required"].includes(e.current_phase) &&
                issue.status === "blocked")) &&
            issue.assignee === e.execution_id
          )
        )
          return yield* new CrewError("WORK_DRIFT", "Issue status/claim differs from execution");
      }
      if (e.current_phase === "provisioning") return yield* this.provision(e);
      if (!(issue.repository_id === e.repository_id))
        return yield* new CrewError("WORK_DRIFT", "Issue repository association changed");
      if (!(issue.workflow_policy === e.workflow_policy))
        return yield* new CrewError("POLICY_DRIFT", "Issue workflow policy changed");
      const p = yield* this.project(e);
      if (e.current_phase === "cleaning") {
        if (
          e.cleanup_blocker?.generation === e.control_generation &&
          !e.error_or_recovery_reason &&
          (yield* Clock.currentTimeMillis) < e.cleanup_blocker.next_check_at
        )
          return e;
        return yield* this.finalization.cleanup(e, p);
      }
      yield* this.git.validate(p, e);
      yield* this.sessions.validateLocations(e);
      if (["blocked", "interrupted", "failed", "recovery_required"].includes(e.current_phase))
        return e;
      if (e.current_phase === "validating_external") return yield* this.checkpoint(e);
      if (e.current_phase === "awaiting_merge" && !(yield* this.finishing.prepare(e, p))) return e;
      if (yield* this.obligations.recheck(e)) return e;
      if (e.current_phase === "awaiting_plan_approval" || e.current_phase === "awaiting_merge") {
        if (
          e.current_phase === "awaiting_merge" &&
          p.delivery === "github-pr" &&
          e.merge_approval_required &&
          e.supervisor_session_id &&
          !e.approval_receipts.some(
            (a) => a.kind === "merge" && a.fingerprint === e.delivered_commit && !a.rejected_at,
          ) &&
          (yield* this.delivery.inspect(p, e))?.state === "OPEN"
        )
          yield* collectApproval(
            this.runtime,
            e,
            "merge",
            e.supervisor_session_id,
            e.delivered_commit!,
            () => this.records.save(e),
          );
        for (const a of e.approval_receipts.filter(
          (a) =>
            !a.authorized_at &&
            !a.rejected_at &&
            (e.current_phase === "awaiting_merge"
              ? a.kind === "merge" && a.fingerprint === e.delivered_commit
              : a.kind === "plan" && a.fingerprint === e.plan_fingerprint),
        )) {
          const { decision } = yield* collectApproval(
            this.runtime,
            e,
            a.kind,
            a.session_id,
            a.fingerprint,
            () => this.records.save(e),
          );
          if (decision === "rejected") {
            a.rejected_at = yield* timestamp;
            if (a.kind === "plan") yield* this.transitions.move(e, "planning");
            return yield* this.transitions.fail(
              e,
              new CrewError("APPROVAL_REJECTED", "Human rejected this checkpoint"),
            );
          }
        }
        if (
          e.current_phase === "awaiting_plan_approval" &&
          (e.plan_approval_required === false ||
            e.approval_receipts.some(
              (a) => a.kind === "plan" && a.fingerprint === e.plan_fingerprint && a.authorized_at,
            ))
        )
          return yield* this.beginApply(e, p);
        if (e.current_phase === "awaiting_merge") {
          const pr = p.delivery === "github-pr" ? yield* this.delivery.inspect(p, e) : undefined;
          if (
            p.delivery === "branch" ||
            pr?.state === "MERGED" ||
            e.merge_approval_required === false ||
            e.approval_receipts.some(
              (a) => a.kind === "merge" && a.fingerprint === e.delivered_commit && a.authorized_at,
            )
          )
            return yield* this.finalization.finish(e, p, assessment);
        }
        return e;
      }
      if (e.capacity_wait && !e.capacity_wait.request_id) {
        if ((yield* Clock.currentTimeMillis) < e.capacity_wait.next_check_at) return e;
        const role = e.capacity_wait.role;
        if (role === "apply") {
          if (e.workflow_policy === "full-openspec") yield* this.spec.plan(e);
          yield* this.assertPlan(e, p);
        }
        if (role === "review") {
          if (
            !(
              e.verification_receipt?.fingerprint ===
              (yield* this.git.fingerprint(e.worktree_directory!))
            )
          )
            return yield* new CrewError(
              "VERIFICATION_STALE",
              "Content changed while awaiting Review capacity",
            );
        }
        yield* this.launch(e, role);
        return e;
      }
      if (yield* this.obligations.recheck(e)) return e;
      if (e.current_phase === "planning" && e.workflow_policy !== "full-openspec")
        return yield* this.checkpoint(e);
      if (e.active_role) {
        if (e.resume_after_decision) yield* this.messages.deliverAnswers(e);
        const turn = yield* this.sessions.reconcile(e);
        if (turn.kind === "stopped") return yield* this.transitions.fail(e, turn.error, turn.phase);
        if (turn.kind === "completed" && e.resume_after_decision) {
          delete e.resume_after_decision;
          yield* this.launch(e, turn.role);
          return e;
        }
        if (turn.kind === "completed") return yield* this.checkpoint(e);
        return e;
      }
      const pendingRole = phaseRole(e.current_phase);
      if (pendingRole && pendingRole !== "review" && !e.session_intent) {
        if (e.current_phase === "planning" && e.workflow_policy === "full-openspec")
          yield* this.spec.create(e);
        if (e.current_phase === "applying") {
          if (e.workflow_policy === "full-openspec") yield* this.spec.plan(e);
          yield* this.assertPlan(e, p);
        }
        yield* this.launch(e, pendingRole);
        return e;
      }
      if (e.session_intent) {
        yield* this.sessions.reconcile(e);
        return e;
      }
      if (["archiving", "delivering", "verifying"].includes(e.current_phase))
        return yield* this.checkpoint(e);
      return yield* new CrewError(
        "RECOVERY_REQUIRED",
        "No active session or durable phase operation can explain this state",
      );
    }.bind(this),
    domainEffect,
  );
}
