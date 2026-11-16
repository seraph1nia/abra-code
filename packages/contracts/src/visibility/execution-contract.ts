import { Schema } from "effect";
import { Count } from "../primitives.ts";
import { PlanApprovalSource } from "../config/policy.ts";
import { BoundSchema } from "../openspec/schema-contracts.ts";

const schema = Schema.Union([
  Schema.Struct({ state: Schema.Literal("not_applicable") }),
  Schema.Struct({ state: Schema.Literal("unavailable"), reason: Schema.Literal("legacy_record") }),
  Schema.Struct({
    state: Schema.Literal("pending"),
    selection_source: BoundSchema.fields.selection_source,
  }),
  Schema.Struct({
    state: Schema.Literal("bound"),
    name: BoundSchema.fields.name,
    source: BoundSchema.fields.source,
    selection_source: BoundSchema.fields.selection_source,
    hash: BoundSchema.fields.hash,
    file_count: Count,
  }),
]);
export const ExecutionContractSchema = Schema.Struct({
  schema,
  plan_approval: Schema.Struct({
    required: Schema.Boolean,
    source: Schema.Union([PlanApprovalSource, Schema.Literal("unavailable")]),
  }),
  repair: Schema.Struct({
    configured: Count,
    allowance: Count,
    consumed: Count,
    remaining: Count,
  }),
});
export type ExecutionContract = typeof ExecutionContractSchema.Type;
