import { Schema } from "effect";
import { Count } from "../primitives.ts";
import { RepositoryId, Timestamp } from "../identities.ts";
import { TaskAttentionSchema } from "./attention.ts";

export const fleetStates = [
  "running",
  "native_queued",
  "ready",
  "capacity_wait",
  "dependency_wait",
  "human_wait",
  "supervisor_wait",
  "recovery_required",
  "paused",
  "waiting",
  "completed",
  "unknown",
] as const;
export const FleetStateSchema = Schema.Literals(fleetStates);
export type FleetState = typeof FleetStateSchema.Type;
const counts = Schema.Record(FleetStateSchema, Count);
export const FleetSchema = Schema.Struct({
  counts,
  total: Count,
  native_observed: Count,
  native_total: Count,
  repositories: Schema.Array(
    Schema.Struct({
      repository_id: Schema.optional(RepositoryId),
      counts,
      attention_total: Schema.optional(Count),
    }),
  ),
  completed_today: Count,
  day_start: Timestamp,
  day_end: Timestamp,
  timezone: Schema.String,
  attention: Schema.Array(TaskAttentionSchema).check(Schema.isMaxLength(100)),
  attention_total: Schema.optional(Count),
  attention_truncated: Schema.optional(Schema.Boolean),
});

export const fleetLabels: Record<FleetState, string> = {
  running: "Running",
  native_queued: "Native queued",
  ready: "Ready",
  capacity_wait: "Waiting for capacity",
  dependency_wait: "Dependency blocked",
  human_wait: "Awaiting human",
  supervisor_wait: "Awaiting supervisor",
  recovery_required: "Recovery required",
  paused: "Paused",
  waiting: "Waiting for controller",
  completed: "Completed",
  unknown: "Native state unknown",
};

/** Local calendar boundaries include the host's daylight-saving transitions. */
export function localDay(at: number) {
  const date = new Date(at);
  return {
    day_start: Timestamp.make(
      new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString(),
    ),
    day_end: Timestamp.make(
      new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).toISOString(),
    ),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}
