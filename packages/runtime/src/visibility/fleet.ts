import { Timestamp } from "@abracode/contracts/identities";
import type { WorkItem } from "./protocol.ts";
import { taskAttention } from "@abracode/contracts/visibility/attention";
import { fleetStates, type FleetState } from "@abracode/contracts/visibility/fleet";
export * from "@abracode/contracts/visibility/fleet";
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
  const groups = new Map<
    WorkItem["repository_id"],
    { counts: ReturnType<typeof fleetCounts>; attention_total: number }
  >();
  for (const item of work) {
    let group = groups.get(item.repository_id);
    if (!group) {
      group = { counts: fleetCounts([]), attention_total: 0 };
      groups.set(item.repository_id, group);
    }
    group.counts[fleetState(item)]++;
    group.attention_total += taskAttention(item).length;
  }
  return [...groups]
    .sort(([a], [b]) => (a ?? "").localeCompare(b ?? ""))
    .map(([repository_id, group]) => ({ repository_id, ...group }));
}
