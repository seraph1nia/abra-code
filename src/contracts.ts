import {
  StorageKey,
  IssueId,
  Fingerprint,
  FormId,
  SessionId,
  Commit,
  BranchName,
  PullRequestUrl,
  Timestamp,
} from "./identities.ts";
import { Model } from "@opencode/schema/model";
import { SessionError } from "@opencode/schema/session-error";

import { Schema } from "effect";

export { Identifier, Commit } from "./identities.ts";

export const NonEmpty = Schema.NonEmptyString;
export const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
export const Positive = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));
export const Priority = Count.check(Schema.isLessThanOrEqualTo(4));
export const PolicySchema = Schema.Literals(["full-openspec", "research-only", "lightweight-fix"]);
export const RoleSchema = Schema.Literals(["explore", "apply", "review", "research"]);
export const CommandArgs = Schema.Array(NonEmpty).check(Schema.isMinLength(1));
export const WorkerModelSchema = Model.Ref;
export const ApprovalSchema = Schema.Struct({
  kind: Schema.Literals(["plan", "merge"]),
  fingerprint: Schema.Union([Fingerprint, Commit]),
  form_id: FormId,
  session_id: SessionId,
  authorized_at: Schema.mutableKey(Schema.optional(Timestamp)),
  rejected_at: Schema.mutableKey(Schema.optional(Timestamp)),
}).check(
  Schema.makeFilter(
    (a) => !(a.authorized_at && a.rejected_at) || "Approval cannot be both authorized and rejected",
  ),
);
export const DeliveryReceiptSchema = Schema.Struct({
  source_commit: Schema.optional(Commit),
  result_commit: Schema.optional(Commit),
  pr: Schema.optional(PullRequestUrl),
  method: Schema.optional(Schema.Literals(["merge", "squash", "rebase"])),
  commit: Commit,
  target: BranchName,
  at: Timestamp,
});
export const MergeMethodSchema = Schema.Literals(["merge", "squash", "rebase"]);
export const CIPolicySchema = Schema.Literals(["all-reported", "required"]);
export const FailureCategory = Schema.Literals([
  "waiting",
  "retryable",
  "verification",
  "recovery",
]);

export const PhaseSchema = Schema.Literals([
  "queued",
  "claiming",
  "provisioning",
  "researching",
  "exploring",
  "planning",
  "awaiting_plan_approval",
  "applying",
  "verifying",
  "validating_external",
  "archiving",
  "delivering",
  "awaiting_merge",
  "cleaning",
  "completed",
  "blocked",
  "interrupted",
  "failed",
  "recovery_required",
]);

export const DeliveryPolicySchema = Schema.Literals(["github-pr", "branch"]);
export const BranchPolicySchema = Schema.Literals(["default", "fixed"]);
export const WorkerErrorSchema = Schema.Struct({
  type: SessionError.Error.fields.type.check(Schema.isMinLength(1)),
  message: SessionError.Error.fields.message,
  status: Schema.optional(Count),
});
export const ReadinessBlockerSchema = Schema.Struct({
  code: Schema.Literals([
    "dependency",
    "status",
    "policy",
    "setup",
    "execution",
    "capacity",
    "authority",
  ]),
  message: Schema.String,
  capacity_kind: Schema.optional(Schema.Literals(["active", "retained", "role"])),
  consuming: Schema.optional(Schema.mutable(Schema.Array(IssueId))),
});

export const RecordDiagnosticSchema = Schema.Struct({
  key: StorageKey,
  code: Schema.Literals(["unsupported_version", "invalid_record"]),
  message: Schema.String,
});
export type RecordDiagnostic = typeof RecordDiagnosticSchema.Type;
