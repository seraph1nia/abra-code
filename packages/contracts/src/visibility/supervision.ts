import { Schema } from "effect";
import { Timestamp, IssueId } from "../identities.ts";

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
