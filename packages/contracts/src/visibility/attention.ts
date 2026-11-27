import { Schema } from "effect";
import { IssueId, FormId } from "../identities.ts";
import { RequestLocationSchema, type WorkSummary } from "./work-summary.ts";

export const TaskAttentionSchema = Schema.Struct({
  issue_id: IssueId,
  title: Schema.String,
  key: Schema.String,
  reason: Schema.String,
  owner: Schema.String,
  next_action: Schema.String,
  form_id: Schema.optional(FormId),
  request: Schema.optionalKey(RequestLocationSchema),
});
export type TaskAttention = typeof TaskAttentionSchema.Type;

/** A human decision requires an identifiable, available native input. */
export function humanDecision(owner: string, available: boolean) {
  return owner === "user" && available;
}
export function usableForm(form: { active: boolean; checkpoint?: { active: boolean } }) {
  return humanDecision("user", form.active && form.checkpoint?.active !== false);
}

/** Unresolved observations only; incident history alone is never an obligation. */
export function taskAttention(work: WorkSummary): TaskAttention[] {
  const entries: TaskAttention[] = [];
  const add = (
    key: string,
    reason: string,
    owner: string,
    next_action: string,
    form_id?: FormId,
    request?: typeof RequestLocationSchema.Type,
  ) =>
    entries.push({
      issue_id: work.issue_id,
      title: work.title,
      key,
      reason,
      owner,
      next_action,
      ...(request && { request }),
      ...(form_id ? { form_id } : {}),
    });
  const current = (generation: number | undefined) =>
    work.generation === undefined || generation === undefined || generation === work.generation;
  if (
    work.phase === "awaiting_plan_approval" &&
    !["not_required", "recorded", "rejected"].includes(work.outcome?.approval.state ?? "")
  ) {
    const available = work.outcome?.approval.state === "pending";
    add(
      "plan-approval",
      available ? "Plan approval required" : "Waiting for approval form delivery",
      available ? "user" : "supervisor",
      available
        ? "Review the plan and answer its approval form."
        : "Reconnect the central Abra session and reconcile this task.",
      work.outcome?.approval.form_id,
    );
  }
  if (
    work.phase === "awaiting_merge" &&
    (!work.delivery_wait || work.outcome?.approval.state === "pending") &&
    !["recorded", "not_required", "rejected"].includes(work.outcome?.approval.state ?? "")
  )
    add(
      "merge-approval",
      work.outcome?.approval.form_id
        ? "Merge approval requires review"
        : "Waiting for merge approval form delivery",
      work.outcome?.approval.form_id ? "user" : "supervisor",
      "Inspect the delivery evidence and current native approval form in Abra.",
      work.outcome?.approval.form_id,
    );
  for (const decision of work.decisions ?? []) {
    if (decision.status !== "open" || !current(decision.generation)) continue;
    add(
      `decision:${decision.key}:${decision.generation}`,
      decision.question,
      decision.owner,
      decision.owner === "user"
        ? "Answer the current native decision form in Abra."
        : "Abra must resolve the existing decision within its authority.",
      decision.form_observed ? decision.form_id : undefined,
    );
  }
  for (const wait of work.waits ?? []) {
    if (!["expired", "invalid"].includes(wait.status) || !current(wait.generation)) continue;
    add(
      `wait:${wait.key}:${wait.generation}`,
      `${wait.status === "expired" ? "Expired" : "Invalid"} wait: ${wait.condition}`,
      wait.owner,
      "Inspect the wait evidence with Abra and reconcile the existing obligation.",
    );
  }
  if (work.communication?.outstanding)
    add(
      "communication",
      `${work.communication.outstanding} unanswered request(s)`,
      "request recipient",
      "Inspect communication for the recipient, required response and response-recovery state.",
      undefined,
      work.communication.first,
    );
  if (work.outcome?.cleanup.state === "blocked")
    add("cleanup", "Delivery verified; cleanup blocked", "user", work.outcome.next_action);
  const failures = [
    "provider_failure",
    "validation_failure",
    "review_failure",
    "recovery_required",
    "suspected_stall",
  ];
  if (
    work.error ||
    failures.includes(work.supervision?.primary ?? "") ||
    ["failed", "recovery_required"].includes(work.phase ?? "") ||
    work.issue_status === "unavailable"
  )
    add(
      "recovery",
      work.error ?? "Work needs recovery inspection",
      "supervisor",
      "Inspect retained failure and recovery evidence with Abra; preserve resources.",
    );
  for (const incident of work.attention ?? []) {
    if (["handled", "superseded"].includes(incident.status) || !current(incident.generation))
      continue;
    if (
      incident.code === "decision_pending" &&
      entries.some((item) => item.key.startsWith("decision:"))
    )
      continue;
    if (incident.code === "message_pending" && work.communication?.outstanding) continue;
    if (incident.code === "cleanup_blocked" && work.outcome?.cleanup.state === "blocked") continue;
    if (incident.code === "wait_expired" || incident.code === "wait_invalid") {
      if (entries.some((item) => item.key.startsWith("wait:"))) continue;
    }
    if (incident.code === "message_update") continue;
    add(
      `incident:${incident.id}`,
      incident.evidence ?? incident.summary ?? "Attention evidence needs inspection",
      incident.status === "user_needed" ? "user" : "supervisor",
      "Inspect the retained attention evidence and current next action with Abra.",
    );
  }
  return entries;
}
