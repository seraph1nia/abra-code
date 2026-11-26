import { type Timestamp } from "@abracode/contracts/identities";
import { actionable } from "@abracode/contracts/workflow/feedback-contracts";
import { messageRequests, requiresResponse } from "@abracode/contracts/workflow/message-contracts";
import { workerRoles } from "../config/dispatch.ts";
import { type Config, type Execution, type Issue } from "../domain.ts";
import { diagnosticText } from "../opencode/diagnostics.ts";
import { deliveryOutcome } from "./delivery-outcome.ts";
import { retainedOverviewBlockers } from "../workflow/read-model/snapshot.ts";
import { historicalWorkers } from "../workflow/worker-assignment.ts";
import { executionContract } from "../workflow/read-model/execution-contract.ts";
import { type WorkItem } from "./protocol.ts";

export { retainedOverviewBlockers };

export function communication(e?: Execution): NonNullable<WorkItem["communication"]> {
  return {
    total: e?.messages?.length ?? 0,
    outstanding: messageRequests(e?.messages).filter(requiresResponse).length,
  };
}

export function sessions(e?: Execution): WorkItem["sessions"] {
  const current = workerRoles.flatMap((role) => {
    const id = e?.[`${role}_session_id`];
    return id ? [{ id, role }] : [];
  });
  return [
    ...new Map([...(e ? historicalWorkers(e) : []), ...current].map((s) => [s.id, s])).values(),
  ];
}

export function supervision(mode: Config["supervision_mode"], e?: Execution) {
  return {
    ...(e?.worker_evidence?.length && { latest_evidence: e.worker_evidence.at(-1)?.request_id }),
    ...(e?.verification_receipt && { last_check: e.verification_receipt.fingerprint }),
    ...(e?.review_receipt && {
      review_result:
        e.review_receipt.fingerprint + "/" + (e.review_receipt.passed ? "passed" : "findings"),
    }),
    execution_contract: e ? executionContract(e, mode) : undefined,
    generation: e?.control_generation,
    delivered_head: e?.delivered_commit,
    implementation_head: e?.implementation_head,
    external_summary: e?.external_validation
      ? {
          custody: e.external_validation.custody,
          status: e.external_validation.status,
          run: e.external_validation.launch?.run_id,
          gate: e.external_validation.observation?.gate?.step,
          runs: (e.external_history?.length ?? 0) + 1,
          observed_at: e.external_validation.observed_at,
        }
      : undefined,
    feedback_summary: e?.feedback
      ? {
          complete: e.feedback.complete,
          observed_at: e.feedback.observed_at,
          next_check_at: e.feedback.next_check_at,
          finding_count: e.feedback.findings.length,
          unhandled_count: e.feedback.findings.filter((f) => actionable(f, e.feedback!.head))
            .length,
          action_count: e.feedback.actions.length,
          uncertain_count: e.feedback.actions.filter((a) =>
            ["running", "uncertain"].includes(a.status),
          ).length,
          unsubmitted_count: e.feedback.actions.filter(
            (a) => a.submission.stage === "unsubmitted" && a.status === "prepared",
          ).length,
          reruns: e.feedback.actions.filter((a) => a.kind === "rerun").length,
          error: e.feedback.error,
        }
      : undefined,
    scope_history: e?.scope_history?.slice(-20).map((s) => ({
      revision: s.revision,
      goal: diagnosticText(s.contract.goal, 512),
      fingerprint: s.fingerprint,
    })),
    operation: e?.operation,
    delivery_wait: e?.delivery_wait,
    capacity_wait: e?.capacity_wait,
    command_wait: e?.command_wait
      ? {
          command: diagnosticText(e.command_wait.command, 512),
          deadline_at: e.command_wait.deadline_at,
        }
      : undefined,
    attention: e?.attention?.slice(-20),
    attention_turns: e?.attention_turns,
    decisions: e?.decisions?.filter((d) => d.status === "open").slice(0, 20),
    decision_count: e?.decisions?.length,
    waits: e?.waits?.filter((w) => !["cleared", "superseded"].includes(w.status)).slice(0, 20),
    wait_count: e?.waits?.length,
    progress: e?.progress
      ? { ...e.progress, summary: diagnosticText(e.progress.summary, 1500) }
      : undefined,
    policy_summary: e?.effective_policy
      ? {
          quality: e.effective_policy.quality,
          publication: e.effective_policy.publication,
          reviewers: e.effective_policy.reviewers,
          discussion: e.effective_policy.discussion,
          ci_retry: e.effective_policy.ci_retry,
          validation: e.effective_policy.validation,
          plan_approval: e.effective_policy.plan_approval,
          merge_approval: e.effective_policy.merge_approval,
          merge_method: e.effective_policy.merge_method,
          ci_policy: e.effective_policy.ci_policy,
          repair_rounds: e.effective_policy.repair_rounds,
          diagnostic_turns: e.effective_policy.diagnostic_turns,
        }
      : undefined,
    rounds: e?.rounds?.slice(-20).map((r) => ({
      id: r.id,
      ordinal: r.ordinal,
      source: r.source,
      starting_head: r.starting_head,
      archive_path: r.archive_path,
      instructions: diagnosticText(r.instructions, 512),
      finding_count: r.findings.length,
    })),
    report_available: !!e?.report_receipt,
  };
}

/** Shared captured fields; admission readiness is supplied only by its owning query. */
export function retainedWork(
  mode: Config["supervision_mode"],
  issue: Issue,
  execution?: Execution,
  readiness: Pick<
    WorkItem,
    "eligible" | "blockers" | "blocker_details" | "eligibility_observed"
  > = { eligible: false, blockers: [], blocker_details: [] },
  closedAt?: Timestamp,
): WorkItem {
  return {
    issue_id: issue.id,
    title: issue.title,
    repository_id: issue.repository_id,
    priority: issue.priority,
    issue_status: issue.status,
    policy: issue.workflow_policy,
    scope: execution?.scope,
    report: execution?.report_receipt,
    ...supervision(mode, execution),
    phase: execution?.current_phase,
    active_role: issue.status === "closed" ? undefined : execution?.active_role,
    supervisor_session_id: execution?.supervisor_session_id,
    blocker_details: (readiness.blocker_details ?? []).map((b) => ({
      ...b,
      message: diagnosticText(b.message),
    })),
    sessions: sessions(execution),
    eligible: readiness.eligible,
    blockers: readiness.blockers.map((text) => diagnosticText(text)),
    error:
      issue.status !== "closed" && execution?.error_or_recovery_reason
        ? diagnosticText(execution.error_or_recovery_reason)
        : undefined,
    eligibility_observed: readiness.eligibility_observed,
    closed_at: closedAt,
  };
}

export function bindRetainedWork(
  item: WorkItem,
  execution: Execution | undefined,
  issue: Issue | undefined,
  at: number,
): WorkItem {
  return {
    ...item,
    outcome: execution ? deliveryOutcome(execution, issue?.status, at) : undefined,
    dependencies: issue?.dependencies.slice(0, 256),
    dependency_count: issue?.dependencies.length,
    communication: communication(execution),
  };
}

export function projectFinderWork(
  mode: Config["supervision_mode"],
  entry: {
    issue: Issue;
    execution?: Execution;
    executionUnavailable?: string;
    readiness?: Pick<
      WorkItem,
      "eligible" | "blockers" | "blocker_details" | "eligibility_observed"
    >;
    closedAt?: Timestamp;
  },
  at: number,
): WorkItem {
  const retained = retainedWork(
    mode,
    entry.issue,
    entry.execution,
    entry.readiness,
    entry.closedAt,
  );
  const work: WorkItem = entry.executionUnavailable
    ? {
        ...retained,
        phase: "recovery_required",
        error: entry.executionUnavailable,
        eligible: false,
        blockers: [...retained.blockers, entry.executionUnavailable],
      }
    : retained;
  return bindRetainedWork(work, entry.execution, entry.issue, at);
}
