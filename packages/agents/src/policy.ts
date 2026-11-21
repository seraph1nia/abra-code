import { createHash } from "node:crypto";
import { basename, relative, sep } from "node:path";
import { Agent } from "@opencode/schema/agent";
import { Skill } from "@opencode/schema/skill";
import { type Role, type Policy } from "./types.ts";
import { AgentDefinitionError } from "./errors.ts";
import { ToolName } from "@abracode/contracts/identities";
import { type CapabilityRequirements } from "./capabilities.ts";
import { engineeringSkillIds } from "./engineering-skills.ts";
import type { StaticProfile } from "./contracts.ts";

export const managedRoles = ["supervisor", "explore", "apply", "review", "research"] as const;
export type ManagedRole = (typeof managedRoles)[number];
const reading = ["read", "glob", "grep", "list", "skill"];
const reporting = [
  "abra_worker_question",
  "abra_worker_progress",
  "abra_worker_wait",
  "abra_worker_reply",
];
const editing = ["edit", "write", "patch"];
const policies = {
  supervisor: { tools: [...reading, "abra_*"], write_scope: "none" },
  explore: {
    tools: [...reading, ...reporting, "abra_mermaid_verify", "abra_spec", ...editing, "shell"],
    write_scope: "assigned-change",
    shell_commands: ["agent-browser", "agent-browser *"],
  },
  apply: {
    tools: [
      ...reading,
      ...reporting,
      "abra_mermaid_verify",
      "abra_spec",
      ...editing,
      "bash",
      "shell",
    ],
    write_scope: "owned-worktree",
    shell_commands: ["*"],
  },
  review: {
    tools: [
      ...reading,
      ...reporting,
      "abra_mermaid_verify",
      "abra_spec",
      "abra_review_report",
      "abra_review_changes",
      "shell",
    ],
    write_scope: "none",
    shell_commands: ["agent-browser", "agent-browser *"],
  },
  research: {
    tools: [...reading, ...reporting, "abra_mermaid_verify", "abra_research_report", "shell"],
    write_scope: "none",
    shell_commands: ["agent-browser", "agent-browser *"],
  },
} as const;
export const rolePolicy = (role: ManagedRole) => policies[role];
export const policyAllows = (role: ManagedRole, tool: string) =>
  policies[role].tools.some(
    (name) => name === tool || (name === "abra_*" && tool.startsWith("abra_")),
  );
/** Authored denials support exact actions and prefix wildcards; reject other shapes at preparation. */
export const validDenial = (action: string) => /^(?:\*|[a-z][a-z0-9_-]*\*?)$/.test(action);
const matchesAction = (pattern: string, action: string) =>
  pattern === "*" ||
  (pattern.endsWith("*") ? action.startsWith(pattern.slice(0, -1)) : pattern === action);
export const definitionAllows = (profile: StaticProfile | undefined, tool: string) =>
  // Ignore only the baseline FIRST deny-all rule, not additional authored wildcard denials.
  !profile?.permissions
    .slice(1)
    .some(
      (p) =>
        p.effect === "deny" &&
        (matchesAction(p.action, tool) ||
          (editing.includes(tool) && matchesAction(p.action, "edit"))),
    );
export const contributionAllows = (profile: StaticProfile | undefined, role: Role, tool: string) =>
  profile?.role === role &&
  profile.contributions.some(
    (t) =>
      t.id === tool &&
      t.action === "read" &&
      policyAllows(role, t.action) &&
      definitionAllows(profile, t.id) &&
      definitionAllows(profile, t.action),
  );
export const permittedTools = (role: Role) =>
  new Set(policies[role].tools.map((name) => ToolName.make(name)));
export const policyIdentity = (role: ManagedRole) =>
  createHash("sha256")
    .update(JSON.stringify({ version: 2, role, ...policies[role] }))
    .digest("hex");
// Existing Review sessions retain the original, narrower permission set and policy digest.
const formerReviewPolicy = {
  ...policies.review,
  tools: policies.review.tools.filter((name) => name !== "abra_review_changes"),
};
const formerReviewIdentity = createHash("sha256")
  .update(JSON.stringify({ version: 2, role: "review", ...formerReviewPolicy }))
  .digest("hex");
export const legacyReviewProfile = (profile?: StaticProfile) =>
  profile?.role === "review" &&
  !profile.permissions.some((p) => p.action === "abra_review_changes" && p.effect === "allow");
export const compatiblePolicy = (role: ManagedRole, hash: string) =>
  hash === policyIdentity(role) || (role === "review" && hash === formerReviewIdentity);
export const protectedControlPath = (file: string, root: string, role: Role) => {
  const segments = relative(root, file).split(sep);
  return (
    segments.includes(".git") ||
    segments.includes(".opencode") ||
    (role !== "apply" && basename(file) === "AGENTS.md")
  );
};
export function nativePermissions(
  role: ManagedRole,
  change = "*",
  readRoots: readonly string[] = [],
) {
  const policy = rolePolicy(role);
  const rules: Agent.Info["permissions"][number][] = [
    { action: "*", resource: "*", effect: "deny" },
  ];
  for (const action of new Set(policy.tools.filter((tool) => !editing.includes(tool)))) {
    const resources =
      action === "shell" && "shell_commands" in policy ? policy.shell_commands : ["*"];
    for (const resource of resources) rules.push({ action, resource, effect: "allow" });
  }
  for (const root of readRoots)
    rules.push({ action: "external_directory", resource: `${root}/**`, effect: "allow" });
  if (policy.write_scope !== "none")
    rules.push({
      action: "edit",
      resource: policy.write_scope === "assigned-change" ? `openspec/changes/${change}/**` : "**",
      effect: "allow",
    });
  return rules;
}
export const leadPermissions = (): Agent.Info["permissions"] => [
  { action: "*", resource: "*", effect: "deny" },
  { action: "abra_lead_action", resource: "*", effect: "allow" },
];
export const leadAllows = (tool: string) =>
  leadPermissions().some((rule) => rule.action === tool && rule.effect === "allow");

export function capabilityRequirements(
  role: Role,
  workflow: Policy,
  configured: CapabilityRequirements = {},
  delegate = true,
) {
  const tools = ["read", "glob", "grep", "skill", ...reporting].map((name) => ({
    any_of: [ToolName.make(name)],
  }));
  if (workflow === "full-openspec") tools.push({ any_of: [ToolName.make("abra_spec")] });
  if (role === "explore" || role === "apply")
    tools.push({ any_of: editing.map((name) => ToolName.make(name)) });
  if (role === "apply") tools.push({ any_of: [ToolName.make("bash"), ToolName.make("shell")] });
  else if (configured.required_skills?.includes(Skill.ID.make("abra-browser")))
    tools.push({ any_of: [ToolName.make("shell")] });
  if (role === "review") tools.push({ any_of: [ToolName.make("abra_review_report")] });
  if (role === "review" && delegate) tools.push({ any_of: [ToolName.make("abra_review_changes")] });
  if (role === "research") tools.push({ any_of: [ToolName.make("abra_research_report")] });
  const configuredTools = configured.required_tools ?? [];
  const forbidden = configuredTools
    .flatMap((group) => group.any_of)
    .find((tool) => !policyAllows(role, tool));
  if (forbidden)
    throw new AgentDefinitionError({
      code: "CAPABILITY_POLICY",
      definition: role,
      message: `workers.${role}.required_tools: ${forbidden} is forbidden by ${role} policy; remove the requirement, not the restriction`,
    });
  const groups = [
    ...tools.map((group) => ({ ...group, source: "role-policy" })),
    ...configuredTools.map((group) => ({
      any_of: [...new Set(group.any_of)].sort(),
      source: `workers.${role}.required_tools`,
    })),
  ];
  const skills = [
    ...new Set([
      ...(workflow === "full-openspec" ? [Skill.ID.make("abra-openspec-execution")] : []),
      ...engineeringSkillIds(role, workflow),
      ...(role === "review" && delegate ? [Skill.ID.make("abra-open-code-review-delegate")] : []),
      ...(configured.required_skills ?? []),
    ]),
  ];
  return { tools: groups, skills };
}
