import type { ExecutionContract } from "../../../../src/visibility/execution-contract.ts";
import { Evidence } from "./cards.tsx";

export function ExecutionContractSummary({ contract }: { contract: ExecutionContract }) {
  const schema = contract.schema;
  return (
    <section aria-label="Planning and repair contract">
      <h3>Planning and repair</h3>
      <p>
        {schema.state === "bound"
          ? `Schema ${schema.name} · ${schema.source} · ${schema.selection_source === "task" ? "selected for this task" : "captured repository default"}`
          : schema.state === "pending"
            ? "Schema selection is pending provisioning."
            : schema.state === "unavailable"
              ? "Original schema provenance is unavailable for this legacy execution."
              : "This workflow does not use OpenSpec planning."}
      </p>
      <p>
        Human plan approval {contract.plan_approval.required ? "required" : "not required"}
        {` · ${contract.plan_approval.source === "unavailable" ? "original policy source unavailable" : contract.plan_approval.source.replaceAll("_", " ")}`}
      </p>
      <p>
        Automatic repair: {contract.repair.consumed} consumed · {contract.repair.remaining}{" "}
        remaining
        {contract.repair.allowance !== contract.repair.configured &&
          " · disabled by manual supervision"}
      </p>
      {schema.state === "bound" && (
        <Evidence>
          <p>
            {schema.file_count} retained schema inputs · content digest <code>{schema.hash}</code>
          </p>
          <p>
            Retained evidence describes the admitted contract; it does not grant approval or confirm
            current input availability.
          </p>
        </Evidence>
      )}
    </section>
  );
}
