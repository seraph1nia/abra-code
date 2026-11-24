import { Schema } from "effect";
import { IssueId, RepositoryId } from "../identities.ts";
import { WorkSummarySchema } from "../visibility/work-summary.ts";
import { CapacityUsageSchema } from "../visibility/discovery-contracts.ts";
import { Count, PhaseSchema, exactParseOptions } from "../primitives.ts";
import type { WorkSurface } from "./surfaces.ts";

export const maximumBindingRows = 100;
const ids = Schema.Array(IssueId).check(Schema.isMaxLength(maximumBindingRows));
/** Retained coverage describes captured bytes; transient freshness belongs to current reads. */
export const BindingCoverageSchema = Schema.Struct({
  population: Schema.Literal("retained-work"),
  requested_ids: ids,
  returned: Count,
  total: Schema.optionalKey(Count),
  unavailable_ids: ids,
  truncated: Schema.Boolean,
  status: Schema.Literals(["observed", "pending", "stale", "unavailable", "unknown"]),
});
export type BindingCoverage = typeof BindingCoverageSchema.Type;
export type BindingMode = "live" | "snapshot";
export type BindingSelection = { ids: readonly string[]; unfiltered: boolean };
const widgets = new Set([
  "WorkTable",
  "StatusSummary",
  "Kanban",
  "DependencyGraph",
  "Timeline",
  "DecisionSummary",
]);

/** Navigation validates ownership but never changes another widget's selection. */
export function bindingRequirements(surface: WorkSurface, mode?: BindingMode): BindingSelection {
  const selected = new Set<string>();
  let unfiltered = false;
  for (const component of surface.createSurface.components) {
    if (typeof component.component === "string" && widgets.has(component.component)) {
      if (mode && (component.mode ?? "live") !== mode) continue;
      if (component.issueIds === undefined) unfiltered = true;
      else if (Array.isArray(component.issueIds))
        for (const id of component.issueIds) if (typeof id === "string") selected.add(id);
    } else if (!mode || mode === "snapshot") {
      if (component.component === "ReportLink" && typeof component.issueId === "string")
        selected.add(component.issueId);
      if (
        component.component === "ResourceLink" &&
        typeof component.target === "object" &&
        component.target &&
        !Array.isArray(component.target) &&
        "issue_id" in component.target &&
        typeof component.target.issue_id === "string"
      )
        selected.add(component.target.issue_id);
    }
  }
  if (selected.size > maximumBindingRows)
    throw new Error("Explicit binding requirements exceed 100 rows");
  return { ids: [...selected].sort(), unfiltered };
}

/** Reserve explicit identities before filling the bounded, deterministic population. */
export function selectBindingRows<T extends { issue_id: string }>(
  selection: BindingSelection,
  rows: readonly T[],
  total?: number,
): { rows: T[]; coverage: BindingCoverage } {
  const requested = [...new Set(selection.ids)].sort();
  if (requested.length > maximumBindingRows)
    throw new Error("Explicit binding requirements exceed 100 rows");
  const byId = new Map(rows.map((row) => [row.issue_id, row]));
  const explicit = requested.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  const missing = requested.filter((id) => !byId.has(id));
  const selected = new Set(requested);
  const result = [
    ...explicit,
    ...(selection.unfiltered
      ? [...byId.values()]
          .filter((row) => !selected.has(row.issue_id))
          .sort((a, b) => a.issue_id.localeCompare(b.issue_id))
      : []),
  ].slice(0, maximumBindingRows);
  const population = selection.unfiltered ? total : requested.length;
  return {
    rows: result,
    coverage: {
      population: "retained-work",
      requested_ids: requested.map((id) => IssueId.make(id)),
      returned: result.length,
      ...(population === undefined ? {} : { total: population }),
      unavailable_ids: missing.map((id) => IssueId.make(id)),
      truncated: selection.unfiltered && (population === undefined || population > result.length),
      status: missing.length ? "unavailable" : "observed",
    },
  };
}

export const BindingReadQuery = Schema.Struct({
  issue_ids: ids,
  include_population: Schema.optional(Schema.Boolean),
}).annotate(exactParseOptions);
export const BindingReadSchema = Schema.Struct({
  capacity: Schema.optionalKey(
    Schema.Struct({
      ...CapacityUsageSchema.fields,
      auto_schedule: Schema.Boolean,
      setup_count: Count,
      setups: Schema.Array(
        Schema.Struct({
          repository_id: RepositoryId,
          phase: Schema.Union([PhaseSchema, Schema.Literal("unrequested")]),
        }),
      ).check(Schema.isMaxLength(10)),
    }),
  ),
  work: Schema.Array(WorkSummarySchema).check(Schema.isMaxLength(maximumBindingRows)),
  coverage: BindingCoverageSchema,
  results: Schema.Array(
    Schema.Struct({
      issue_id: IssueId,
      status: Schema.Literals(["available", "missing", "unavailable"]),
    }),
  ).check(Schema.isMaxLength(maximumBindingRows)),
  observed_at: Schema.String,
  work_revision: Schema.optionalKey(Schema.String),
});
export type BindingRead = typeof BindingReadSchema.Type;
