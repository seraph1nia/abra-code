import { Schema } from "effect";
import { Count } from "../primitives.ts";
import {
  IssueId,
  SessionId,
  ObligationKey,
  RequestId,
  ContentHash,
  RelativePath,
} from "../identities.ts";

const exact = { parseOptions: { onExcessProperty: "error" as const }, reportInput: false };
export const TaskSectionSchema = Schema.Literals([
  "summary",
  "plan",
  "changes",
  "activity",
  "reports",
]);
export const ResourcePathSchema = RelativePath.check(
  Schema.makeFilter(
    (path) =>
      (!!path &&
        !path.startsWith("/") &&
        !path.includes("\\") &&
        !Array.from(path).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) &&
        path.split("/").every((part) => part !== ".." && part !== "." && part !== "")) ||
      "Select a safe relative path",
  ),
);
/** These capabilities navigate to evidence; none can invoke tools or answer a form. */
export const ResourceSelectionSchema = Schema.Union([
  Schema.Struct({
    action: Schema.Literal("open_task"),
    issue_id: IssueId,
    section: Schema.optionalKey(TaskSectionSchema),
    activity: Schema.optionalKey(Schema.Literals(["sessions", "communication", "checks", "leads"])),
  })
    .check(
      Schema.makeFilter(
        (target) =>
          !target.activity ||
          target.section === "activity" ||
          "Activity selection requires the activity section",
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
    scope: Schema.optionalKey(Schema.Literals(["all", "uncommitted"])),
  }).annotate(exact),
  Schema.Struct({
    action: Schema.Literal("open_artifact"),
    issue_id: IssueId,
    request_id: RequestId,
    hash: ContentHash,
  }).annotate(exact),
]);
export type ResourceSelection = typeof ResourceSelectionSchema.Type;
