import { Schema } from "effect";
import { Count } from "../contracts.ts";
import { PlanApprovalSource } from "../config/policy.ts";
import { BoundSchema } from "../openspec/schema-contracts.ts";
import { type Config, type Execution } from "../domain.ts";

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
/** Retained contract evidence only; observing it never validates or grants an admission. */
export function executionContract(
  e: Execution,
  mode: Config["supervision_mode"],
): ExecutionContract {
  const binding = e.openspec_schema_binding;
  const configured = e.effective_policy.repair_rounds;
  const allowance = mode === "manual" ? 0 : configured;
  const consumed = e.rounds?.length ?? 0;
  return {
    schema:
      e.workflow_policy !== "full-openspec"
        ? { state: "not_applicable" }
        : !binding
          ? { state: "unavailable", reason: "legacy_record" }
          : binding.state === "pending"
            ? { state: "pending", selection_source: binding.selection_source }
            : {
                state: "bound",
                name: binding.name,
                source: binding.source,
                selection_source: binding.selection_source,
                hash: binding.hash,
                file_count: binding.files.length,
              },
    plan_approval: {
      required: e.plan_approval_required,
      source: e.effective_policy.plan_approval_source ?? "unavailable",
    },
    repair: { configured, allowance, consumed, remaining: Math.max(0, allowance - consumed) },
  };
}
