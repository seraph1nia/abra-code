import { Schema } from "effect";
import { Timestamp, IssueId } from "../identities.ts";
import { type Execution, type ReadinessBlocker } from "../domain.ts";
import { type SessionState } from "../opencode/runtime.ts";

export const supervisionClasses = [
  "completed",
  "recovery_required",
  "paused",
  "human_decision",
  "supervisor_decision",
  "provider_failure",
  "validation_failure",
  "review_failure",
  "delivery_wait",
  "dependency_wait",
  "suspected_stall",
  "pending_admission",
  "running",
  "idle",
  "unknown",
] as const;
export const SupervisionClass = Schema.Literals(supervisionClasses);
export const SupervisionSummarySchema = Schema.Struct({
  primary: SupervisionClass,
  native_activity: Schema.Literals([
    "running",
    "queued",
    "idle",
    "unavailable",
    "unobserved",
    "unknown",
  ]),
  observed_at: Timestamp,
});
export type SupervisionSummary = typeof SupervisionSummarySchema.Type;
export const SupervisionAggregateSchema = Schema.Struct({
  observed_at: Timestamp,
  counts: Schema.Record(SupervisionClass, Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  tasks: Schema.Array(Schema.Struct({ issue_id: IssueId, ...SupervisionSummarySchema.fields })),
  total: Schema.Int,
  truncated: Schema.Boolean,
});
export const nativeActivity = (
  native?: Pick<SessionState, "executing" | "busy" | "completion_pending">,
  unavailable = false,
): SupervisionSummary["native_activity"] =>
  unavailable
    ? "unavailable"
    : !native
      ? "unobserved"
      : native.executing === true
        ? "running"
        : native.executing === false && native.busy
          ? "queued"
          : !native.busy && !native.completion_pending
            ? "idle"
            : "unknown";
/** A read projection, never persisted or used to authorize lifecycle transitions.
 * Precedence is ordered below; detail retains all other blockers and receipts. */
export function supervisionSummary(options: {
  execution?: Execution;
  blockers: readonly ReadinessBlocker[];
  closed?: boolean;
  native?: SessionState;
  unavailable?: boolean;
  observed_at: Timestamp;
}): SupervisionSummary {
  const { execution: e, blockers, native, unavailable, observed_at } = options;
  const native_activity = nativeActivity(native, unavailable);
  const decisions =
    e?.decisions?.filter((d) => d.status === "open" && d.generation === e.control_generation) ?? [];
  const waiting =
    e?.waits?.filter((w) => w.generation === e.control_generation && w.status === "waiting") ?? [];
  let primary: SupervisionSummary["primary"];
  if (e?.current_phase === "completed" || (!e && options.closed)) primary = "completed";
  else if (e?.current_phase === "recovery_required" || e?.stop_status === "requested")
    primary = "recovery_required";
  else if (e?.current_phase === "interrupted" || e?.stop_status === "confirmed") primary = "paused";
  else if (
    e?.current_phase === "awaiting_plan_approval" ||
    (e?.current_phase === "awaiting_merge" &&
      !e.delivery_wait &&
      e.merge_approval_required &&
      !e.approval_receipts.some(
        (a) =>
          a.kind === "merge" &&
          a.fingerprint === e.delivered_commit &&
          a.authorized_at &&
          !a.rejected_at,
      )) ||
    decisions.some((d) => d.owner === "user")
  )
    primary = "human_decision";
  else if (decisions.some((d) => d.owner === "supervisor")) primary = "supervisor_decision";
  else if (
    e?.worker_failure &&
    (e.worker_failure.prompt_id === e.prompt_id ||
      e.messages?.some(
        (m) =>
          m.type !== "finding" &&
          m.generation === e.control_generation &&
          m.prompt_id === e.worker_failure!.prompt_id,
      ) ||
      (!e.worker_failure.prompt_id &&
        e.worker_started_at !== undefined &&
        Date.parse(e.worker_failure.at) >= e.worker_started_at)) &&
    ["failed", "blocked"].includes(e.current_phase)
  )
    primary = "provider_failure";
  else if (e?.review_receipt?.passed === false && ["failed", "blocked"].includes(e.current_phase))
    primary = "review_failure";
  else if (e && ["failed", "blocked"].includes(e.current_phase) && e.resume_phase === "verifying")
    primary = "validation_failure";
  else if (
    e?.delivery_wait ||
    e?.delivery_block ||
    e?.current_phase === "awaiting_merge" ||
    e?.current_phase === "delivering"
  )
    primary = "delivery_wait";
  else if (
    blockers.some((b) => b.code === "dependency") ||
    waiting.some((w) => w.kind === "dependency")
  )
    primary = "dependency_wait";
  else if (e && ["failed", "blocked"].includes(e.current_phase)) primary = "recovery_required";
  else if (
    e?.attention?.some(
      (a) =>
        a.generation === e.control_generation &&
        a.code === "suspected_stall" &&
        !["handled", "superseded"].includes(a.status),
    )
  )
    primary = "suspected_stall";
  else if (
    !e ||
    e.capacity_wait ||
    native_activity === "queued" ||
    e.capacity_reservation?.status === "uncertain"
  )
    primary = "pending_admission";
  else if (native_activity === "running") primary = "running";
  else if (native_activity === "idle") primary = "idle";
  else primary = "unknown";
  return { primary, native_activity, observed_at };
}
