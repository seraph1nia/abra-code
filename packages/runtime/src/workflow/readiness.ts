import { validateDispatch } from "../config/dispatch.ts";
import { codingPolicy } from "../config/policy.ts";
import {
  CrewError,
  terminal,
  type Config,
  type Execution,
  type Issue,
  type Project,
  type ReadinessBlocker,
} from "../domain.ts";
import { diagnosticText } from "../opencode/diagnostics.ts";
import { capacitySummaryBlockers, type CapacitySummary } from "./capacity.ts";

export type ReadinessEvidence = {
  declarationDigest?: string;
  declarationError?: string;
  authority?: ReadinessBlocker;
  capacity?: CapacitySummary;
  recordsUnavailable: boolean;
};

export function retainedReadiness(
  config: Config,
  issue: Issue,
  dependencies: readonly {
    id: Issue["id"];
    title?: string;
    status: Issue["status"] | "unavailable";
  }[],
  project: Project | undefined,
  execution: Execution | undefined,
  evidence: ReadinessEvidence,
) {
  const own = execution && !terminal(execution) ? execution : undefined;
  const blocker_details: ReadinessBlocker[] = [];
  const block = (code: ReadinessBlocker["code"], message: string) =>
    blocker_details.push({ code, message });
  if (evidence.authority) blocker_details.push(evidence.authority);
  if (evidence.recordsUnavailable)
    block("execution", "Unavailable durable records require inspection before new admission");
  if (dependencies.length)
    block(
      "dependency",
      `Dependency blockers: ${dependencies.map((d) => `${d.id} (${d.title ?? d.id}, ${d.status})`).join(", ")}`,
    );
  else if (issue.status !== "open" || issue.assignee)
    block("status", `Issue status/dependencies prevent readiness (${issue.status})`);
  if (evidence.declarationError)
    block("setup", `Configuration unavailable: ${evidence.declarationError}`);
  else if (!evidence.declarationDigest)
    block(
      "setup",
      "Repository is retained but no longer declared; restore the declaration and apply configuration for new work",
    );
  else if (project?.declaration_digest !== evidence.declarationDigest)
    block(
      "setup",
      "Repository declaration is pending or changed; use config:apply before new work",
    );
  if (!project) block("setup", "Repository is not registered");
  else {
    try {
      codingPolicy(project, issue.workflow_policy, issue.quality_profile);
      if (!own) {
        validateDispatch(config, project.dispatch);
        validateDispatch(config, issue.dispatch);
      }
    } catch (error) {
      block("setup", CrewError.from(error).message);
    }
    if (issue.workflow_policy === "full-openspec" && !project.openspec)
      block("setup", "OpenSpec configuration is missing; use abra_project_setup");
    if (issue.workflow_policy !== "research-only" && !project.verification.length)
      block("setup", "Verification commands are missing");
  }
  if (own) block("execution", executionBlocker(own));
  if (project && (!own || own.capacity_wait) && evidence.capacity)
    blocker_details.push(
      ...capacitySummaryBlockers(
        config,
        project,
        evidence.capacity,
        own?.capacity_wait?.role ??
          (issue.workflow_policy === "research-only"
            ? "research"
            : issue.workflow_policy === "lightweight-fix"
              ? "apply"
              : "explore"),
        !own,
        own?.execution_id,
      ),
    );
  if (!evidence.capacity)
    block("execution", "Population readiness evidence is temporarily unavailable");
  return {
    issue,
    repository_id: issue.repository_id,
    eligible: blocker_details.length === 0,
    blockers: blocker_details.map((blocker) => blocker.message),
    blocker_details,
    execution: own,
  };
}

/** The same retained execution has one explanation in fleet and selected views. */
export function executionBlocker(e: Execution) {
  return e.current_phase === "interrupted"
    ? "Execution is paused; explicit resume is required"
    : e.error_or_recovery_reason &&
        ["failed", "blocked", "recovery_required"].includes(e.current_phase)
      ? `Execution is ${e.current_phase}: ${diagnosticText(e.error_or_recovery_reason)}`
      : e.capacity_wait
        ? `Execution is waiting for ${e.capacity_wait.role} capacity`
        : e.active_role
          ? `${e.active_role} execution is already assigned; inspect native activity`
          : `Existing execution is ${e.current_phase}${e.error_or_recovery_reason ? `: ${diagnosticText(e.error_or_recovery_reason)}` : "; inspect its retained obligations"}`;
}
