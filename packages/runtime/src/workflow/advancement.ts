import { planSteps } from "../openspec/plan-steps.ts";
import { WorkflowError } from "../errors.ts";
import { tryDomainValue } from "../effect.ts";
import { measureReconcile } from "../observability.ts";
import { removeOwnedField } from "../storage/store.ts";
import type { ExecutionRecovery, RecoveryOutcome } from "./execution-recovery.ts";
import type { PlanningBaselines } from "./planning.ts";
import type { WorkAdmission } from "./admission.ts";
import { type Messages } from "./messaging/messages.ts";
import {
  MessageSendSchema,
  messageRequests,
  requiresResponse,
} from "@abracode/contracts/workflow/message-contracts";
import { ExternalValidation } from "./external-validation.ts";
import { externalOwns } from "@abracode/contracts/validation/contracts";
import {
  OperationAction,
  StorageKey,
  ToolName,
  FindingId,
  timestamp,
  IssueId,
  SessionId,
  RequestId,
} from "@abracode/contracts/identities";
import { Finalization } from "./finishing/pipeline.ts";
import { Finishing } from "./finishing/preparation.ts";
import { activeSynchronization } from "./finishing/synchronization.ts";
import { ExecutionTransitions } from "./transitions.ts";
import { Records, type ExecutionPatch } from "../storage/store.ts";
import { Corrections } from "./corrections.ts";
import { createHash } from "node:crypto";
import { Scopes } from "./scopes.ts";
import { Reports } from "../reporting/reports.ts";
import { type Scope } from "../work/scope.ts";
import { Obligations } from "./obligations.ts";
import { Clock, Effect, Match } from "effect";
import {
  CrewError,
  identifier,
  terminal,
  type Config,
  type Execution,
  type Project,
  type Role,
} from "../domain.ts";
import { type WorkGraph } from "../work/graph.ts";
import { OpenSpec } from "../openspec/adapter.ts";
import { Git } from "../git/repository.ts";
import { type Delivery } from "../git/delivery.ts";
import { type Authorizations, type CheckpointEvidence } from "./authorization.ts";
import { Queries } from "./queries.ts";
import { CodingChecks } from "./checks.ts";
import { specVerificationPassed } from "@abracode/contracts/workflow/review-contracts";
import { WorkerSessions, workerSessionID } from "./sessions.ts";
import { Operations } from "./operations.ts";

export interface AdvancementDependencies {
  readonly config: Config;
  readonly planning: PlanningBaselines;
  readonly authorizations: Authorizations;
  readonly checkpoints: CheckpointEvidence;
  readonly admission: WorkAdmission;
  readonly recovery: ExecutionRecovery;
  readonly records: Records;
  readonly work: WorkGraph;
  readonly spec: OpenSpec;
  readonly git: Git;
  readonly delivery: Delivery;
  readonly obligations: Obligations;
  readonly operations: Operations;
  readonly scopes: Scopes;
  readonly corrections: Corrections;
  readonly reports: Reports;
  readonly queries: Queries;
  readonly sessions: WorkerSessions;
  readonly messages: Messages;
  readonly checks: CodingChecks;
  readonly transitions: ExecutionTransitions;
  readonly external: ExternalValidation;
  readonly finishing: Finishing;
  readonly finalization: Finalization;
}

type ControlAction =
  | "pause"
  | "interrupt"
  | "resume"
  | "retry"
  | "steer"
  | "advance"
  | "replan"
  | "recover_planning";
type ControlRequest = { readonly id: RequestId; readonly sender: SessionId };

export class Advancement {
  constructor(private c: AdvancementDependencies) {}
  get close() {
    return this.c.operations.close;
  }
  recordSupervisor = (sessionID: SessionId) =>
    this.c.records.store.set(StorageKey.make("supervisor/session"), sessionID);
  recordWorkerTools = (
    sessionID: SessionId,
    model: import("../domain.ts").WorkerModel,
    names: ToolName[],
  ) =>
    timestamp.pipe(
      Effect.flatMap((at) =>
        this.c.records.store.set(StorageKey.make(`worker-tools/${sessionID}`), {
          model,
          names,
          at,
        }),
      ),
    );
  private withOwnedRecord<A>(
    id: IssueId,
    action: string,
    body: (e: Execution) => Effect.Effect<A, CrewError>,
  ) {
    return this.c.operations.owned(id, OperationAction.make(action), () =>
      Effect.gen({ self: this }, function* () {
        return yield* body(yield* this.get(id));
      }),
    );
  }
  private withOwnedExecution<A>(
    id: IssueId,
    action: string,
    body: (e: Execution, p: Project) => Effect.Effect<A, CrewError>,
  ) {
    return this.withOwnedRecord(id, action, (e) =>
      Effect.gen({ self: this }, function* () {
        return yield* body(e, yield* this.project(e));
      }),
    );
  }
  start = (id: IssueId, supervisor?: SessionId) =>
    Effect.gen({ self: this }, function* () {
      yield* tryDomainValue(identifier, id);
      return yield* this.c.operations.owned(id, OperationAction.make("start"), () =>
        Effect.gen({ self: this }, function* () {
          const outcome = yield* this.c.admission.start(id, supervisor);
          if (!("action" in outcome)) return outcome;
          const e = outcome.execution;
          if (outcome.action === "reconcile") return yield* this.reconcileExecution(e);
          return yield* this.checkpointExecution(e).pipe(
            Effect.tapError((error) => this.c.transitions.fail(e, error, "recovery_required")),
          );
        }),
      );
    });
  private get = (id: IssueId) => this.c.queries.get(id);
  recordWorkerFailure = (...args: Parameters<WorkerSessions["recordFailure"]>) =>
    this.c.sessions.recordFailure(...args);
  private project = (e: Execution) => this.c.queries.effectiveProject(e);
  private sessionID = workerSessionID;
  private idle = (...args: Parameters<WorkerSessions["idle"]>) => this.c.sessions.idle(...args);
  private launch = (...args: Parameters<WorkerSessions["launch"]>) =>
    this.c.sessions.launch(...args);
  reviseScope = (id: IssueId, input: Scope) =>
    this.withOwnedRecord(id, "scope-revision", (e) =>
      Effect.gen({ self: this }, function* () {
        yield* this.idle(e);
        const issue = yield* this.c.work.show(id);
        if (issue.status === "blocked") e = { ...e, pending_issue_status: "in_progress" };
        const revised = yield* this.c.scopes.revise(e, input, (record) =>
          this.c.records.commitControl(record),
        );
        if (revised.pending_issue_status) yield* this.c.operations.reflectIssue(revised);
        const delivered = yield* this.c.authorizations.reconcilePlan(revised);
        yield* this.c.operations.notifyControl(id);
        return delivered;
      }),
    );
  correctFailure = Effect.fn("Advancement.correctFailure")(
    { self: this },
    function* (e: Execution, error: CrewError) {
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
      const fp = yield* this.c.git.fingerprint(e.worktree_directory!);
      if (source === "review" && e.review_receipt?.fingerprint !== fp) return;
      yield* this.c.checks.assertPlan(e);
      const key = FindingId.make(
        `${source}-${createHash("sha256").update(fp).update(text).digest("hex")}`,
      );
      const correction = yield* this.c.corrections.prepare(
        e,
        source,
        [key],
        text,
        source === "check" ? "in_scope" : (e.review_receipt?.scope_status ?? "uncertain"),
      );
      e = correction.execution;
      const { role } = correction;
      if (role) {
        e = yield* this.launch(e, role);
        return e;
      }
    },
  );
  advance = Effect.fn("Advancement.advance")({ self: this }, function* (id: IssueId) {
    return yield* this.withOwnedRecord(id, "advance", (e) =>
      this.checkpointExecution(e).pipe(
        Effect.catch((error) =>
          Effect.gen({ self: this }, function* () {
            // Refusing an explicit checkpoint while its worker is busy
            // must not revoke that worker's valid active assignment.
            if (["STOP_REQUESTED", "STALE_OPERATION", "WRITER_BUSY"].includes(error.code))
              return yield* error;
            const corrected = yield* this.correctFailure(e, error);
            if (corrected) return corrected;
            if (!["APPROVAL_REQUIRED", "MERGE_APPROVAL", "WRITER_BUSY"].includes(error.code))
              yield* this.c.transitions.fail(e, error);
            return yield* error;
          }),
        ),
      ),
    );
  });
  private checkpointPlanning = Effect.fn("Advancement.checkpointPlanning")(
    { self: this },
    function* (e: Execution, p: Project) {
      e = yield* this.c.transitions.move(e, "planning");
      if (e.workflow_policy !== "full-openspec") {
        const scope = yield* this.c.scopes.initialize(e, yield* this.c.work.show(e.issue_id));
        e = scope.execution;
        if (!scope.ready) return e;
        e = yield* this.c.transitions.move(e, "awaiting_plan_approval");
        if (e.plan_approval_required === false) return yield* this.beginApply(e, p);
        return yield* this.c.authorizations.reconcilePlan(e);
      }
      yield* this.c.spec.plan(e);
      yield* this.c.planning.assertDelta(e);
      yield* this.c.git.run(e.worktree_directory!, [
        "add",
        "--",
        `openspec/changes/${e.openspec_change}`,
      ]);
      e = yield* this.c.planning.planned(e);
      e = yield* this.c.transitions.move(e, "awaiting_plan_approval", {
        plan_fingerprint: yield* this.c.checkpoints.plan(e),
      });
      if (e.plan_approval_required === false) return yield* this.beginApply(e, p);
      return yield* this.c.authorizations.reconcilePlan(e);
    },
  );
  private checkpointApplying = Effect.fn("Advancement.checkpointApplying")(
    { self: this },
    function* (e: Execution) {
      if (e.workflow_policy === "full-openspec") yield* this.c.spec.implemented(e);
      yield* this.assertPlan(e);
      e = yield* this.c.transitions.move(
        e,
        e.effective_policy.validation?.engine === "no-mistakes"
          ? "validating_external"
          : "verifying",
      );
      return yield* this.checkpointExecution(e);
    },
  );
  private checkpointVerifying = Effect.fn("Advancement.checkpointVerifying")(
    { self: this },
    function* (e: Execution, p: Project, completedRole?: Role) {
      if (
        p.delivery === "github-pr" &&
        e.effective_policy.publication &&
        e.effective_policy.publication !== "ready" &&
        !e.provisional
      ) {
        if (!this.c.delivery.provisional)
          return yield* new WorkflowError(
            "DRAFT_UNSUPPORTED",
            "Delivery adapter does not support provisional publication",
          );
        const draft = yield* this.c.delivery.provisional(p, e);
        if (!draft.pr)
          return yield* new WorkflowError(
            "DRAFT_PR",
            "Draft publication did not produce an owned PR",
          );
        e = {
          ...e,
          provisional: {
            head: draft.commit,
            pr: draft.pr,
            at: yield* Clock.currentTimeMillis,
          },
        };
        e = { ...e, pull_request_reference: draft.pr };
        e = yield* this.c.records.saveOwned(e, ["provisional", "pull_request_reference"]);
      }
      if (completedRole === "review" && !e.review_receipt)
        return yield* new WorkflowError(
          "REVIEW_MISSING",
          "Independent Review completed without a matching report",
        );
      if (!e.review_receipt) return yield* this.verify(e, p);
      const fp = yield* this.c.git.fingerprint(e.worktree_directory!);
      if (!e.review_receipt.passed || e.review_receipt.fingerprint !== fp)
        return yield* new WorkflowError(
          "REVIEW_FAILED",
          "Review failed or reviewed content changed",
        );
      if (
        e.workflow_policy === "full-openspec" &&
        !specVerificationPassed(e.review_receipt.spec_verification)
      )
        return yield* new WorkflowError(
          "SPEC_VERIFICATION_REQUIRED",
          "Full-spec Review evidence is missing or incomplete; retry independent Review",
        );
      if (e.verification_receipt?.fingerprint !== fp)
        return yield* new WorkflowError(
          "VERIFICATION_STALE",
          "Repository checks do not cover current content",
        );
      const steps =
        e.workflow_policy === "full-openspec"
          ? planSteps(e, yield* this.c.spec.implemented(e))
          : undefined;
      yield* this.assertPlan(e);
      e = yield* this.c.transitions.move(
        e,
        "archiving",
        steps
          ? {
              retained_steps: {
                change: e.openspec_change,
                fingerprint: e.plan_fingerprint!,
                steps,
              },
            }
          : {},
      );
      return yield* this.c.finalization.archive(e, p);
    },
  );
  checkpointExecution: (e: Execution) => Effect.Effect<Execution, CrewError> = Effect.fn(
    "Advancement.checkpoint",
  )({ self: this }, function* (e: Execution) {
    // A delayed explicit advance may arrive after scheduler-owned retirement.
    // Completed evidence is authoritative; its former worktree need not exist.
    if (terminal(e)) return e;
    const p = yield* this.project(e);
    yield* this.c.git.validate(p, e);
    const obligations = yield* this.c.obligations.recheck(e);
    e = obligations.execution;
    if (obligations.blocked) {
      e = yield* this.c.sessions.releaseWaitingTurn(e);
      return e;
    }
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
    yield* this.c.corrections.assertArchives(e);
    const completed = yield* this.c.sessions.requireCompleted(e);
    e = completed.execution;
    const completedRole = completed.role;
    return yield* Match.value(e.current_phase).pipe(
      Match.whenOr("exploring", "planning", () => this.checkpointPlanning(e, p)),
      Match.when("awaiting_plan_approval", () => this.beginApply(e, p)),
      Match.when("researching", () =>
        this.c.reports.verify(e).pipe(
          Effect.flatMap((verified) => this.c.transitions.move(verified, "cleaning")),
          Effect.flatMap((cleaning) => this.c.finalization.cleanup(cleaning, p)),
        ),
      ),
      Match.when("applying", () => this.checkpointApplying(e)),
      Match.when("validating_external", () =>
        this.c.external.advance(e, p).pipe(
          Effect.filterOrElse(
            (external) => external.current_phase !== "verifying",
            (external) => this.checkpointExecution(external),
          ),
        ),
      ),
      Match.when("verifying", () => this.checkpointVerifying(e, p, completedRole)),
      Match.when("archiving", () => this.c.finalization.archive(e, p)),
      Match.when("delivering", () => this.c.finalization.deliver(e, p)),
      Match.when("awaiting_merge", () => this.c.finalization.finish(e, p)),
      Match.when("cleaning", () => this.c.finalization.cleanup(e, p)),
      Match.when("completed", () => Effect.succeed(e)),
      Match.whenOr(
        "queued",
        "claiming",
        "provisioning",
        "blocked",
        "failed",
        "interrupted",
        "recovery_required",
        (phase) =>
          Effect.fail(
            new WorkflowError("PHASE", `Cannot advance ${phase}; use retry/resume/reconcile`),
          ),
      ),
      Match.exhaustive,
    );
  });
  private assertPlan = (...args: Parameters<CodingChecks["assertPlan"]>) =>
    this.c.checks.assertPlan(...args);
  beginApply = Effect.fn("Advancement.beginApply")(
    { self: this },
    function* (e: Execution, p: Project) {
      if (e.workflow_policy === "full-openspec") yield* this.c.spec.plan(e);
      yield* this.assertPlan(e);
      if (activeSynchronization(e)) {
        const committed = yield* this.c.transitions.move(e, "verifying");
        return yield* this.verify(committed, p);
      }
      const research = e.workflow_policy === "research-only";
      e = yield* this.c.transitions.move(e, research ? "researching" : "applying");
      e = yield* this.launch(e, research ? "research" : "apply");
      return e;
    },
  );
  private verify = (...args: Parameters<CodingChecks["verify"]>) => this.c.checks.verify(...args);
  reviewChanges = (...args: Parameters<CodingChecks["reviewChanges"]>) =>
    this.c.checks.reviewChanges(...args);
  reviewReport = (...args: Parameters<CodingChecks["reviewReport"]>) =>
    this.c.checks.reviewReport(...args);
  reserveCheckpointResponse = (...args: Parameters<Authorizations["reserveResponse"]>) =>
    this.c.authorizations.reserveResponse(...args);
  approve = Effect.fn("Advancement.approve")(
    { self: this },
    function* (id: IssueId, kind: "plan" | "merge", supervisor: SessionId) {
      yield* this.c.authorizations.assertActor(supervisor);
      return yield* this.withOwnedExecution(id, "approve", (e, p) =>
        Effect.gen({ self: this }, function* () {
          if (
            kind === "merge" &&
            ["cleaning", "completed"].includes(e.current_phase) &&
            this.c.checkpoints.status(e, "merge") === "approved"
          ) {
            // The receipt is already committed; do not touch a retired worktree or create a form.
            return e;
          }
          yield* this.idle(e);
          if (e.current_phase !== (kind === "plan" ? "awaiting_plan_approval" : "awaiting_merge"))
            return yield* new WorkflowError(
              "APPROVAL_PHASE",
              "Approval does not match current phase",
            );
          if (kind === "merge") {
            const finishing = yield* this.c.finishing.prepare(e, p);
            e = finishing.execution;
            if (!finishing.ready) return e;
          }
          const collected = yield* this.c.authorizations.collect(e, kind, supervisor);
          e = collected.execution;
          const { decision, receipt } = collected;
          if (decision === "pending")
            return { execution: e, approval_required: true, form_id: receipt.form_id };
          if (decision === "rejected") {
            yield* this.c.transitions.rejectCheckpoint(e, kind);
            return yield* new WorkflowError("APPROVAL_REJECTED", "Human rejected this checkpoint");
          }
          return yield* kind === "plan" ? this.beginApply(e, p) : Effect.succeed(e);
        }),
      );
    },
  );
  finish = Effect.fn("Advancement.finish")({ self: this }, function* (id: IssueId) {
    return yield* this.withOwnedExecution(id, "finish", (e, p) =>
      (e.workflow_policy === "research-only" && e.current_phase === "researching"
        ? this.checkpointExecution(e)
        : this.c.finalization.finish(e, p)
      ).pipe(
        Effect.tapError((error) =>
          Effect.gen({ self: this }, function* () {
            e = { ...e, error_or_recovery_reason: error.message };
            yield* this.c.records.saveOwned(e, ["error_or_recovery_reason"]);
          }),
        ),
      ),
    );
  });
  workMessage = Effect.fn("Advancement.workMessage")(
    { self: this },
    function* (input: typeof MessageSendSchema.Type, sender: SessionId) {
      return yield* this.withOwnedRecord(input.issue_id, "message", (e) =>
        Effect.gen({ self: this }, function* () {
          const saved = yield* this.c.messages.request(e, sender, input);
          return messageRequests(saved.messages).find((m) => m.request_id === input.request_id)!;
        }),
      );
    },
  );
  private steer = Effect.fn("Advancement.steer")(
    { self: this },
    function* (e: Execution, text?: string, request?: ControlRequest) {
      if (!(text && this.sessionID(e)))
        return yield* new WorkflowError(
          "STEER",
          "An active session and steering text are required",
        );
      if (!request)
        return yield* new WorkflowError(
          "MESSAGE_ID",
          "Steering requires a stable request identity and trusted sender",
        );
      return yield* this.c.sessions.messages.send(e, request.sender, request.id, text);
    },
  );
  private replan = Effect.fn("Advancement.replan")(
    { self: this },
    function* (
      e: Execution,
      action: "replan" | "recover_planning",
      text?: string,
      request?: ControlRequest,
    ) {
      if (action === "replan" && externalOwns(e))
        return yield* new WorkflowError(
          "EXTERNAL_CUSTODY",
          "Abort and return external custody before invalidating the plan",
        );
      if (e.stop_status || e.current_phase === "interrupted")
        return yield* new WorkflowError(
          "CONTROL_PAUSED",
          "Resume paused work explicitly before replanning",
        );
      if (action === "replan" && e.workflow_policy !== "full-openspec") {
        return yield* new WorkflowError(
          "SCOPE_REVISION",
          "Use abra_work_scope with the complete revised contract",
        );
      }
      if (
        ["archiving", "delivering", "awaiting_merge", "cleaning", "completed"].includes(
          e.current_phase,
        )
      )
        return yield* new WorkflowError("REPLAN_PHASE", "Replan must precede archival/delivery");
      if (!request)
        return yield* new WorkflowError(
          "MESSAGE_ID",
          "Planning control requires a stable request identity and trusted sender",
        );
      const prepared = yield* this.c.planning.prepare(
        e,
        yield* this.project(e),
        action,
        request,
        text,
      );
      e = prepared.execution;
      if (!prepared.ready) return e;
      const issue = yield* this.c.work.show(e.issue_id);
      e = yield* this.c.transitions.move(
        e,
        "planning",
        {
          ...(issue.status === "blocked" && { pending_issue_status: "in_progress" }),
          active_role: removeOwnedField,
          plan_fingerprint: removeOwnedField,
          verification_receipt: removeOwnedField,
          review_receipt: removeOwnedField,
          retry_instructions: text ?? removeOwnedField,
        },
        "replan",
      );
      if (e.pending_issue_status) e = yield* this.c.operations.reflectIssue(e);
      e = yield* this.launch(e, "explore");
      return e;
    },
  );
  private resume = Effect.fn("Advancement.resume")(
    { self: this },
    function* (e: Execution, action: "resume" | "retry", text?: string) {
      if (!["blocked", "failed", "interrupted", "recovery_required"].includes(e.current_phase))
        return yield* new WorkflowError("CONTROL_PHASE", "Execution does not need retry/resume");
      if (e.stop_status === "requested")
        return yield* new WorkflowError(
          "STOP_PENDING",
          "Wait for owned operation and native worker termination before replacing a writer",
        );
      if (e.stop_status === "confirmed")
        e = yield* this.c.planning.continue(e, yield* this.project(e));
      const changes: ExecutionPatch = {
        stop_status: removeOwnedField,
        ...(action === "retry" && text && { retry_instructions: text }),
      };
      let phase = e.resume_phase;
      if (
        action === "retry" &&
        phase === "verifying" &&
        e.workflow_policy === "full-openspec" &&
        e.review_receipt?.passed &&
        !specVerificationPassed(e.review_receipt.spec_verification)
      ) {
        changes.review_receipt = removeOwnedField;
        changes.verification_receipt = removeOwnedField;
        changes.retry_instructions =
          text ?? "Complete specification verification for the approved change";
      } else if (
        action === "retry" &&
        phase === "verifying" &&
        (e.review_receipt?.passed === false || text)
      ) {
        if (
          e.review_receipt?.passed === false &&
          e.review_receipt.scope_status !== "in_scope" &&
          e.decisions?.some((d) => d.generation === e.control_generation && d.status === "open")
        )
          return yield* new WorkflowError(
            "REVIEW_SCOPE_DECISION",
            "Resolve the Review scope conflict before retrying; use replan for changed requirements or revise the short scope",
          );
        changes.retry_instructions = text ?? e.review_receipt?.findings ?? removeOwnedField;
        changes.review_receipt = removeOwnedField;
        changes.verification_receipt = removeOwnedField;
        phase = "applying";
      }
      if (!phase)
        return yield* new WorkflowError("RECOVERY_REQUIRED", "No verifiable resume checkpoint");
      yield* this.idle(e);
      const issue = yield* this.c.work.show(e.issue_id);
      if (
        issue.assignee !== e.execution_id &&
        (phase !== "claiming" || issue.status !== "open" || issue.assignee)
      )
        return yield* new WorkflowError(
          "CLAIM_LOST",
          "Cannot resume work owned by another execution",
        );
      if (issue.status === "blocked") changes.pending_issue_status = "in_progress";
      if ((phase === "claiming" || phase === "provisioning") && !e.capacity_reservation)
        changes.capacity_observed_idle = true;
      e = yield* this.c.transitions.move(
        e,
        phase,
        changes,
        action === "retry" ? "review_retry" : undefined,
      );
      if (e.pending_issue_status) e = yield* this.c.operations.reflectIssue(e);
      if (
        e.capacity_wait ||
        ["claiming", "provisioning", "awaiting_plan_approval", "awaiting_merge"].includes(phase)
      )
        return yield* this.reconcileExecution(e);
      if (["exploring", "planning", "applying", "researching"].includes(phase)) {
        e = yield* this.launch(
          e,
          phase === "researching" ? "research" : phase === "applying" ? "apply" : "explore",
        );
        return e;
      }
      return yield* this.checkpointExecution(e);
    },
  );
  control = (id: IssueId, action: ControlAction, text?: string, request?: ControlRequest) =>
    Match.value(action).pipe(
      Match.when("advance", () => this.advance(id)),
      Match.whenOr("pause", "interrupt", () => this.c.transitions.pause(id)),
      Match.when("steer", () =>
        this.withOwnedRecord(id, "control", (e) => this.steer(e, text, request)),
      ),
      Match.whenOr("replan", "recover_planning", (mode) =>
        this.withOwnedRecord(id, "control", (e) => this.replan(e, mode, text, request)),
      ),
      Match.whenOr("resume", "retry", (mode) =>
        this.withOwnedRecord(id, "control", (e) => this.resume(e, mode, text)),
      ),
      Match.exhaustive,
    );
  reconcile: (id?: IssueId) => Effect.Effect<Execution[], CrewError> = Effect.fn(
    "Advancement.reconcile",
  )(
    { self: this },
    function* (id?: IssueId) {
      const records = id
        ? [yield* this.get(id)]
        : (yield* this.c.records.executions).filter(
            (e) => !terminal(e) || e.finishing?.completion_notice?.status === "pending",
          );
      return yield* Effect.forEach(
        records,
        (record) =>
          this.withOwnedRecord(record.issue_id, "reconcile", (e) =>
            this.reconcileExecution(e).pipe(
              Effect.catch((error) =>
                Effect.gen({ self: this }, function* () {
                  if (["STOP_REQUESTED", "STALE_OPERATION"].includes(error.code))
                    return yield* error;
                  if (e.stop_status === "requested")
                    return yield* this.c.records.saveOwned(
                      { ...e, error_or_recovery_reason: error.message },
                      ["error_or_recovery_reason"],
                    );
                  const corrected = yield* this.correctFailure(e, error);
                  if (corrected) return corrected;
                  if (
                    error.code === "FORGE_OBSERVATION_FAILED" &&
                    e.current_phase === "awaiting_merge"
                  )
                    return yield* this.c.finalization.wait(e, {
                      category: "retryable",
                      code: error.code,
                      reason: error.message,
                      owner: "forge",
                    });
                  return yield* this.c.transitions.fail(
                    e,
                    error,
                    ["VERIFICATION_FAILED", "REVIEW_FAILED"].includes(error.code)
                      ? "blocked"
                      : "recovery_required",
                  );
                }),
              ),
            ),
          ).pipe(
            Effect.catchIf(
              (error) => ["LOCKED", "STOP_REQUESTED", "STALE_OPERATION"].includes(error.code),
              () => this.get(record.issue_id),
            ),
          ),
        { concurrency: Math.max(2, this.c.config.max_workers) },
      );
    },
    measureReconcile,
  );
  private reconcileExecution = (e: Execution): Effect.Effect<Execution, CrewError> =>
    this.c.recovery.recover(e).pipe(
      Effect.flatMap((outcome: RecoveryOutcome) => {
        if (!("action" in outcome)) return Effect.succeed(outcome);
        if (outcome.action === "beginApply")
          return this.beginApply(outcome.execution, outcome.project);
        return this.checkpointExecution(outcome.execution);
      }),
    );
}
