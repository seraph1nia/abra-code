import { Schema } from "effect";
import { Skill } from "@opencode/schema/skill";
import { ToolName } from "../identities.ts";

export const RequiredToolSchema = Schema.Struct({
  any_of: Schema.Array(ToolName.check(Schema.isMaxLength(128))).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(16),
  ),
});
export const CapabilityFields = {
  required_skills: Schema.optional(
    Schema.Array(Skill.ID.check(Schema.isMinLength(1), Schema.isMaxLength(128))).check(
      Schema.isMaxLength(32),
    ),
  ),
  required_tools: Schema.optional(Schema.Array(RequiredToolSchema).check(Schema.isMaxLength(32))),
};
export const CapabilityRequirementsSchema = Schema.Struct(CapabilityFields);
export type CapabilityRequirements = typeof CapabilityRequirementsSchema.Type;
