import type { WorkSummary } from "@abracode/contracts/visibility/work-summary";
import type { WorkProps } from "@abracode/contracts/web/catalog";
import type { BindingCoverage } from "@abracode/contracts/web/bindings";

export type WorkBinding = {
  work: readonly WorkSummary[];
  captured: readonly WorkSummary[];
  capturedAt: string;
  liveCoverage?: BindingCoverage;
  capturedCoverage?: BindingCoverage;
  frozen?: boolean;
};
/** The binding adapter is shared by app surfaces and immutable document viewers. */
export function bindWork(props: WorkProps<"WorkTable">, binding: WorkBinding) {
  const snapshot = props.mode === "snapshot";
  const source = snapshot ? binding.captured : binding.work;
  const matching = source.filter(
    (work) => !props.issueIds || props.issueIds.includes(work.issue_id),
  );
  const selected = matching.slice(0, 100);
  const coverage = snapshot ? binding.capturedCoverage : binding.liveCoverage;
  const requested = props.issueIds ? [...new Set(props.issueIds)] : undefined;
  const missing =
    requested?.filter(
      (id) =>
        !matching.some((work) => work.issue_id === id) || coverage?.unavailable_ids.includes(id),
    ) ?? [];
  const status = !coverage
    ? "unknown"
    : coverage.status === "unavailable" && requested && !missing.length
      ? "observed"
      : coverage.status;
  const incomplete =
    status !== "observed" ||
    missing.length > 0 ||
    (!requested && (coverage?.truncated || coverage?.total === undefined));
  const total = requested?.length ?? coverage?.total ?? matching.length;
  const detail =
    status === "unknown"
      ? "Coverage unknown"
      : status === "pending"
        ? "Pending data"
        : status === "stale"
          ? "Stale data"
          : missing.length || status === "unavailable"
            ? "Unavailable requested data"
            : incomplete
              ? "Partial data"
              : "Complete selection";
  const origin = binding.frozen
    ? `Saved ${snapshot ? "snapshot" : "live"} binding · ${new Date(binding.capturedAt).toLocaleString()}`
    : snapshot
      ? `Snapshot · ${new Date(binding.capturedAt).toLocaleString()}`
      : "Live work graph";
  return { selected, total, incomplete, label: `${origin} · ${detail}` };
}
