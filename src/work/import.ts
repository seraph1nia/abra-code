import { LegacyAssignee, IssueId, RepositoryId, RequestId } from "../identities.ts";

import { Schema } from "effect";
import { ensure, type Policy } from "../domain.ts";
import { IssueSchema, type Issue } from "./model.ts";

const legacyIssue = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  description: Schema.optional(Schema.String),
  status: IssueSchema.fields.status,
  priority: Schema.Int,
  assignee: Schema.optional(Schema.String),
  labels: Schema.optional(Schema.Array(Schema.String)),
  metadata: Schema.optional(
    Schema.Struct({
      repository_id: Schema.optional(Schema.String),
      workflow_policy: Schema.optional(IssueSchema.fields.workflow_policy),
      abracode_request_id: Schema.optional(Schema.String),
    }),
  ),
  dependencies: Schema.optional(
    Schema.Array(
      Schema.Struct({
        depends_on_id: Schema.String,
        type: Schema.String,
      }),
    ),
  ),
});
const decode = Schema.decodeUnknownSync(Schema.fromJsonString(legacyIssue));

/** Accept bd export JSONL. Reject unsupported statuses/edges rather than silently changing readiness. */
export function parseBeadsExport(source: string, fallback: Policy = "full-openspec"): Issue[] {
  return source
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => {
      const old = decode(line);
      const labels = (old.labels ?? [])
        .filter((label) => label.startsWith("repo:"))
        .map((label) => label.slice(5));
      const repository = old.metadata?.repository_id ?? labels[0];
      ensure(
        labels.length <= 1 &&
          (!labels.length || !old.metadata?.repository_id || labels[0] === repository),
        "REPOSITORY_ASSOCIATION",
        `Conflicting repository associations on ${old.id}`,
      );
      ensure(repository, "REPOSITORY_ASSOCIATION", `Missing repository association on ${old.id}`);
      const dependencies = (old.dependencies ?? []).map((dependency) => {
        ensure(
          dependency.type === "blocks",
          "ISSUE_DEPENDENCIES",
          `Unsupported dependency type ${dependency.type} on ${old.id}`,
        );
        return IssueId.make(dependency.depends_on_id);
      });
      return {
        id: IssueId.make(old.id),
        repository_id: RepositoryId.make(repository),
        workflow_policy: old.metadata?.workflow_policy ?? fallback,
        request_id: RequestId.make(old.metadata?.abracode_request_id ?? `import-${old.id}`),
        title: old.title,
        description: old.description ?? "",
        status: old.status,
        priority: old.priority,
        assignee: old.assignee ? LegacyAssignee.make(old.assignee) : undefined,
        dependencies: [...new Set(dependencies)].sort(),
      };
    });
}
