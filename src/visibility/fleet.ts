import { Schema } from "effect";
import { Count } from "../contracts.ts";
import { IssueId, RepositoryId, Timestamp } from "../identities.ts";
import { type WorkItem } from "./protocol.ts";

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
    Schema.Struct({ repository_id: Schema.optional(RepositoryId), counts }),
  ),
  completed_today: Count,
  day_start: Timestamp,
  day_end: Timestamp,
  timezone: Schema.String,
  attention: Schema.Array(
    Schema.Struct({ issue_id: IssueId, title: Schema.String, reason: Schema.String }),
  ),
});

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
export function fleetState(work: WorkItem): FleetState {
  if (
    work.issue_status === "unavailable" ||
    (work.issue_status === "closed" && work.phase && work.phase !== "completed") ||
    (work.phase === "completed" && work.issue_status !== "closed")
  )
    return "recovery_required";
  if (work.issue_status === "closed") return "completed";
  const summary = work.supervision;
  switch (summary?.primary) {
    case "human_decision":
      return "human_wait";
    case "supervisor_decision":
      return "supervisor_wait";
    case "provider_failure":
    case "validation_failure":
    case "review_failure":
    case "recovery_required":
    case "suspected_stall":
      return "recovery_required";
    case "dependency_wait":
      return "dependency_wait";
    case "paused":
      return "paused";
    case "delivery_wait":
      return "waiting";
  }
  if (work.phase === "awaiting_plan_approval") return "human_wait";
  if (work.decisions?.some((d) => d.status === "open" && d.owner === "user")) return "human_wait";
  if (work.decisions?.some((d) => d.status === "open" && d.owner === "supervisor"))
    return "supervisor_wait";
  if (
    work.phase === "recovery_required" ||
    work.error ||
    ["failed", "blocked"].includes(work.phase ?? "")
  )
    return "recovery_required";
  if (work.phase === "interrupted") return "paused";
  if (
    work.communication?.outstanding &&
    work.attention?.some(
      (a) => a.code === "message_pending" && !["handled", "superseded"].includes(a.status),
    )
  )
    return "recovery_required";
  if (work.blocker_details?.some((b) => b.code === "dependency")) return "dependency_wait";
  if (summary?.native_activity === "running") return "running";
  if (summary?.native_activity === "queued") return "native_queued";
  if (work.capacity_wait || work.blocker_details?.some((b) => b.code === "capacity"))
    return "capacity_wait";
  if (work.eligible) return "ready";
  if (!work.phase || ["queued", "awaiting_merge"].includes(work.phase)) return "waiting";
  if (summary?.native_activity === "idle") return "waiting";
  return "unknown";
}
export function fleetCounts(work: readonly WorkItem[]) {
  const result = Object.fromEntries(fleetStates.map((state) => [state, 0])) as Record<
    FleetState,
    number
  >;
  for (const item of work) result[fleetState(item)]++;
  return result;
}
export function fleetRepositories(work: readonly WorkItem[]) {
  const groups = new Map<WorkItem["repository_id"], ReturnType<typeof fleetCounts>>();
  for (const item of work) {
    let counts = groups.get(item.repository_id);
    if (!counts) {
      counts = fleetCounts([]);
      groups.set(item.repository_id, counts);
    }
    counts[fleetState(item)]++;
  }
  return [...groups]
    .sort(([a], [b]) => (a ?? "").localeCompare(b ?? ""))
    .map(([repository_id, counts]) => ({ repository_id, counts }));
}
