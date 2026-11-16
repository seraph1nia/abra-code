import type { PhaseSchema } from "../primitives.ts";
type Phase = typeof PhaseSchema.Type;
export const sections = [
  { id: "attention", label: "Needs you" },
  { id: "working", label: "Working" },
  { id: "blocked", label: "Blocked" },
  { id: "queued", label: "Queued" },
  { id: "done", label: "Done" },
  { id: "other", label: "Other" },
] as const;
export type Section = (typeof sections)[number]["id"];
export const phaseMetadata = {
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
export const phaseLabel = (phase: Phase) =>
  phase === "completed" ? "Execution completed" : phaseMetadata[phase].label;
