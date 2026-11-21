import { measureReconcile } from "../observability.ts";
import { removeOwnedField } from "../storage/store.ts";
import type { ExecutionRecovery, RecoveryOutcome } from "./execution-recovery.ts";
import type { PlanningBaselines } from "./planning.ts";
import type { WorkAdmission } from "./admission.ts";

import { type Messages } from "./messages.ts";
import { MessageSendSchema, messageRequests, requiresResponse } from "./message-contracts.ts";
import { ExternalValidation } from "./external-validation.ts";
import { externalOwns } from "../validation/contracts.ts";

import {
  OperationAction,
  StorageKey,
  ToolName,
  FindingId,
  timestamp,
  IssueId,
  SessionId,
  RequestId,
} from "../identities.ts";

import { Finalization } from "./finalization.ts";
import { Finishing } from "./finishing.ts";
import { activeSynchronization } from "./synchronization.ts";
import { ExecutionTransitions } from "./transitions.ts";
import { Records, type ExecutionPatch } from "../storage/store.ts";

import { Corrections } from "./corrections.ts";
import { createHash } from "node:crypto";
import { Scopes } from "./scopes.ts";
import { Reports } from "./reports.ts";
import { type Scope } from "../work/scope.ts";

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

import { type WorkGraph } from "../work/graph.ts";

import { OpenSpec } from "../openspec/adapter.ts";
import { Git } from "../git/repository.ts";
import { type Delivery } from "../git/delivery.ts";

import {
  type Authorizations,
  type CheckpointEvidence,
  assertApprovalActor,
} from "./authorization.ts";
import { Queries } from "./queries.ts";
import { CodingChecks } from "./checks.ts";
import { specVerificationPassed } from "./review-contracts.ts";
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

export class Advancement {
  constructor(private c: AdvancementDependencies) {}
  get close() {
    return this.c.operations.close();
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
  start = (id: IssueId, supervisor?: SessionId) =>
    domainEffect(
      Effect.gen({ self: this }, function* () {
        identifier(id);
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
      }),
    );
  private get = (id: IssueId) => this.c.queries.get(id);
  recordWorkerFailure = (...args: Parameters<WorkerSessions["recordFailure"]>) =>
    this.c.sessions.recordFailure(...args);
  private project = (e: Execution) => this.c.queries.effectiveProject(e);
  private sessionID = workerSessionID;
  private idle = (...args: Parameters<WorkerSessions["idle"]>) => this.c.sessions.idle(...args);
  private launch = (...args: Parameters<WorkerSessions["launch"]>) =>
    this.c.sessions.launch(...args);
  reviseScope = (id: IssueId, input: Scope) =>
    this.c.operations.owned(id, OperationAction.make("scope-revision"), () =>
      domainEffect(
        Effect.gen({ self: this }, function* () {
          const e = yield* this.get(id);
          yield* this.idle(e);
          yield* this.c.scopes.validateRevision(e, input);
          const issue = yield* this.c.work.show(id);
          if (issue.status === "blocked") yield* this.c.work.resume(id, e.execution_id);
          return yield* this.c.scopes.revise(e, input, (e) => this.c.records.saveControl(e));
        }),
      ),
    );
  correctFailure = Effect.fn("Advancement.correctFailure")(
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
      const fp = yield* this.c.git.fingerprint(e.worktree_directory!);
      if (source === "review" && e.review_receipt?.fingerprint !== fp) return;
      yield* this.c.checks.assertPlan(e, yield* this.project(e));
      const key = FindingId.make(
        `${source}-${createHash("sha256").update(fp).update(text).digest("hex")}`,
      );
      const role = yield* this.c.corrections.prepare(
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
      return yield* this.c.operations.owned(id, OperationAction.make("advance"), () =>
        domainEffect(
          Effect.gen({ self: this }, function* () {
            const e = yield* this.get(id);
            return yield* this.checkpointExecution(e).pipe(
              Effect.catch((error) =>
                Effect.gen({ self: this }, function* () {
                  // Refusing an explicit checkpoint while its worker is busy
                  // must not revoke that worker's valid active assignment.
                  if (error.code === "WRITER_BUSY") return yield* error;
                  const corrected = yield* this.correctFailure(e, error);
                  if (corrected) return corrected;
                  if (!["APPROVAL_REQUIRED", "MERGE_APPROVAL", "WRITER_BUSY"].includes(error.code))
                    yield* this.c.transitions.fail(e, error);
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
  checkpointExecution: (e: Execution) => Effect.Effect<Execution, CrewError> = Effect.fn(
    "Advancement.checkpoint",
  )(
    function* (this: Advancement, e: Execution) {
      // A delayed explicit advance may arrive after scheduler-owned retirement.
      // Completed evidence is authoritative; its former worktree need not exist.
      if (terminal(e)) return e;
      const p = yield* this.project(e);
      yield* this.c.git.validate(p, e);
      if (yield* this.c.obligations.recheck(e)) {
        yield* this.c.sessions.releaseWaitingTurn(e);
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
      const completedRole = yield* this.c.sessions.requireCompleted(e);
      switch (e.current_phase) {
        case "exploring":
        case "planning": {
          yield* this.c.transitions.move(e, "planning");
          if (e.workflow_policy !== "full-openspec") {
            if (!(yield* this.c.scopes.initialize(e, yield* this.c.work.show(e.issue_id))))
              return e;
            yield* this.c.transitions.move(e, "awaiting_plan_approval");
            if (e.plan_approval_required === false) return yield* this.beginApply(e, p);
            return e;
          }
          yield* this.c.spec.plan(e);
          yield* this.c.planning.assertDelta(e);
          yield* this.c.git.run(e.worktree_directory!, [
            "add",
            "--",
            `openspec/changes/${e.openspec_change}`,
          ]);
          yield* this.c.planning.planned(e);
          yield* this.c.transitions.move(e, "awaiting_plan_approval", {
            plan_fingerprint: yield* this.c.checkpoints.plan(e),
          });
          if (e.plan_approval_required === false) return yield* this.beginApply(e, p);
          yield* this.c.transitions.notice(
            e,
            "Planning validated. Request approval with abra_work_approve.",
          );
          return e;
        }
        case "awaiting_plan_approval":
          return yield* this.beginApply(e, p);
        case "researching": {
          yield* this.c.reports.verify(e);
          yield* this.c.transitions.move(e, "cleaning");
          return yield* this.c.finalization.cleanup(e, p);
        }
        case "applying": {
          if (e.workflow_policy === "full-openspec") yield* this.c.spec.implemented(e);
          yield* this.assertPlan(e, p);
          if (e.effective_policy.validation?.engine === "no-mistakes") {
            yield* this.c.transitions.move(e, "validating_external");
            return yield* this.checkpointExecution(e);
          }
          yield* this.c.transitions.move(e, "verifying");
          return yield* this.checkpointExecution(e);
        }
        case "validating_external": {
          const external = yield* this.c.external.advance(e, p);
          return external.current_phase === "verifying"
            ? yield* this.checkpointExecution(external)
            : external;
        }
        case "verifying": {
          if (
            p.delivery === "github-pr" &&
            e.effective_policy.publication &&
            e.effective_policy.publication !== "ready" &&
            !e.provisional
          ) {
            if (!this.c.delivery.provisional)
              return yield* new CrewError(
                "DRAFT_UNSUPPORTED",
                "Delivery adapter does not support provisional publication",
              );
            const draft = yield* this.c.delivery.provisional(p, e);
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
            yield* this.c.records.saveOwned(e, ["provisional", "pull_request_reference"]);
          }
          if (completedRole === "review") {
            if (!e.review_receipt)
              return yield* new CrewError(
                "REVIEW_MISSING",
                "Independent Review completed without a matching report",
              );
          }
          if (!e.review_receipt) return yield* this.verify(e, p);
          const fp = yield* this.c.git.fingerprint(e.worktree_directory!);
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
          if (e.workflow_policy === "full-openspec") yield* this.c.spec.implemented(e);
          yield* this.assertPlan(e, p);
          yield* this.c.transitions.move(e, "archiving");
          return yield* this.c.finalization.archive(e, p);
        }
        case "archiving":
          return yield* this.c.finalization.archive(e, p);
        case "delivering":
          return yield* this.c.finalization.deliver(e, p);
        case "awaiting_merge":
          return yield* this.c.finalization.finish(e, p);
        case "cleaning":
          return yield* this.c.finalization.cleanup(e, p);
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
    this.c.checks.assertPlan(...args);
  beginApply = Effect.fn("Advancement.beginApply")(
    function* (this: Advancement, e: Execution, p: Project) {
      if (e.workflow_policy === "full-openspec") yield* this.c.spec.plan(e);
      yield* this.assertPlan(e, p);
      if (activeSynchronization(e)) {
        const committed = yield* this.c.transitions.move(e, "verifying");
        return yield* this.verify(committed, p);
      }
      const research = e.workflow_policy === "research-only";
      yield* this.c.transitions.move(e, research ? "researching" : "applying");
      yield* this.launch(e, research ? "research" : "apply");
      return e;
    }.bind(this),
    domainEffect,
  );
  private verify = (...args: Parameters<CodingChecks["verify"]>) => this.c.checks.verify(...args);
  reviewChanges = (...args: Parameters<CodingChecks["reviewChanges"]>) =>
    this.c.checks.reviewChanges(...args);
  reviewReport = (...args: Parameters<CodingChecks["reviewReport"]>) =>
    this.c.checks.reviewReport(...args);
  approve = Effect.fn("Advancement.approve")(
    function* (this: Advancement, id: IssueId, kind: "plan" | "merge", supervisor: SessionId) {
      return yield* this.c.operations.owned(id, OperationAction.make("approve"), () =>
        domainEffect(
          Effect.gen({ self: this }, function* () {
            const e = yield* this.get(id);
            const p = yield* this.project(e);
            yield* assertApprovalActor(e, supervisor);
            if (
              kind === "merge" &&
              ["cleaning", "completed"].includes(e.current_phase) &&
              this.c.checkpoints.status(e, "merge") === "approved"
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
            if (kind === "merge" && !(yield* this.c.finishing.prepare(e, p))) return e;
            const { decision, receipt } = yield* this.c.authorizations.collect(e, kind, supervisor);
            if (decision === "pending")
              return { execution: e, approval_required: true, form_id: receipt.form_id };
            if (decision === "rejected") {
              if (kind === "plan") yield* this.c.transitions.move(e, "planning");
              yield* this.c.transitions.fail(
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
      return yield* this.c.operations.owned(id, OperationAction.make("finish"), () =>
        domainEffect(
          Effect.gen({ self: this }, function* () {
            const e = yield* this.get(id);
            const p = yield* this.project(e);
            return yield* (
              e.workflow_policy === "research-only" && e.current_phase === "researching"
                ? this.checkpointExecution(e)
                : this.c.finalization.finish(e, p)
            ).pipe(
              Effect.tapError((error) =>
                Effect.gen({ self: this }, function* () {
                  e.error_or_recovery_reason = error.message;
                  yield* this.c.records.saveOwned(e, ["error_or_recovery_reason"]);
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
      return yield* this.c.operations.owned(input.issue_id, OperationAction.make("message"), () =>
        Effect.gen({ self: this }, function* () {
          const e = yield* this.get(input.issue_id);
          const saved = yield* this.c.messages.request(e, sender, input);
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
      action:
        | "pause"
        | "interrupt"
        | "resume"
        | "retry"
        | "steer"
        | "advance"
        | "replan"
        | "recover_planning",
      text?: string,
      request?: { id: RequestId; sender: SessionId },
    ) {
      if (action === "advance") return yield* this.advance(id);
      if (action === "pause" || action === "interrupt") return yield* this.c.transitions.pause(id);
      return yield* this.c.operations.owned(id, OperationAction.make("control"), () =>
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
              return yield* this.c.sessions.messages.send(e, request.sender, request.id, text);
            }
            if (action === "replan" && externalOwns(e))
              return yield* new CrewError(
                "EXTERNAL_CUSTODY",
                "Abort and return external custody before invalidating the plan",
              );
            if (action === "replan" || action === "recover_planning") {
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
            if (action === "replan" || action === "recover_planning") {
              if (
                ["archiving", "delivering", "awaiting_merge", "cleaning", "completed"].includes(
                  e.current_phase,
                )
              )
                return yield* new CrewError(
                  "REPLAN_PHASE",
                  "Replan must precede archival/delivery",
                );
              if (!request)
                return yield* new CrewError(
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
              if (!prepared.ready) return e;
              const issue = yield* this.c.work.show(e.issue_id);
              if (issue.status === "blocked") yield* this.c.work.resume(e.issue_id, e.execution_id);
              yield* this.c.transitions.move(e, "planning", {
                active_role: removeOwnedField,
                plan_fingerprint: removeOwnedField,
                verification_receipt: removeOwnedField,
                review_receipt: removeOwnedField,
                retry_instructions: text ?? removeOwnedField,
              });
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
            if (e.stop_status === "confirmed")
              yield* this.c.planning.continue(e, yield* this.project(e));
            const changes: ExecutionPatch = { stop_status: removeOwnedField };
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
                e.decisions?.some(
                  (d) => d.generation === e.control_generation && d.status === "open",
                )
              )
                return yield* new CrewError(
                  "REVIEW_SCOPE_DECISION",
                  "Resolve the Review scope conflict before retrying; use replan for changed requirements or revise the short scope",
                );
              changes.retry_instructions = text ?? e.review_receipt?.findings ?? removeOwnedField;
              changes.review_receipt = removeOwnedField;
              changes.verification_receipt = removeOwnedField;
              phase = "applying";
            }
            if (!phase)
              return yield* new CrewError("RECOVERY_REQUIRED", "No verifiable resume checkpoint");
            yield* this.idle(e);
            const issue = yield* this.c.work.show(e.issue_id);
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
            if (issue.status === "blocked") yield* this.c.work.resume(e.issue_id, e.execution_id);
            if ((phase === "claiming" || phase === "provisioning") && !e.capacity_reservation)
              changes.capacity_observed_idle = true;
            yield* this.c.transitions.move(e, phase, changes);
            if (
              e.capacity_wait ||
              ["claiming", "provisioning", "awaiting_plan_approval", "awaiting_merge"].includes(
                phase,
              )
            )
              return yield* this.reconcileExecution(e);
            if (["exploring", "planning", "applying", "researching"].includes(phase)) {
              yield* this.launch(
                e,
                phase === "researching" ? "research" : phase === "applying" ? "apply" : "explore",
              );
              return e;
            }
            return yield* this.checkpointExecution(e);
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
        : (yield* this.c.records.executions()).filter(
            (e) => !terminal(e) || e.finishing?.completion_notice?.status === "pending",
          );
      return yield* Effect.forEach(
        records,
        (record) =>
          this.c.operations
            .owned(record.issue_id, OperationAction.make("reconcile"), () =>
              domainEffect(
                Effect.gen({ self: this }, function* () {
                  const e = yield* this.get(record.issue_id);
                  return yield* this.reconcileExecution(e).pipe(
                    Effect.catch((error) =>
                      domainEffect(
                        Effect.gen({ self: this }, function* () {
                          if (e.stop_status === "requested")
                            return yield* this.c.records.saveOwned(
                              {
                                ...e,
                                error_or_recovery_reason: error.message,
                              },
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
        { concurrency: Math.max(2, this.c.config.max_workers) },
      );
    }.bind(this),
    domainEffect,
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
