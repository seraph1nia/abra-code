import type { Controller } from "../../workflow/controller.ts";
import { LeadActionSchema, LeadControlSchema } from "../../workflow/leads/contracts.ts";
import { toolOutputs } from "../tool-contracts.ts";
import { defineTool as define, type DefinedTool } from "../tool-definition.ts";

export function leadTools(c: Controller): DefinedTool[] {
  return [
    define({
      name: "lead_control",
      description:
        "Abra-only registration, revision, scoped requests and acceptance of project-lead proposals. Inspect status before changing a registration.",
      input: LeadControlSchema,
      output: toolOutputs.lead_control,
      runJson: (a, s) => c.lead().control(s, a),
    }),
    define({
      name: "lead_action",
      description:
        "Registered project-lead scoped status, proposals, correlated replies, supervisor-owned answers and retained finding forwarding. No execution or approval authority.",
      access: "lead",
      input: LeadActionSchema,
      output: toolOutputs.lead_action,
      runJson: (a, s) => c.lead().action(s, a),
    }),
  ];
}
