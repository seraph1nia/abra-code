import { type Config, type Execution } from "../../domain.ts";
import type { ExecutionContract } from "@abracode/contracts/visibility/execution-contract";
export * from "@abracode/contracts/visibility/execution-contract";
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
