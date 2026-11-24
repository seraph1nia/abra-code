import { ThoughtSource } from "@abracode/contracts/visibility/thoughts";
import { SchemaName } from "@abracode/contracts/openspec/schema-contracts";
import { DispatchSchema, normalizeDispatch } from "../config/dispatch.ts";
import { IssueId, RepositoryId, RequestId, ExecutionId } from "@abracode/contracts/identities";

import { ScopeDraftSchema, ReportReferenceSchema } from "./scope.ts";
import { PolicySchema, Priority, NonEmpty } from "@abracode/contracts/primitives";
import { Schema } from "effect";
import { ensure } from "../domain.ts";
import { decodeSync } from "../decode.ts";

import { QualityProfile } from "../config/policy.ts";

export const OpenSpecWorkFields = {
  openspec_schema: Schema.optional(SchemaName),
  require_plan_approval: Schema.optional(Schema.Literal(true)),
};
export const IssueSchema = Schema.Struct({
  ...OpenSpecWorkFields,
  dispatch: Schema.optional(DispatchSchema),
  quality_profile: Schema.optional(QualityProfile),
  scope: Schema.optional(ScopeDraftSchema),
  report_reference: Schema.optional(ReportReferenceSchema),
  thought_source: Schema.optional(ThoughtSource),
  id: IssueId,
  repository_id: RepositoryId,
  workflow_policy: PolicySchema,
  request_id: RequestId,
  title: Schema.String,
  description: Schema.String,
  status: Schema.Literals(["open", "in_progress", "blocked", "closed"]),
  priority: Priority,
  assignee: Schema.optional(ExecutionId),
  dependencies: Schema.Array(IssueId),
});
export type Issue = typeof IssueSchema.Type;
export const WorkInputSchema = Schema.Struct({
  ...OpenSpecWorkFields,
  dispatch: Schema.optional(DispatchSchema),
  quality_profile: Schema.optional(QualityProfile),
  workflow_policy: Schema.optional(PolicySchema),
  scope: Schema.optional(ScopeDraftSchema),
  report_reference: Schema.optional(ReportReferenceSchema),
  thought_source: Schema.optional(ThoughtSource),
  repository_id: RepositoryId,
  title: NonEmpty,
  description: NonEmpty,
  priority: Schema.optional(Priority),
  dependencies: Schema.optional(Schema.mutable(Schema.Array(IssueId))),
  request_id: Schema.optional(RequestId),
});
export type WorkInput = typeof WorkInputSchema.Type;
export const NewIssueSchema = Schema.Struct({
  ...WorkInputSchema.fields,
  priority: Priority,
  dependencies: Schema.mutable(Schema.Array(IssueId)),
  request_id: RequestId,
});
export type NewIssue = {
  -readonly [K in keyof typeof NewIssueSchema.Type]: (typeof NewIssueSchema.Type)[K];
};
export const SavedRequestSchema = Schema.fromJsonString(NewIssueSchema);
export interface ReadyExplanation {
  ready: Issue[];
  blocked: Array<Issue & { blocked_by: Array<Pick<Issue, "id" | "title" | "status">> }>;
}

/** Normalize before hashing or persisting, including callers outside the controller. */
export function normalizeIssue(value: unknown): NewIssue {
  const input = decodeSync(NewIssueSchema, value, "Work request");
  const repository_id = RepositoryId.make(input.repository_id);
  const request_id = RequestId.make(input.request_id);
  ensure(
    typeof input.title === "string" && input.title.trim(),
    "ISSUE_TITLE",
    "A title is required",
  );
  ensure(
    typeof input.description === "string" && input.description.trim(),
    "ISSUE_DESCRIPTION",
    "Describe the requested goal; Explore can resolve implementation details",
  );
  const workflow_policy = Schema.decodeSync(PolicySchema)(input.workflow_policy ?? "full-openspec");
  ensure(
    workflow_policy === "full-openspec" ||
      (input.openspec_schema === undefined && input.require_plan_approval === undefined),
    "OPENSPEC_WORKFLOW",
    "OpenSpec schema and human plan requirements require full-openspec work",
  );
  const scope =
    input.scope === undefined ? undefined : Schema.decodeSync(ScopeDraftSchema)(input.scope);
  const report_reference =
    input.report_reference === undefined
      ? undefined
      : Schema.decodeSync(ReportReferenceSchema)(input.report_reference);
  return {
    ...(input.openspec_schema === undefined ? {} : { openspec_schema: input.openspec_schema }),
    ...(input.require_plan_approval === undefined
      ? {}
      : { require_plan_approval: input.require_plan_approval }),
    ...(input.quality_profile === undefined ? {} : { quality_profile: input.quality_profile }),
    ...(input.dispatch === undefined ? {} : { dispatch: normalizeDispatch(input.dispatch) }),
    workflow_policy,
    scope,
    report_reference,
    ...(input.thought_source && { thought_source: input.thought_source }),
    repository_id,
    title: input.title.trim(),
    description: input.description.trim(),
    priority: input.priority,
    dependencies: [...new Set(input.dependencies.map((id) => IssueId.make(id)))].sort(),
    request_id,
  };
}

export function explainIssues(issues: readonly Issue[]): ReadyExplanation {
  const byID = new Map(issues.map((issue) => [issue.id, issue]));
  const result: ReadyExplanation = { ready: [], blocked: [] };
  for (const issue of issues) {
    if (issue.status === "closed") continue;
    const blocked_by = issue.dependencies.flatMap((id) => {
      const dependency = byID.get(id);
      ensure(dependency, "ISSUE_DEPENDENCIES", `Missing dependency ${id}`);
      return dependency.status === "closed"
        ? []
        : [{ id, title: dependency.title, status: dependency.status }];
    });
    explainIssue(result, issue, blocked_by);
  }
  return result;
}

export function explainIssue(
  result: ReadyExplanation,
  issue: Issue,
  blocked_by: ReadyExplanation["blocked"][number]["blocked_by"],
) {
  if (issue.status === "open" && !issue.assignee && !blocked_by.length) result.ready.push(issue);
  else result.blocked.push({ ...issue, blocked_by });
}
