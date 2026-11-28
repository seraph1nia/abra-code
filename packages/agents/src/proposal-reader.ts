import type { Agent } from "@opencode/schema/agent";

export const proposalReader = "proposal-reader";
export const readerInstructions = [
  "Read the supplied proposal as an independent reader. First explain its goal, boundaries and observable success from the text alone. Then you may read cited project sources to check material assumptions.",
  "Return a JSON object with reading (your interpretation) and findings (an array). Each finding has owner (planner for editorial feedback, human for a scope decision), question (feedback or a question), and evidence (a cited passage, source or concrete contradictory scenario). Use up to 16 findings and at most 2048 characters per text field. An empty array is a complete clean review.",
].join("\n");
export const readerPermissions = (): Agent.Info["permissions"] => [
  { action: "*", resource: "*", effect: "deny" },
  { action: "read", resource: "*", effect: "allow" },
];
