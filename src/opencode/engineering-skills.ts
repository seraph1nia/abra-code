import { Skill } from "@opencode/schema/skill";
import { type Policy, type Role } from "../domain.ts";

/** Native registration, new admission prerequisites and conditional prompt guidance share this list. */
export const engineeringSkills = [
  { name: "codebase-design", trigger: "caller interface or ownership decisions" },
  { name: "domain-modeling", trigger: "ambiguous domain terms or scoped vocabulary changes" },
  { name: "diagnosing-bugs", trigger: "difficult in-scope bugs" },
  { name: "verification", trigger: "planning, executing or assessing observable behavioral proof" },
  { name: "blast-radius", trigger: "concrete downstream or persisted-state safety assumptions" },
] as const;

export function roleEngineeringSkills(role: Role, workflow: Policy) {
  if (workflow === "research-only" || role === "research") return [];
  return engineeringSkills.filter(({ name }) =>
    role === "apply"
      ? true
      : role === "explore"
        ? workflow === "full-openspec" && name !== "diagnosing-bugs" && name !== "blast-radius"
        : name === "codebase-design" || name === "verification" || name === "blast-radius",
  );
}

export const engineeringSkillIds = (role: Role, workflow: Policy) =>
  roleEngineeringSkills(role, workflow).map(({ name }) => Skill.ID.make(`abra-${name}`));

export function engineeringGuidance(role: Role, workflow: Policy) {
  const selected = roleEngineeringSkills(role, workflow);
  return selected.length
    ? `Load relevant native skills conditionally: ${selected.map(({ name, trigger }) => `abra-${name} for ${trigger}`).join("; ")}. Availability does not require every procedure on every task or prove it ran. Keep all work within the assigned role and accepted scope.\n`
    : "";
}
