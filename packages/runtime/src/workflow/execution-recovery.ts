import { reviewSatisfied } from "./proposal-review-contracts.ts";
import { type ProposalReviews } from "./proposal-reviews.ts";
import { WorkflowError } from "../errors.ts";
import type { WorkGraph } from "../work/graph.ts";
import type { OpenSpec } from "../openspec/adapter.ts";
import type { Git } from "../git/repository.ts";
import type { Delivery, DeliveryAssessment } from "../git/delivery.ts";
import type { Queries } from "./queries.ts";
import type { WorkerSessions } from "./sessions.ts";
import type { Messages } from "./messaging/messages.ts";
import type { Obligations } from "./obligations.ts";
import type { ExecutionTransitions } from "./transitions.ts";
import type { Finishing } from "./finishing/preparation.ts";
import type { PRFeedback } from "./pr/supervision.ts";
import type { Finalization } from "./finishing/pipeline.ts";
import type { WorkAdmission } from "./admission.ts";
import type { CodingChecks } from "./checks.ts";
import { Clock, Effect } from "effect";
import { CrewError, terminal, type Execution, type Project } from "../domain.ts";
import type { Capacity } from "./capacity.ts";
import { initialRole, phaseRole } from "./worker-assignment.ts";
import type { Authorizations, CheckpointEvidence } from "./authorization.ts";
interface Dependencies {
  readonly proposalReviews: ProposalReviews;
  readonly capacity: Capacity;
  readonly authorizations: Authorizations;
  readonly checkpoints: CheckpointEvidence;
  readonly work: WorkGraph;
  readonly spec: OpenSpec;
  readonly git: Git;
  readonly delivery: Delivery;
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

export type RecoveryOutcome =
  | Execution
  | { action: "checkpoint"; execution: Execution }
  | { action: "beginApply"; execution: Execution; project: Project };

/** Reconciles retained claims, uncertain effects, checkpoint/capacity waits and
 * cleanup. All effects keep their existing ownership and approval gates. */
export class ExecutionRecovery {
  constructor(private c: Dependencies) {}
  private project = (e: Execution) => this.c.queries.effectiveProject(e);
  private assertPlan = (...args: Parameters<Dependencies["checks"]["assertPlan"]>) =>
    this.c.checks.assertPlan(...args);
  private launch = (...args: Parameters<Dependencies["sessions"]["launch"]>) =>
    this.c.sessions.launch(...args);
  private recoverApproval = Effect.fn("ExecutionRecovery.recoverApproval")(
    { self: this },
    function* (e: Execution, p: Project, assessment?: DeliveryAssessment) {
      if (
        e.current_phase === "awaiting_merge" &&
        p.delivery === "github-pr" &&
        e.merge_approval_required &&
        e.supervisor_session_id &&
        this.c.checkpoints.status(e, "merge") === "missing" &&
        (yield* this.c.delivery.inspect(p, e))?.state === "OPEN"
      )
        e = (yield* this.c.authorizations.collect(e, "merge", e.supervisor_session_id)).execution;
      if (e.current_phase === "awaiting_plan_approval" && e.proposal_review) {
        e = yield* this.c.proposalReviews.reconcile(e, p);
        if (!reviewSatisfied(e)) return e;
      }
      const approvals = yield* this.c.authorizations.collectPending(e);
      e = approvals.execution;
      const { rejected } = approvals;
      if (rejected) return yield* this.c.transitions.rejectCheckpoint(e, rejected);
      if (
        e.current_phase === "awaiting_plan_approval" &&
        (e.plan_approval_required === false || this.c.checkpoints.status(e, "plan") === "approved")
      )
        return { action: "beginApply", execution: e, project: p } as const;
      if (e.current_phase === "awaiting_merge") {
        const pr = p.delivery === "github-pr" ? yield* this.c.delivery.inspect(p, e) : undefined;
        if (
          p.delivery === "branch" ||
          pr?.state === "MERGED" ||
          e.merge_approval_required === false ||
          this.c.checkpoints.status(e, "merge") === "approved"
        )
          return yield* this.c.finalization.finish(e, p, assessment);
      }
      return e;
    },
  );

  private recoverWorker = Effect.fn("ExecutionRecovery.recoverWorker")(
    { self: this },
    function* (e: Execution) {
      if (e.active_role) {
        if (e.resume_after_decision) e = yield* this.c.messages.deliverAnswers(e);
        const turn = yield* this.c.sessions.reconcile(e);
        e = turn.execution;
        if (turn.kind === "stopped")
          return yield* this.c.transitions.fail(e, turn.error, turn.phase);
        if (turn.kind === "completed" && e.resume_after_decision) {
          e = yield* this.launch(e, turn.role);
          return e;
        }
        if (turn.kind === "completed") return { action: "checkpoint", execution: e } as const;
        return e;
      }
      const pendingRole = phaseRole(e.current_phase);
      if (pendingRole && pendingRole !== "review" && !e.session_intent) {
        if (e.current_phase === "planning" && e.workflow_policy === "full-openspec")
          yield* this.c.spec.create(e);
        if (e.current_phase === "applying") {
          if (e.workflow_policy === "full-openspec") yield* this.c.spec.plan(e);
          yield* this.assertPlan(e);
        }
        e = yield* this.launch(e, pendingRole);
        return e;
      }
      if (e.session_intent) {
        e = (yield* this.c.sessions.reconcile(e)).execution;
        return e;
      }
      if (["archiving", "delivering", "verifying"].includes(e.current_phase))
        return { action: "checkpoint", execution: e } as const;
      return yield* new WorkflowError(
        "RECOVERY_REQUIRED",
        "No active session or durable phase operation can explain this state",
      );
    },
  );
  private recoverPublicationOrCleanup = Effect.fn("ExecutionRecovery.recoverPublicationOrCleanup")(
    { self: this },
    function* (e: Execution) {
      switch (e.resume_phase) {
        case "delivering":
          return yield* this.c.finalization.recoverPublication(e, yield* this.project(e));
        case "cleaning":
          return yield* this.c.finalization.recoverFinalization(e, yield* this.project(e));
        case "awaiting_merge": {
          const p = yield* this.project(e);
          const issue = yield* this.c.work.show(e.issue_id);
          if (issue.status === "in_progress" && issue.assignee === e.execution_id) {
            const admission = yield* this.c.finishing.recoverAdmission(e, p);
            if (admission) return admission;
          }
          return yield* this.c.finalization.recoverFinalization(e, p);
        }
        default:
          return undefined;
      }
    },
  );
  recover: (e: Execution) => Effect.Effect<RecoveryOutcome, CrewError> = Effect.fn(
    "ExecutionRecovery.reconcileOne",
  )({ self: this }, function* (e: Execution) {
    if (terminal(e))
      return e.finishing?.completion_notice?.status === "pending"
        ? yield* this.c.finalization.notifyCompletion(e)
        : e;
    e = yield* this.c.obligations.collectPending(e);
    if (e.stop_status === "requested") return yield* this.c.transitions.confirmStop(e);
    if (e.current_phase === "recovery_required" && !e.stop_status) {
      const recovered = yield* this.recoverPublicationOrCleanup(e);
      if (recovered) return recovered;
    }
    const polled = yield* this.c.prFeedback.poll(e);
    e = polled.execution;
    const { assessment } = polled;
    if (["blocked", "interrupted", "failed", "recovery_required"].includes(e.current_phase))
      return e;
    if (e.current_phase === "awaiting_merge" && e.delivery_wait) {
      if (e.delivery_wait.fingerprint !== e.delivered_commit)
        return yield* new WorkflowError("DELIVERY_CHANGED", "Waiting delivery head changed");
      if ((yield* Clock.currentTimeMillis) < e.delivery_wait.next_check_at) return e;
    }
    let issue = yield* this.c.work.show(e.issue_id);
    if (
      (e.current_phase === "claiming" || e.current_phase === "provisioning") &&
      !e.capacity_reservation
    ) {
      if (e.capacity_wait && (yield* Clock.currentTimeMillis) < e.capacity_wait.next_check_at)
        return e;
      const reservation = yield* this.c.capacity.reserve(
        e,
        initialRole(e.workflow_policy),
        yield* this.project(e),
      );
      e = reservation.execution;
      if (!reservation.admitted) return e;
    }
    if (e.current_phase === "claiming") {
      if (issue.status === "open" && !issue.assignee) {
        if (!(yield* this.c.work.explainSelected([e.issue_id])).ready.length)
          return yield* new WorkflowError(
            "NOT_READY",
            "Issue dependencies changed before claim recovery",
          );
        yield* this.c.work.claim(e.issue_id, e.execution_id);
      } else {
        if (issue.assignee !== e.execution_id || issue.status !== "in_progress")
          return yield* new WorkflowError(
            "CLAIM_AMBIGUOUS",
            "Claim belongs elsewhere or issue is not in progress",
          );
      }
      issue = yield* this.c.work.show(e.issue_id);
      e = yield* this.c.transitions.move(e, "provisioning");
    }
    if (
      e.current_phase !== "cleaning" &&
      (issue.assignee !== e.execution_id || issue.status !== "in_progress")
    )
      return yield* new WorkflowError("WORK_DRIFT", "Issue status/claim differs from execution");
    if (e.current_phase === "provisioning") return yield* this.c.admission.provision(e);
    if (issue.repository_id !== e.repository_id)
      return yield* new WorkflowError("WORK_DRIFT", "Issue repository association changed");
    if (issue.workflow_policy !== e.workflow_policy)
      return yield* new WorkflowError("POLICY_DRIFT", "Issue workflow policy changed");
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
    if (e.current_phase === "validating_external")
      return { action: "checkpoint", execution: e } as const;
    if (e.current_phase === "awaiting_merge") {
      const finishing = yield* this.c.finishing.prepare(e, p);
      e = finishing.execution;
      if (!finishing.ready) return e;
    }
    const obligations = yield* this.c.obligations.recheck(e);
    e = obligations.execution;
    if (obligations.blocked) {
      e = yield* this.c.sessions.releaseWaitingTurn(e);
      return e;
    }
    if (e.current_phase === "awaiting_plan_approval" || e.current_phase === "awaiting_merge")
      return yield* this.recoverApproval(e, p, assessment);
    if (e.capacity_wait && !e.capacity_wait.request_id) {
      if ((yield* Clock.currentTimeMillis) < e.capacity_wait.next_check_at) return e;
      const role = e.capacity_wait.role;
      if (role === "apply") {
        if (e.workflow_policy === "full-openspec") yield* this.c.spec.plan(e);
        yield* this.assertPlan(e);
      }
      if (role === "review") {
        if (
          e.verification_receipt?.fingerprint !==
          (yield* this.c.git.fingerprint(e.worktree_directory!))
        )
          return yield* new WorkflowError(
            "VERIFICATION_STALE",
            "Content changed while awaiting Review capacity",
          );
      }
      e = yield* this.launch(e, role);
      return e;
    }
    if (e.current_phase === "planning" && e.workflow_policy !== "full-openspec")
      return { action: "checkpoint", execution: e } as const;
    return yield* this.recoverWorker(e);
  });
}
