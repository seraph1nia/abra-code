import { Schema } from "effect";
import {
  IssueId,
  RepositoryId,
  Timestamp,
  PullRequestUrl,
  FormId,
  ReportId,
  ContentHash,
} from "../identities.ts";
import { Count, Priority } from "../primitives.ts";
import { ResourceSelectionSchema } from "../web/resources.ts";
import { InboxPage, InboxTarget } from "./github-inbox.ts";

export const BriefingQuery = Schema.Struct({
  repository_id: Schema.optional(RepositoryId),
  include_open_github: Schema.optional(Schema.Boolean),
});
export const BriefingItem = Schema.Struct({
  issue_id: IssueId,
  repository_id: Schema.optional(RepositoryId),
  pull_request: Schema.optional(PullRequestUrl),
  title: Schema.String,
  priority: Priority,
  source: Schema.String,
  fact: Schema.String,
  target: ResourceSelectionSchema,
  form_id: Schema.optional(FormId),
  fingerprint: Schema.optional(Schema.String),
  report: Schema.optional(Schema.Struct({ id: ReportId, hash: ContentHash })),
  observed_at: Timestamp,
});
export type BriefingItem = typeof BriefingItem.Type;
export const briefingLimit = 10;
const section = Schema.Struct({
  entries: Schema.Array(BriefingItem).check(Schema.isMaxLength(briefingLimit)),
  total: Count,
});
export const WorkBriefing = Schema.Struct({
  scope: BriefingQuery,
  observed_at: Timestamp,
  work_revision: Schema.optional(Schema.String),
  decisions: section,
  outcomes: section,
  ongoing: section,
  queue: section,
  limitations: Schema.Array(Schema.String),
  github: Schema.Struct({
    entries: Schema.Array(
      Schema.Struct({
        ...InboxTarget.fields,
        title: Schema.String,
        url: Schema.String,
        updated_at: Timestamp,
        links: Schema.Array(IssueId),
      }),
    ).check(Schema.isMaxLength(briefingLimit)),
    total: Count,
    coverage: InboxPage.fields.coverage,
  }),
});
