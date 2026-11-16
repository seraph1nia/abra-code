import type { Execution } from "../domain.ts";
import { diagnosticText } from "../opencode/diagnostics.ts";

/** The same retained execution has one explanation in fleet and selected views. */
export function executionBlocker(e: Execution) {
  return e.current_phase === "interrupted"
    ? "Execution is paused; explicit resume is required"
    : e.error_or_recovery_reason &&
        ["failed", "blocked", "recovery_required"].includes(e.current_phase)
      ? `Execution is ${e.current_phase}: ${diagnosticText(e.error_or_recovery_reason)}`
      : e.capacity_wait
        ? `Execution is waiting for ${e.capacity_wait.role} capacity`
        : e.active_role
          ? `${e.active_role} execution is already assigned; inspect native activity`
          : `Existing execution is ${e.current_phase}${e.error_or_recovery_reason ? `: ${diagnosticText(e.error_or_recovery_reason)}` : "; inspect its retained obligations"}`;
}
