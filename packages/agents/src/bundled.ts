import { Effect, Layer } from "effect";
import {
  Agents,
  AgentSources,
  agentLayer,
  makeAgent,
  makeCatalog,
  type AgentDefinition,
} from "./index.ts";
import { engineeringSkills } from "./engineering-skills.ts";
import { fileURLToPath } from "node:url";
import { rolePolicy, memoryReadTools } from "./policy.ts";
export const bundledAssets = fileURLToPath(new URL("../assets", import.meta.url));
export const bundledSkills = fileURLToPath(new URL("../assets/skills", import.meta.url));
const worker = (
  id: "explore" | "apply" | "review" | "research",
  description: string,
): AgentDefinition => ({
  id,
  revision: "1",
  description,
  mode: "subagent",
  roles: [id],
  instructions: [{ file: `${id}.md` }],
  tools: [...rolePolicy(id).tools, ...memoryReadTools],
  skills: [
    ...(id === "review" || id === "research"
      ? [{ name: "open-code-review-delegate", preload: id === "review" }]
      : []),
    { name: "openspec-execution" },
    { name: "browser" },
    { name: "memory" },
    ...engineeringSkills.map(({ name }) => ({ name })),
  ],
});
export const definitions: readonly AgentDefinition[] = [
  {
    id: "abra",
    revision: "1",
    description: "Abra, your AbraCode supervisor",
    mode: "primary",
    roles: ["supervisor"],
    instructions: [{ file: "abra.md" }],
    tools: rolePolicy("supervisor").tools,
    skills: [
      "thoughts",
      "memory",
      "express",
      "orchestration",
      "project-onboarding",
      "recovery",
      "openspec-execution",
      "browser",
    ].map((name) => ({ name })),
  },
  worker("explore", "Investigate one issue and prepare its repository-local OpenSpec plan"),
  worker(
    "apply",
    "Implement one approved full-spec or lightweight change in its existing issue worktree",
  ),
  worker("review", "Independently review implementation against the approved specification"),
  worker(
    "research",
    "Investigate a scoped question read-only and submit an independently retained report",
  ),
  {
    id: "project-lead",
    revision: "1",
    description: "Scoped AbraCode project lead",
    mode: "subagent",
    roles: ["project-lead"],
    instructions: [
      {
        inline:
          "You are a controller-managed project lead. Use only abra_lead_action at the retained registration revision. For prior decisions use memory_search or memory_read with one assigned repository and your registration revision. Send candidate lessons to Abra. Propose scoped tasks and report evidence. Never approve, start workers, modify code or deliver work.",
      },
    ],
    tools: ["abra_lead_action"],
  },
];
export const AbraLive = agentLayer(definitions[0]);
export const ExploreLive = agentLayer(definitions[1]);
export const ApplyLive = agentLayer(definitions[2]);
export const ReviewLive = agentLayer(definitions[3]);
export const ResearchLive = agentLayer(definitions[4]);
export const ProjectLeadLive = agentLayer(definitions[5]);
export const bundledCatalog = Effect.forEach(definitions, makeAgent).pipe(
  Effect.flatMap(makeCatalog),
);
export const AgentsLive = Layer.effect(Agents, bundledCatalog);
export const sourcesLayer = (skills = bundledSkills, assets = bundledAssets) =>
  Layer.succeed(AgentSources, { assets, skills });
