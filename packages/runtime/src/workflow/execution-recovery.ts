import type { Records } from "../storage/store.ts";
import type { WorkGraph } from "../work/graph.ts";
import type { OpenSpec } from "../openspec/adapter.ts";
import type { Git } from "../git/repository.ts";
import type { Runtime } from "../opencode/runtime.ts";
import type { Delivery } from "../git/delivery.ts";
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
import { CrewError, terminal, type Execution, type Project } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { synchronizeExecution } from "../storage/store.ts";
import type { Capacity } from "./capacity.ts";
import { initialRole, phaseRole } from "./roles.ts";
import type { Authorizations, CheckpointEvidence } from "./authorization.ts";
interface Dependencies {
  readonly capacity: Capacity;
  readonly authorizations: Authorizations;
  readonly checkpoints: CheckpointEvidence;
  readonly records: Records;
  readonly work: WorkGraph;
  readonly spec: OpenSpec;
  readonly git: Git;
  readonly runtime: Runtime;
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
  recover: (e: Execution) => Effect.Effect<RecoveryOutcome, CrewError> = Effect.fn(
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
      if (
        (e.current_phase === "claiming" || e.current_phase === "provisioning") &&
        !e.capacity_reservation
      ) {
        if (e.capacity_wait && (yield* Clock.currentTimeMillis) < e.capacity_wait.next_check_at)
          return e;
        if (
          !(yield* this.c.capacity.reserve(
            e,
            initialRole(e.workflow_policy),
            yield* this.project(e),
          ))
        )
          return e;
      }
      if (e.current_phase === "claiming") {
        if (issue.status === "open" && !issue.assignee) {
          if (!(yield* this.c.work.explainSelected([e.issue_id])).ready.length)
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
        return { action: "checkpoint", execution: e } as const;
      if (e.current_phase === "awaiting_merge" && !(yield* this.c.finishing.prepare(e, p)))
        return e;
      if (yield* this.c.obligations.recheck(e)) {
        yield* this.c.sessions.releaseWaitingTurn(e);
        return e;
      }
      if (e.current_phase === "awaiting_plan_approval" || e.current_phase === "awaiting_merge") {
        if (
          e.current_phase === "awaiting_merge" &&
          p.delivery === "github-pr" &&
          e.merge_approval_required &&
          e.supervisor_session_id &&
          this.c.checkpoints.status(e, "merge") === "missing" &&
          (yield* this.c.delivery.inspect(p, e))?.state === "OPEN"
        )
          yield* this.c.authorizations.collect(e, "merge", e.supervisor_session_id);
        const rejected = yield* this.c.authorizations.collectPending(e);
        if (rejected) {
          if (rejected === "plan") yield* this.c.transitions.move(e, "planning");
          return yield* this.c.transitions.fail(
            e,
            new CrewError("APPROVAL_REJECTED", "Human rejected this checkpoint"),
          );
        }
        if (
          e.current_phase === "awaiting_plan_approval" &&
          (e.plan_approval_required === false ||
            this.c.checkpoints.status(e, "plan") === "approved")
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
      if (yield* this.c.obligations.recheck(e)) {
        yield* this.c.sessions.releaseWaitingTurn(e);
        return e;
      }
      if (e.current_phase === "planning" && e.workflow_policy !== "full-openspec")
        return { action: "checkpoint", execution: e } as const;
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
        if (turn.kind === "completed") return { action: "checkpoint", execution: e } as const;
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
        return { action: "checkpoint", execution: e } as const;
      return yield* new CrewError(
        "RECOVERY_REQUIRED",
        "No active session or durable phase operation can explain this state",
      );
    }.bind(this),
    domainEffect,
  );
}
