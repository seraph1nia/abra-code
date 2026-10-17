import { type Phase } from "../domain.ts";
import { type WorkItem } from "./protocol.ts";
export const sections = [
  { id: "attention", label: "Needs you" },
  { id: "working", label: "Working" },
  { id: "blocked", label: "Blocked" },
  { id: "queued", label: "Queued" },
  { id: "done", label: "Done" },
  { id: "other", label: "Other" },
] as const;
export type Section = (typeof sections)[number]["id"];
const phases = {
  queued: { section: "queued", label: "Queued" },
  claiming: { section: "working", label: "Claiming work" },
  provisioning: { section: "working", label: "Preparing worktree" },
  researching: { section: "working", label: "Researching" },
  exploring: { section: "working", label: "Exploring" },
  planning: { section: "working", label: "Planning" },
  awaiting_plan_approval: { section: "attention", label: "Approve plan" },
  applying: { section: "working", label: "Implementing" },
  validating_external: { section: "working", label: "External validation" },
  verifying: { section: "working", label: "Verifying" },
  archiving: { section: "working", label: "Archiving" },
  delivering: { section: "working", label: "Delivering" },
  awaiting_merge: { section: "attention", label: "Review merge" },
  cleaning: { section: "working", label: "Cleaning up" },
  completed: { section: "done", label: "Closed" },
  blocked: { section: "blocked", label: "Blocked" },
  interrupted: { section: "blocked", label: "Interrupted" },
  failed: { section: "blocked", label: "Failed" },
  recovery_required: { section: "attention", label: "Recovery required" },
} satisfies Record<Phase, { section: Section; label: string }>;
export function section(work: WorkItem): Section {
  if (
    work.issue_status === "unavailable" ||
    (work.phase === "completed" && work.issue_status !== "closed") ||
    (work.issue_status === "closed" && work.phase && work.phase !== "completed")
  )
    return "attention";
  if (work.issue_status === "closed") return "done";
  if (
    work.decisions?.some((d) => d.status === "open") ||
    work.waits?.some((w) => ["expired", "invalid"].includes(w.status)) ||
    work.attention?.some((a) => !["handled", "superseded"].includes(a.status))
  )
    return "attention";
  if (work.delivery_wait || work.command_wait || work.waits?.some((w) => w.status === "waiting"))
    return "working";
  if (work.capacity_wait) return "queued";
  if (work.phase && phases[work.phase]?.section === "attention") return "attention";
  if ((work.phase && phases[work.phase]?.section === "blocked") || work.issue_status === "blocked")
    return "blocked";
  if (work.error) return "attention";
  if (work.blocker_details?.some((b) => ["dependency", "policy", "setup"].includes(b.code)))
    return "blocked";
  if (work.phase && phases[work.phase]?.section === "working") return "working";
  if (work.phase && !["queued", "completed"].includes(work.phase)) return "other";
  if (work.issue_status === "open") {
    if (
      work.eligible ||
      (work.blocker_details?.length && work.blocker_details.every((b) => b.code === "capacity"))
    )
      return "queued";
    return "blocked";
  }
  return "other";
}
export function stateLabel(work: WorkItem) {
  const group = section(work);
  if (group === "done") return "Closed";
  const decision = work.decisions?.find((d) => d.status === "open");
  if (decision) return `Answer needed · ${decision.owner}: ${decision.question}`;
  const attention = work.attention?.findLast((a) => !["handled", "superseded"].includes(a.status));
  if (attention) return `${attention.code.replaceAll("_", " ")} · ${attention.status}`;
  const wait = work.waits?.find((w) => !["cleared", "superseded"].includes(w.status));
  if (wait)
    return `${wait.status === "waiting" ? "Waiting" : wait.status} · ${wait.owner}: ${wait.condition}`;
  if (work.delivery_wait)
    return `Waiting · ${work.delivery_wait.owner}: ${work.delivery_wait.reason}`;
  if (work.command_wait) return `Checking · ${work.command_wait.command}`;
  if (work.capacity_wait) return `Waiting for ${work.capacity_wait.role} capacity`;
  if (work.phase === "awaiting_plan_approval") return "Approve plan";
  if (work.phase === "awaiting_merge") return "Review merge";
  if (work.phase === "recovery_required") return "Recovery required";
  if (group === "attention") return work.error ?? "Inspect execution state";
  if (group === "blocked")
    return (
      work.error ??
      work.blocker_details?.find((b) => !["status", "execution", "capacity"].includes(b.code))
        ?.message ??
      work.phase?.replaceAll("_", " ") ??
      work.blockers[0] ??
      "Blocked"
    );
  if (group === "queued") return work.eligible ? "Ready to start" : "Waiting for worker capacity";
  return (
    (work.phase ? phases[work.phase]?.label : undefined) ??
    work.phase?.replaceAll("_", " ") ??
    work.issue_status
  );
}
export const needsAttention = (work: WorkItem) => section(work) === "attention";
export const ordered = (work: readonly WorkItem[]) =>
  [...work].sort((a, b) => a.priority - b.priority || a.issue_id.localeCompare(b.issue_id));
