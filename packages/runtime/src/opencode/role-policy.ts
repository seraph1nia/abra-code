export * from "@abracode/agents/policy";
import { capabilityRequirements as requirements } from "@abracode/agents/policy";
import { AgentDefinitionError } from "@abracode/agents";
import { CrewError } from "../domain.ts";
/** Preserve the existing synchronous domain boundary; policy itself has one package owner. */
export const capabilityRequirements = (...args: Parameters<typeof requirements>) => {
  try {
    return requirements(...args);
  } catch (error) {
    if (error instanceof AgentDefinitionError) throw CrewError.from(error);
    throw error;
  }
};
