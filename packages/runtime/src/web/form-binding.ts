import type { Form } from "@opencode/schema/form";
import type { CheckpointSchema } from "@abracode/contracts/web/workspace-wire";
/** A current controller observation and the exact native metadata must agree. */
export function checkpointMatchesForm(
  form: Form.Info,
  checkpoint: typeof CheckpointSchema.Type | undefined,
) {
  return (
    !checkpoint ||
    (checkpoint.active &&
      (checkpoint.fingerprint === undefined ||
        checkpoint.fingerprint === form.metadata?.fingerprint) &&
      (checkpoint.identity === undefined ||
        checkpoint.identity === form.metadata?.decision_identity) &&
      checkpoint.design_choices === form.metadata?.design_choices &&
      (checkpoint.finishing_target === undefined ||
        checkpoint.finishing_target === form.metadata?.finishing_target))
  );
}
