import { EvidenceReceiptSchema } from "../web/worker-evidence.ts";
import { ResourceSelectionSchema } from "../web/resources.ts";
import { Schema } from "effect";
import { Count, RoleSchema } from "../primitives.ts";
import { IssueId, SessionId, RepositoryId, Timestamp } from "../identities.ts";
import { WorkSummarySchema } from "./work-summary.ts";
import { FleetSchema } from "./fleet.ts";

export const WorkDiscoveryQuery = Schema.Struct({
  repository_id: Schema.optional(RepositoryId),
  state: Schema.optional(Schema.Literals(["active", "closed", "all"])),
  search: Schema.optional(Schema.String.check(Schema.isMaxLength(256))),
  offset: Schema.optional(Count),
  limit: Schema.optional(Count.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(50))),
});
export type WorkDiscovery = typeof WorkDiscoveryQuery.Type;
export const CapacityUsageSchema = Schema.Struct({
  workers: Count,
  worker_limit: Count,
  retained: Count,
  retained_limit: Count,
});
export const WorkPageSchema = Schema.Struct({
  capacity: Schema.optionalKey(CapacityUsageSchema),
  project_capacity: Schema.optionalKey(CapacityUsageSchema),
  entries: Schema.Array(WorkSummarySchema).check(Schema.isMaxLength(50)),
  total: Count,
  offset: Count,
  limit: Count,
  next_offset: Schema.optional(Count),
  fleet: Schema.optional(FleetSchema),
  fleet_observation: Schema.optional(
    Schema.Struct({
      state: Schema.Literals(["current", "stale", "unavailable"]),
      work_revision: Schema.optional(Schema.String),
      observed_at: Schema.optional(Timestamp),
    }),
  ),
  work_revision: Schema.optional(Schema.String),
  observed_at: Timestamp,
});

export const SessionQuery = Schema.Struct({
  search: WorkDiscoveryQuery.fields.search,
  repository_id: WorkDiscoveryQuery.fields.repository_id,
  offset: WorkDiscoveryQuery.fields.offset,
  limit: WorkDiscoveryQuery.fields.limit,
});
export const SessionRow = Schema.Struct({
  session_id: SessionId,
  issue_id: IssueId,
  repository_id: RepositoryId,
  title: Schema.String,
  availability: Schema.Literals(["available", "unavailable", "unverified"]),
  role: RoleSchema,
  association: Schema.Literals(["current", "historical"]),
});
export const SessionPage = Schema.Struct({
  entries: Schema.Array(SessionRow),
  total: Count,
  next_offset: Schema.optional(Count),
});

export const EvidenceKind = Schema.Literals([
  "report",
  "review",
  "finding",
  "decision",
  "wait",
  "check",
  "screenshot",
  "trace",
  "plan",
  "file",
  "communication",
  "lead",
  "proposal",
]);
export type EvidenceKind = typeof EvidenceKind.Type;
export const RetainedTarget = Schema.Struct({
  repository_id: RepositoryId,
  issue_id: Schema.optionalKey(IssueId),
  kind: EvidenceKind,
  identity: Schema.NonEmptyString.check(Schema.isMaxLength(512)),
});
export type RetainedTarget = typeof RetainedTarget.Type;
export const EvidenceSearch = Schema.Struct({
  search: WorkDiscoveryQuery.fields.search,
  kind: Schema.optional(EvidenceKind),
  repository_id: Schema.optional(RepositoryId),
  issue_id: Schema.optional(IssueId),
  identity: Schema.optional(RetainedTarget.fields.identity),
  after_owner: Schema.optional(Schema.String.check(Schema.isMaxLength(1024))),
  after_entry: Schema.optional(Schema.String.check(Schema.isMaxLength(1024))),
});
export type EvidenceSearch = typeof EvidenceSearch.Type;
export const EvidenceHit = Schema.Struct({
  ...RetainedTarget.fields,
  asset: Schema.optionalKey(EvidenceReceiptSchema),
  label: Schema.String,
  context: Schema.String,
  resource: Schema.optionalKey(ResourceSelectionSchema),
});
export type EvidenceHit = typeof EvidenceHit.Type;
export const EvidenceSearchPage = Schema.Struct({
  entries: Schema.Array(EvidenceHit).check(Schema.isMaxLength(12)),
  next: Schema.optional(Schema.Struct({ after_owner: Schema.String, after_entry: Schema.String })),
  coverage: Schema.Array(Schema.String),
});
