import { Schema } from "effect";
import { Commit, IssueId, RepositoryId, Timestamp } from "../identities.ts";
import { Count, Positive } from "../primitives.ts";

export const InboxKind = Schema.Literals(["issue", "pr"]);
export const InboxState = Schema.Literals(["OPEN", "CLOSED", "MERGED"]);
export const InboxRole = Schema.Literals(["pickup", "review", "delivery"]);
export const InboxTarget = Schema.Struct({
  repository_id: RepositoryId,
  repo_node: Schema.NonEmptyString,
  item_node: Schema.NonEmptyString,
  kind: InboxKind,
  number: Positive,
});
export type InboxTarget = typeof InboxTarget.Type;
export const InboxSummary = Schema.Struct({
  ...InboxTarget.fields,
  url: Schema.NonEmptyString,
  title: Schema.String,
  author: Schema.NullOr(Schema.String),
  labels: Schema.Array(Schema.String),
  labels_complete: Schema.Boolean,
  state: InboxState,
  updated_at: Timestamp,
  draft: Schema.Boolean,
});
export type InboxSummary = typeof InboxSummary.Type;
export const InboxLink = Schema.Struct({
  role: InboxRole,
  issue_id: IssueId,
  status: Schema.String,
  revision: Schema.optional(Commit),
});
export const InboxRow = Schema.Struct({ ...InboxSummary.fields, links: Schema.Array(InboxLink) });
export const InboxQuery = Schema.Struct({
  repository_id: Schema.optional(RepositoryId),
  state: Schema.optional(InboxState),
  kind: Schema.optional(InboxKind),
  search: Schema.optional(Schema.String.check(Schema.isMaxLength(256))),
  label: Schema.optional(Schema.String.check(Schema.isMaxLength(256))),
  role: Schema.optional(Schema.Literals(["pickup", "review", "delivery", "unassigned"])),
  offset: Schema.optional(Count),
  refresh: Schema.optional(Schema.Boolean),
});
export type InboxQuery = typeof InboxQuery.Type;
export const InboxPage = Schema.Struct({
  entries: Schema.Array(InboxRow),
  total: Count,
  coverage: Schema.Array(
    Schema.Struct({
      repository_id: RepositoryId,
      kind: InboxKind,
      status: Schema.Literals(["current", "loading", "stale", "unavailable"]),
      observed_at: Schema.optional(Count),
      message: Schema.optional(Schema.String),
    }),
  ),
});
export const InboxDetail = Schema.Struct({
  ...InboxRow.fields,
  body: Schema.String,
  comments: Schema.Array(Schema.Struct({ author: Schema.String, body: Schema.String })),
  comments_complete: Schema.Boolean,
  observed_at: Count,
  base: Schema.optional(Commit),
  head: Schema.optional(Commit),
  changed_files: Schema.optional(Count),
});
export type InboxDetail = typeof InboxDetail.Type;
