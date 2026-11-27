import { Schema } from "effect";
import { Commit, NonEmpty, Count, Positive, exactParseOptions as exact } from "../primitives.ts";
import {
  FindingId,
  IssueId,
  SessionId,
  ObligationKey,
  RequestId,
  ContentHash,
  SafeRelativePath,
} from "../identities.ts";

export const TaskSectionSchema = Schema.Literals([
  "summary",
  "plan",
  "changes",
  "verification",
  "activity",
  "reports",
]);
export const ResourcePathSchema = SafeRelativePath;
export const DiffSelectionSchema = Schema.Struct({
  kind: Schema.Literal("diff"),
  issue_id: IssueId,
  file: ResourcePathSchema,
  scope: Schema.Literals(["all", "uncommitted"]),
  patch_id: ContentHash,
  side: Schema.Literals(["additions", "deletions"]),
  start: Positive,
  end: Positive,
}).check(Schema.makeFilter((s) => s.end >= s.start || "Selection ends before it starts"));
export type DiffSelection = typeof DiffSelectionSchema.Type;
export const PlanSelectionSchema = Schema.Struct({
  kind: Schema.Literal("plan"),
  issue_id: IssueId,
  file: ResourcePathSchema,
  generation: Count,
  hash: ContentHash,
  start: Positive,
  end: Positive,
}).check(Schema.makeFilter((s) => s.end >= s.start || "Selection ends before it starts"));
export const RegionSelectionSchema = Schema.Struct({
  kind: Schema.Literal("region"),
  issue_id: IssueId,
  request_id: RequestId,
  hash: ContentHash,
  x: Count,
  y: Count,
  width: Positive,
  height: Positive,
});
export type RegionSelection = typeof RegionSelectionSchema.Type;
export function withinImage(
  region: Pick<RegionSelection, "x" | "y" | "width" | "height">,
  width: number,
  height: number,
) {
  return (
    [region.x, region.y, region.width, region.height].every(Number.isSafeInteger) &&
    region.x >= 0 &&
    region.y >= 0 &&
    region.width > 0 &&
    region.height > 0 &&
    region.x + region.width <= width &&
    region.y + region.height <= height
  );
}
export const WorkSelectionSchema = Schema.Union([
  DiffSelectionSchema,
  PlanSelectionSchema,
  RegionSelectionSchema,
]);
export type WorkSelection = typeof WorkSelectionSchema.Type;
export function selectionLabel(s: WorkSelection) {
  if (s.kind === "region")
    return "Image " + s.request_id + " · " + s.width + "×" + s.height + " at " + s.x + ", " + s.y;
  return s.file + " · " + (s.kind === "diff" ? s.side : "plan lines") + " " + s.start + "–" + s.end;
}
export const FilePatchId = Schema.optionalKey(ContentHash);

/** These capabilities navigate to evidence; none can invoke tools or answer a form. */
export const ResourceSelectionSchema = Schema.Union([
  Schema.Struct({
    action: Schema.Literal("open_task"),
    issue_id: IssueId,
    section: Schema.optionalKey(TaskSectionSchema),
    request: Schema.optionalKey(Schema.Struct({ request_id: RequestId, offset: Count })),
    activity: Schema.optionalKey(Schema.Literals(["sessions", "communication", "checks", "leads"])),
  })
    .check(
      Schema.makeFilter(
        (target) =>
          (target.request && target.activity !== "communication"
            ? "Request selection requires communication"
            : undefined) ??
          (!target.activity ||
            target.section === "activity" ||
            "Activity selection requires the activity section"),
      ),
    )
    .annotate(exact),
  Schema.Struct({
    action: Schema.Literal("open_session"),
    issue_id: IssueId,
    session_id: SessionId,
  }).annotate(exact),
  Schema.Struct({
    action: Schema.Literal("open_decision"),
    issue_id: IssueId,
    key: ObligationKey,
    generation: Count,
  }).annotate(exact),
  Schema.Struct({
    action: Schema.Literal("open_changes"),
    issue_id: IssueId,
    file: Schema.optionalKey(ResourcePathSchema),
    head: Schema.optionalKey(Commit),
    scope: Schema.optionalKey(Schema.Literals(["all", "uncommitted"])),
  }).annotate(exact),
  Schema.Struct({
    action: Schema.Literal("open_finding"),
    issue_id: IssueId,
    finding_id: FindingId,
    revision: NonEmpty,
  }).annotate(exact),
  Schema.Struct({
    action: Schema.Literal("open_passage"),
    issue_id: IssueId,
    file: ResourcePathSchema,
    generation: Count,
    hash: ContentHash,
    start: Positive,
    end: Positive,
  })
    .check(Schema.makeFilter((s) => s.end >= s.start || "Invalid passage range"))
    .annotate(exact),
  Schema.Struct({
    action: Schema.Literal("open_artifact"),
    issue_id: IssueId,
    request_id: RequestId,
    hash: ContentHash,
  }).annotate(exact),
]);
export type ResourceSelection = typeof ResourceSelectionSchema.Type;
