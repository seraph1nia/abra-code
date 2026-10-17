import { digest } from "../digest.ts";
import { ensure, type Execution } from "../domain.ts";
import { automation } from "../config/policy.ts";
import { type ActionInput, type Finding } from "./feedback-contracts.ts";
import { actionFindings, type CurrentAction } from "./action-contracts.ts";
import { normalizeAction, targetKey } from "./action-state.ts";

export const evidenceReply = (head: string) =>
  `Addressed in ${head}. Repository verification and independent Review passed for this correction.`;

export function prepareAction(
  e: Execution,
  input: typeof ActionInput.Type,
  automatic: boolean,
  now: number,
): CurrentAction {
  ensure(
    !e.stop_status &&
      input.generation === e.control_generation &&
      input.expected_head === e.delivered_commit,
    "ACTION_STALE",
    "Action needs the current unpaused delivered generation/head",
  );
  ensure(
    e.feedback?.complete && e.feedback.head === input.expected_head && e.pull_request_reference,
    "FEEDBACK_UNCONFIRMED",
    "Current feedback observation is required",
  );
  const policy = automation(e.effective_policy);
  const f = input.finding_id
    ? e.feedback.findings.find((f) => f.id === input.finding_id)
    : undefined;
  if (input.finding_id) ensure(f, "FINDING_STALE", "Finding revision is missing");
  const verified =
    !!e.verification_receipt &&
    e.review_receipt?.passed &&
    e.verification_receipt.fingerprint === e.review_receipt.fingerprint &&
    (e.workflow_policy !== "full-openspec" || !!e.archive_path);
  const base = {
    schema_version: 2 as const,
    id: "pending",
    generation: e.control_generation,
    repository_id: e.repository_id,
    pr: e.pull_request_reference,
    head: input.expected_head,
    status: "prepared" as const,
    created_at: now,
    updated_at: now,
    authority: "manual" as "manual" | "execution-policy",
    submission: { stage: "unsubmitted" as const },
  };
  let action: CurrentAction;
  let allowed = false;
  switch (input.kind) {
    case "ready":
      ensure(
        verified,
        "VERIFICATION_REQUIRED",
        "Ready transition requires final verification, Review and archival",
      );
      allowed = policy.publication === "draft-until-verified";
      action = { ...base, kind: "ready", target: {} };
      break;
    case "reviewers": {
      const users = [...new Set(input.users ?? policy.reviewers.users)].sort();
      const teams = [...new Set(input.teams ?? policy.reviewers.teams)].sort();
      ensure(
        users.length + teams.length > 0 &&
          [...users, ...teams].every((x) => /^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/.test(x)),
        "REVIEWER_TARGET",
        "Select safe explicit reviewer users/teams",
      );
      allowed =
        policy.reviewers.request === "on-ready" &&
        users.every((u) => policy.reviewers.users.includes(u)) &&
        teams.every((t) => policy.reviewers.teams.includes(t)) &&
        (!e.rounds?.length || policy.reviewers.rerequest_after_correction);
      action = { ...base, kind: "reviewers", target: { users, teams } };
      break;
    }
    case "reply":
    case "resolve": {
      ensure(
        f &&
          verified &&
          f.disposition?.status === "addressed" &&
          f.disposition.head === input.expected_head,
        "FEEDBACK_UNADDRESSED",
        "Only published verified corrections can receive success replies or resolution",
      );
      if (input.kind === "reply") {
        if (f.thread_id)
          ensure(
            f.comment_id,
            "COMMENT_IDENTITY",
            "Thread reply requires its published comment ID",
          );
        const body = input.body ?? evidenceReply(input.expected_head);
        allowed =
          policy.discussion.replies === "verified" && body === evidenceReply(input.expected_head);
        if (automatic && input.body)
          ensure(
            body === evidenceReply(input.expected_head),
            "REPLY_CONTENT",
            "Automatic replies use retained evidence-only content",
          );
        action = {
          ...base,
          kind: "reply",
          target: {
            finding: f.id,
            revision: f.revision,
            body,
            destination: f.thread_id
              ? { kind: "thread", thread_id: f.thread_id, comment_id: f.comment_id! }
              : { kind: "issue" },
          },
        };
      } else {
        ensure(f.thread_id, "THREAD_IDENTITY", "Finding has no review thread");
        if (policy.discussion.replies === "verified")
          ensure(
            e.feedback.actions.some(
              (a) =>
                a.kind === "reply" &&
                a.head === input.expected_head &&
                a.status === "confirmed" &&
                actionFindings(a).some((s) => s.id === f.id),
            ),
            "REPLY_UNCONFIRMED",
            "Configured evidence reply must be confirmed before resolving its thread",
          );
        const comments = e.feedback.findings.filter(
          (x) => x.thread_id === f.thread_id && x.blocking,
        );
        ensure(
          comments.every((x) => addressed(x, input.expected_head)),
          "THREAD_CHANGED",
          "Thread has unhandled or changed comments",
        );
        allowed = policy.discussion.resolve_threads === "addressed";
        action = {
          ...base,
          kind: "resolve",
          target: {
            thread_id: f.thread_id,
            revisions: (comments.length ? comments : [f])
              .map((x) => ({ id: x.id, revision: x.revision }))
              .sort((a, b) => a.id.localeCompare(b.id)),
          },
        };
      }
      break;
    }
    case "rerun": {
      ensure(
        f?.kind === "check" &&
          f.blocking &&
          f.run_id &&
          f.run_attempt &&
          f.disposition?.status === "transient" &&
          f.disposition.head === input.expected_head,
        "RERUN_ELIGIBILITY",
        "Rerun requires a classified policy-blocking current-head Actions failure",
      );
      ensure(
        policy.ci_retry.workflows.includes(f.workflow ?? ""),
        "RERUN_WORKFLOW",
        "Workflow is not authorized for reruns",
      );
      allowed = policy.ci_retry.max_reruns > 0;
      const sources = e.feedback.findings.filter(
        (x) =>
          x.kind === "check" &&
          x.blocking &&
          x.run_id === f.run_id &&
          x.run_attempt === f.run_attempt &&
          x.workflow === f.workflow &&
          x.disposition?.status === "transient" &&
          x.disposition.head === input.expected_head,
      );
      action = {
        ...base,
        kind: "rerun",
        target: { run_id: f.run_id, run_attempt: f.run_attempt, workflow: f.workflow! },
        findings: sources
          .map((x) => ({ id: x.id, revision: x.revision }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      };
      break;
    }
  }
  ensure(
    !automatic || allowed,
    "ACTION_AUTHORITY",
    "Automatic action is not enabled by the execution policy",
  );
  action = {
    ...action,
    authority: allowed ? "execution-policy" : "manual",
    id: digest([e.execution_id, targetKey(action)]),
  };
  const key = targetKey(action);
  const matching = e.feedback.actions
    .map((a) => normalizeAction(a, e))
    .filter((a) => targetKey(a) === key);
  // A historical possible effect always dominates a duplicate unsent reservation.
  const existing =
    matching.find((a) => a.status === "confirmed") ??
    matching.find((a) => a.submission.stage !== "unsubmitted") ??
    matching.find((a) => a.status === "rejected") ??
    matching.find((a) => a.status === "prepared") ??
    matching[0];
  if (existing) {
    if (existing.kind === "rerun" && action.kind === "rerun")
      return {
        ...existing,
        findings: [
          ...new Map([...existing.findings, ...action.findings].map((f) => [f.id, f])).values(),
        ],
      };
    return existing;
  }
  if (action.kind === "rerun")
    ensure(
      e.feedback.actions.filter((a) => a.kind === "rerun").length < policy.ci_retry.max_reruns,
      "RERUN_BUDGET",
      "CI rerun budget exhausted",
    );
  ensure(e.feedback.actions.length < 256, "ACTION_LIMIT", "Action history requires inspection");
  return action;
}

export const addressed = (f: Finding, head: string) =>
  f.disposition?.status === "addressed" && f.disposition.head === head;
