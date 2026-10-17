import { Schema } from "effect";
import { AbsolutePath, Commit, BranchName, Fingerprint } from "../identities.ts";
import { ExecutionStateSchema } from "../storage/contracts.ts";
import { decode } from "../decode.ts";
import { type ManagedExecution } from "../domain.ts";

const provisioned = {
  worktree_directory: AbsolutePath,
  base_commit: Commit,
  target_branch: BranchName,
};
export const ProvisionedEvidenceSchema = Schema.Struct(provisioned);
export const ApprovedEvidenceSchema = Schema.Struct({
  ...provisioned,
  plan_fingerprint: Fingerprint,
});
export const VerifiedEvidenceSchema = Schema.Struct({
  ...ApprovedEvidenceSchema.fields,
  verification_receipt: ExecutionStateSchema.fields.verification_receipt.schema,
  review_receipt: ExecutionStateSchema.fields.review_receipt.schema,
});
export const DeliveredEvidenceSchema = Schema.Struct({ ...provisioned, delivered_commit: Commit });
export type ProvisionedEvidence = typeof ProvisionedEvidenceSchema.Type;
export type VerifiedEvidence = typeof VerifiedEvidenceSchema.Type;
export type DeliveredEvidence = typeof DeliveredEvidenceSchema.Type;
export const provisionedEvidence = (e: ManagedExecution) =>
  decode(ProvisionedEvidenceSchema, e, "Provisioned execution");
export const approvedEvidence = (e: ManagedExecution) =>
  decode(ApprovedEvidenceSchema, e, "Approved execution");
export const verifiedEvidence = (e: ManagedExecution) =>
  decode(VerifiedEvidenceSchema, e, "Verified execution");
export const deliveredEvidence = (e: ManagedExecution) =>
  decode(DeliveredEvidenceSchema, e, "Delivered execution");
