import { Agents } from "@abracode/agents";
import type { AgentCatalog } from "@abracode/contracts/web/agent-settings";
import { Effect } from "effect";

/** Use the injected catalog without resolving sources or preparing task context. */
export const readAgentCatalog = Effect.gen(function* () {
  const catalog = yield* Agents;
  const definitions = yield* catalog.list;
  return {
    agents: definitions.map((definition) => ({
      id: definition.id,
      revision: definition.revision,
      description: definition.description,
      mode: definition.mode,
      roles: [...definition.roles],
      ...(definition.model ? { model: definition.model } : {}),
      instructions: definition.instructions.map((source) =>
        "file" in source
          ? { kind: "file" as const, path: source.file }
          : { kind: "inline" as const, content: source.inline },
      ),
      ...(definition.tools ? { tools: [...definition.tools] } : {}),
      customTools: (definition.customTools ?? []).map(({ id, revision }) => ({ id, revision })),
      skills: (definition.skills ?? []).map(({ name, preload }) => ({ name, preload: !!preload })),
      requiredSkills: [...(definition.requirements?.required_skills ?? [])],
      requiredTools: (definition.requirements?.required_tools ?? []).map(({ any_of }) => [
        ...any_of,
      ]),
      deny: [...(definition.deny ?? [])],
      dynamicContext: typeof definition.context === "function",
    })),
  } satisfies AgentCatalog;
});
