import type { Records } from "../storage/store.ts";
import type { WorkGraph } from "../work/graph.ts";
import type { OpenSpec } from "../openspec/adapter.ts";
import type { Git } from "../git/repository.ts";
import type { Runtime } from "../opencode/runtime.ts";
import type { Delivery } from "../git/delivery.ts";
import type { Operations } from "./operations.ts";
import type { Queries } from "./queries.ts";
import type { WorkerSessions } from "./sessions.ts";
import type { Messages } from "./messages.ts";
import type { Obligations } from "./obligations.ts";
import type { ExecutionTransitions } from "./transitions.ts";
import type { Finishing } from "./finishing.ts";
import type { PRFeedback } from "./pr-feedback.ts";
import type { Finalization } from "./finalization.ts";
import type { WorkAdmission } from "./admission.ts";
import type { CodingChecks } from "./checks.ts";
import { Clock, Effect } from "effect";
import { CrewError, terminal, type Config, type Execution, type Project } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { IssueId, OperationAction, timestamp } from "../identities.ts";
import { synchronizeExecution } from "../storage/store.ts";
import { measureReconcile } from "../observability.ts";
import { phaseRole } from "./roles.ts";
import { collectApproval } from "./authorization.ts";
interface Dependencies {
  readonly config: Config;
  readonly records: Records;
  readonly work: WorkGraph;
  readonly spec: OpenSpec;
  readonly git: Git;
  readonly runtime: Runtime;
  readonly delivery: Delivery;
  readonly operations: Operations;
  readonly queries: Queries;
  readonly sessions: WorkerSessions;
  readonly messages: Messages;
  readonly obligations: Obligations;
  readonly transitions: ExecutionTransitions;
  readonly finishing: Finishing;
  readonly prFeedback: PRFeedback;
  readonly finalization: Finalization;
  readonly admission: WorkAdmission;
  readonly checks: CodingChecks;
}

/** Reconciles retained claims, uncertain effects, checkpoint/capacity waits and
 * cleanup. All effects keep their existing ownership and approval gates. */
export class ExecutionRecovery {
  constructor(
    private c: Dependencies,
    private continueExecution: {
      checkpoint: (e: Execution) => Effect.Effect<Execution, CrewError>;
      beginApply: (e: Execution, p: Project) => Effect.Effect<Execution, CrewError>;
      correctFailure: (
        e: Execution,
        error: CrewError,
      ) => Effect.Effect<Execution | undefined, CrewError>;
    },
  ) {}
  private get = (id: IssueId) => this.c.queries.get(id);
  private project = (e: Execution) => this.c.queries.effectiveProject(e);
  private assertPlan = (...args: Parameters<Dependencies["checks"]["assertPlan"]>) =>
    this.c.checks.assertPlan(...args);
  private launch = (...args: Parameters<Dependencies["sessions"]["launch"]>) =>
    this.c.sessions.launch(...args);
  reconcile: (id?: IssueId) => Effect.Effect<Execution[], CrewError> = Effect.fn(
    "ExecutionRecovery.reconcile",
  )(
    function* (this: ExecutionRecovery, id?: IssueId) {
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
                          const corrected = yield* this.continueExecution.correctFailure(e, error);
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
  reconcileExecution: (e: Execution) => Effect.Effect<Execution, CrewError> = Effect.fn(
    "ExecutionRecovery.reconcileOne",
  )(
    function* (this: ExecutionRecovery, e: Execution) {
      if (terminal(e))
        return e.finishing?.completion_notice?.status === "pending"
          ? yield* this.c.finalization.notifyCompletion(e)
          : e;
      synchronizeExecution(e, yield* this.c.obligations.collectPending(e));
      if (e.stop_status === "requested") return yield* this.c.transitions.confirmStop(e);
      if (e.current_phase === "recovery_required") {
        const p = yield* this.project(e);
        const issue = yield* this.c.work.show(e.issue_id);
        const recovered =
          (issue.status === "in_progress" && issue.assignee === e.execution_id
            ? yield* this.c.finishing.recoverAdmission(e, p)
            : undefined) ??
          (yield* this.c.finalization.recoverPublication(e, p)) ??
          (yield* this.c.finalization.recoverFinalization(e, p));
        if (recovered) return recovered;
      }
      const assessment = yield* this.c.prFeedback.poll(e);
      if (["blocked", "interrupted", "failed", "recovery_required"].includes(e.current_phase))
        return e;
      if (e.current_phase === "awaiting_merge" && e.delivery_wait) {
        if (!(e.delivery_wait.fingerprint === e.delivered_commit))
          return yield* new CrewError("DELIVERY_CHANGED", "Waiting delivery head changed");
        if ((yield* Clock.currentTimeMillis) < e.delivery_wait.next_check_at) return e;
      }
      let issue = yield* this.c.work.show(e.issue_id);
      if (e.current_phase === "claiming") {
        if (issue.status === "open" && !issue.assignee) {
          if (!(yield* this.c.work.ready).some((i) => i.id === e.issue_id))
            return yield* new CrewError(
              "NOT_READY",
              "Issue dependencies changed before claim recovery",
            );
          yield* this.c.work.claim(e.issue_id, e.execution_id);
        } else {
          if (!(issue.assignee === e.execution_id && issue.status === "in_progress"))
            return yield* new CrewError(
              "CLAIM_AMBIGUOUS",
              "Claim belongs elsewhere or issue is not in progress",
            );
        }
        issue = yield* this.c.work.show(e.issue_id);
        yield* this.c.transitions.move(e, "provisioning");
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
      if (e.current_phase === "provisioning") return yield* this.c.admission.provision(e);
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
        return yield* this.c.finalization.cleanup(e, p);
      }
      yield* this.c.git.validate(p, e);
      yield* this.c.sessions.validateLocations(e);
      if (["blocked", "interrupted", "failed", "recovery_required"].includes(e.current_phase))
        return e;
      if (e.current_phase === "validating_external")
        return yield* this.continueExecution.checkpoint(e);
      if (e.current_phase === "awaiting_merge" && !(yield* this.c.finishing.prepare(e, p)))
        return e;
      if (yield* this.c.obligations.recheck(e)) return e;
      if (e.current_phase === "awaiting_plan_approval" || e.current_phase === "awaiting_merge") {
        if (
          e.current_phase === "awaiting_merge" &&
          p.delivery === "github-pr" &&
          e.merge_approval_required &&
          e.supervisor_session_id &&
          !e.approval_receipts.some(
            (a) => a.kind === "merge" && a.fingerprint === e.delivered_commit && !a.rejected_at,
          ) &&
          (yield* this.c.delivery.inspect(p, e))?.state === "OPEN"
        )
          yield* collectApproval(
            this.c.runtime,
            e,
            "merge",
            e.supervisor_session_id,
            e.delivered_commit!,
            () => this.c.records.saveOwned(e, ["approval_receipts"]),
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
            this.c.runtime,
            e,
            a.kind,
            a.session_id,
            a.fingerprint,
            () => this.c.records.saveOwned(e, ["approval_receipts"]),
          );
          if (decision === "rejected") {
            a.rejected_at = yield* timestamp;
            if (a.kind === "plan") yield* this.c.transitions.move(e, "planning");
            return yield* this.c.transitions.fail(
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
          return yield* this.continueExecution.beginApply(e, p);
        if (e.current_phase === "awaiting_merge") {
          const pr = p.delivery === "github-pr" ? yield* this.c.delivery.inspect(p, e) : undefined;
          if (
            p.delivery === "branch" ||
            pr?.state === "MERGED" ||
            e.merge_approval_required === false ||
            e.approval_receipts.some(
              (a) => a.kind === "merge" && a.fingerprint === e.delivered_commit && a.authorized_at,
            )
          )
            return yield* this.c.finalization.finish(e, p, assessment);
        }
        return e;
      }
      if (e.capacity_wait && !e.capacity_wait.request_id) {
        if ((yield* Clock.currentTimeMillis) < e.capacity_wait.next_check_at) return e;
        const role = e.capacity_wait.role;
        if (role === "apply") {
          if (e.workflow_policy === "full-openspec") yield* this.c.spec.plan(e);
          yield* this.assertPlan(e, p);
        }
        if (role === "review") {
          if (
            !(
              e.verification_receipt?.fingerprint ===
              (yield* this.c.git.fingerprint(e.worktree_directory!))
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
      if (yield* this.c.obligations.recheck(e)) return e;
      if (e.current_phase === "planning" && e.workflow_policy !== "full-openspec")
        return yield* this.continueExecution.checkpoint(e);
      if (e.active_role) {
        if (e.resume_after_decision) yield* this.c.messages.deliverAnswers(e);
        const turn = yield* this.c.sessions.reconcile(e);
        if (turn.kind === "stopped")
          return yield* this.c.transitions.fail(e, turn.error, turn.phase);
        if (turn.kind === "completed" && e.resume_after_decision) {
          delete e.resume_after_decision;
          yield* this.launch(e, turn.role);
          return e;
        }
        if (turn.kind === "completed") return yield* this.continueExecution.checkpoint(e);
        return e;
      }
      const pendingRole = phaseRole(e.current_phase);
      if (pendingRole && pendingRole !== "review" && !e.session_intent) {
        if (e.current_phase === "planning" && e.workflow_policy === "full-openspec")
          yield* this.c.spec.create(e);
        if (e.current_phase === "applying") {
          if (e.workflow_policy === "full-openspec") yield* this.c.spec.plan(e);
          yield* this.assertPlan(e, p);
        }
        yield* this.launch(e, pendingRole);
        return e;
      }
      if (e.session_intent) {
        yield* this.c.sessions.reconcile(e);
        return e;
      }
      if (["archiving", "delivering", "verifying"].includes(e.current_phase))
        return yield* this.continueExecution.checkpoint(e);
      return yield* new CrewError(
        "RECOVERY_REQUIRED",
        "No active session or durable phase operation can explain this state",
      );
    }.bind(this),
    domainEffect,
  );
}
