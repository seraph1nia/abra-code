import { createHash } from "node:crypto";
import { Effect, Schema } from "effect";
import { Agent } from "@opencode/schema/agent";
import { Skill } from "@opencode/schema/skill";
import { AbsolutePath, Timestamp, ToolName } from "../identities.ts";
import { WorkerModelSchema } from "../contracts.ts";
import { CrewError, type Role, type Policy } from "../domain.ts";
import { type CapabilityRequirements } from "./capability-contracts.ts";
import { capabilityRequirements } from "./role-policy.ts";

export const digestText = (text: string) => createHash("sha256").update(text).digest("hex");
export const ToolGroupSchema = Schema.Struct({
  any_of: Schema.Array(ToolName),
  source: Schema.String,
});
export const SkillResolutionSchema = Schema.Struct({
  id: Skill.ID,
  path: AbsolutePath,
  digest: Schema.String,
  source: Schema.String,
  loading: Schema.Literal("unobserved"),
});
export const WorkerEnvironmentSchema = Schema.Struct({
  agent: Agent.ID,
  model: WorkerModelSchema,
  tools: Schema.Array(ToolGroupSchema),
  skills: Schema.Array(SkillResolutionSchema),
});
export type WorkerEnvironment = typeof WorkerEnvironmentSchema.Type;
export const ToolObservationSchema = Schema.Struct({
  model: WorkerModelSchema,
  names: Schema.Array(ToolName).check(Schema.isMaxLength(128)),
  at: Timestamp,
  missing: Schema.Array(ToolGroupSchema).check(Schema.isMaxLength(64)),
});
export function resolveSkills(
  role: Role,
  workflow: Policy,
  configured: CapabilityRequirements | undefined,
  inventory: readonly Skill.Info[],
  directory: string,
) {
  const required = capabilityRequirements(role, workflow, configured);
  return resolveRequirementSkills(
    role,
    required.skills.map((id) => ({
      id,
      source: configured?.required_skills?.includes(id)
        ? `workers.${role}.required_skills`
        : "role-policy",
    })),
    required.tools,
    inventory,
    directory,
  );
}

/** Retained admissions validate their captured requirements, never today's defaults. */
export function resolveCapturedSkills(
  role: Role,
  environment: WorkerEnvironment,
  inventory: readonly Skill.Info[],
  directory: string,
) {
  return resolveRequirementSkills(
    role,
    environment.skills,
    environment.tools,
    inventory,
    directory,
  ).pipe(Effect.as({ tools: environment.tools, skills: environment.skills }));
}

function resolveRequirementSkills(
  role: Role,
  required: readonly { id: Skill.ID; source: string }[],
  tools: WorkerEnvironment["tools"],
  inventory: readonly Skill.Info[],
  directory: string,
) {
  return Effect.gen(function* () {
    const skills: (typeof SkillResolutionSchema.Type)[] = [];
    for (const { id, source } of required) {
      const matches = inventory.filter((skill) => skill.id === id);
      const skill = matches[0];
      if (matches.length !== 1 || !skill?.content.trim() || !skill.path)
        return yield* new CrewError(
          "SKILL_UNAVAILABLE",
          `${role} at ${directory}: required skill ${id} (${source}) is missing, ambiguous or unusable (matches: ${matches.length}, available: ${inventory
            .map((entry) => entry.id)
            .join(",")
            .slice(
              0,
              512,
            )}); configure native discovery at this worktree or repair its registered content`,
        );
      skills.push({
        id,
        path: skill.path,
        digest: digestText(skill.content),
        source,
        loading: "unobserved",
      });
    }
    return { tools, skills };
  });
}
export function missingTools(
  groups: readonly (typeof ToolGroupSchema.Type)[],
  names: readonly string[],
) {
  const available = new Set(names);
  return groups.filter((group) => !group.any_of.some((name) => available.has(name)));
}

/** Registry reads do not await cold-location activation in the pinned native server. */
export function awaitWorkerPlugin(
  inventory: Effect.Effect<
    readonly Pick<import("@opencode/schema/plugin").Plugin.Info, "id" | "state">[],
    CrewError
  >,
  attempts = 50,
  delay = 100,
) {
  return Effect.gen(function* () {
    for (let attempt = 0; attempt < attempts; attempt++) {
      const plugins = yield* inventory;
      const crew = plugins.find((plugin) => plugin.id === "abracode");
      if (crew?.state.status === "active") return;
      if (crew?.state.status === "failed")
        return yield* new CrewError(
          "WORKER_PLUGIN_FAILED",
          "AbraCode activation failed at the worker location; repair its native plugin configuration before retrying",
        );
      if (attempt + 1 < attempts) yield* Effect.sleep(delay);
    }
    return yield* new CrewError(
      "INVENTORY_UNAVAILABLE",
      "Worker-location AbraCode activation has not settled; retain admission intent and retry after initialization",
    );
  });
}
