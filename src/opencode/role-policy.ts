import { createHash } from "node:crypto";
import { basename, relative, sep } from "node:path";
import { Effect } from "effect";
import { type Agent } from "@opencode/schema/agent";
import { Skill } from "@opencode/schema/skill";
import { type Context } from "@opencode/plugin/effect/plugin";
import { CrewError, type Role, type Policy } from "../domain.ts";
import { ToolName } from "../identities.ts";
import { type CapabilityRequirements } from "./capability-contracts.ts";

export const managedRoles = ["supervisor", "explore", "apply", "review", "research"] as const;
type ManagedRole = (typeof managedRoles)[number];
const reading = ["read", "glob", "grep", "list", "skill"];
const reporting = ["abra_worker_question", "abra_worker_progress", "abra_worker_wait"];
const editing = ["edit", "write", "patch"];
const policies = {
  supervisor: { tools: [...reading, "abra_*"], write_scope: "none" },
  explore: {
    tools: [...reading, ...reporting, "abra_spec", ...editing, "shell"],
    write_scope: "assigned-change",
    shell_commands: ["agent-browser", "agent-browser *"],
  },
  apply: {
    tools: [...reading, ...reporting, "abra_spec", ...editing, "bash", "shell"],
    write_scope: "owned-worktree",
    shell_commands: ["*"],
  },
  review: {
    tools: [...reading, ...reporting, "abra_spec", "abra_review_report", "shell"],
    write_scope: "none",
    shell_commands: ["agent-browser", "agent-browser *"],
  },
  research: {
    tools: [...reading, ...reporting, "abra_research_report", "shell"],
    write_scope: "none",
    shell_commands: ["agent-browser", "agent-browser *"],
  },
} as const;
export const rolePolicy = (role: ManagedRole) => policies[role];
export const policyAllows = (role: ManagedRole, tool: string) =>
  policies[role].tools.some(
    (name) => name === tool || (name === "abra_*" && tool.startsWith("abra_")),
  );
export const permittedTools = (role: Role) =>
  new Set(policies[role].tools.map((name) => ToolName.make(name)));
export const policyIdentity = (role: ManagedRole) =>
  createHash("sha256")
    .update(JSON.stringify({ version: 1, role, ...policies[role] }))
    .digest("hex");
export const protectedControlPath = (file: string, root: string) => {
  const segments = relative(root, file).split(sep);
  return (
    segments.includes(".git") || segments.includes(".opencode") || basename(file) === "AGENTS.md"
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
export const installRoleProfiles = (ctx: Context, central: boolean) =>
  central
    ? ctx.agent.transform((editor) => {
        editor.default("abra");
        for (const agent of editor.list())
          if (agent.id !== "abra")
            editor.update(agent.id, (item) => {
              item.hidden = true;
            });
        for (const role of managedRoles)
          editor.update(role === "supervisor" ? "abra" : role, (agent) => {
            agent.permissions = nativePermissions(role);
          });
      })
    : Effect.void;

export function capabilityRequirements(
  role: Role,
  workflow: Policy,
  configured: CapabilityRequirements = {},
) {
  const tools = ["read", "glob", "grep", "skill", ...reporting].map((name) => ({
    any_of: [ToolName.make(name)],
  }));
  if (workflow === "full-openspec") tools.push({ any_of: [ToolName.make("abra_spec")] });
  if (role === "explore" || role === "apply")
    tools.push({ any_of: editing.map((name) => ToolName.make(name)) });
  if (role === "apply") tools.push({ any_of: [ToolName.make("bash"), ToolName.make("shell")] });
  else tools.push({ any_of: [ToolName.make("shell")] });
  if (role === "review") tools.push({ any_of: [ToolName.make("abra_review_report")] });
  if (role === "research") tools.push({ any_of: [ToolName.make("abra_research_report")] });
  const configuredTools = configured.required_tools ?? [];
  const forbidden = configuredTools
    .flatMap((group) => group.any_of)
    .find((tool) => !policyAllows(role, tool));
  if (forbidden)
    throw new CrewError(
      "CAPABILITY_POLICY",
      `workers.${role}.required_tools: ${forbidden} is forbidden by ${role} policy; remove the requirement, not the restriction`,
    );
  const groups = [
    ...tools.map((group) => ({ ...group, source: "role-policy" })),
    ...configuredTools.map((group) => ({
      any_of: [...new Set(group.any_of)].sort(),
      source: `workers.${role}.required_tools`,
    })),
  ];
  const skills = [
    ...new Set([
      Skill.ID.make("abra-browser"),
      ...(workflow === "full-openspec" ? [Skill.ID.make("abra-openspec-execution")] : []),
      ...(configured.required_skills ?? []),
    ]),
  ];
  return { tools: groups, skills };
}
