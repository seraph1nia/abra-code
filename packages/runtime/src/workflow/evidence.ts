import { Effect, Schema } from "effect";
import { AbsolutePath, Commit, BranchName, Fingerprint } from "@abracode/contracts/identities";
import { ExecutionStateSchema } from "../storage/contracts.ts";
import { CrewError, type ManagedExecution } from "../domain.ts";

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
export type ProvisionedExecution<E extends ManagedExecution = ManagedExecution> = E &
  ProvisionedEvidence;
export type ApprovedExecution<E extends ManagedExecution = ManagedExecution> = E &
  typeof ApprovedEvidenceSchema.Type;
export type VerifiedExecution<E extends ManagedExecution = ManagedExecution> = E & VerifiedEvidence;
export type DeliveredExecution<E extends ManagedExecution = ManagedExecution> = E &
  DeliveredEvidence;

function provisionedExecution<E extends ManagedExecution>(e: E): e is ProvisionedExecution<E> {
  return (
    e.worktree_directory !== undefined &&
    e.base_commit !== undefined &&
    e.target_branch !== undefined
  );
}
function approvedExecution<E extends ManagedExecution>(e: E): e is ApprovedExecution<E> {
  return provisionedExecution(e) && e.plan_fingerprint !== undefined;
}
function verifiedExecution<E extends ManagedExecution>(e: E): e is VerifiedExecution<E> {
  return (
    approvedExecution(e) && e.verification_receipt !== undefined && e.review_receipt !== undefined
  );
}
function deliveredExecution<E extends ManagedExecution>(e: E): e is DeliveredExecution<E> {
  return provisionedExecution(e) && e.delivered_commit !== undefined;
}

const missing = (phase: string) =>
  Effect.fail(new CrewError("INVALID_DATA", `${phase} execution is missing required evidence`));
export const provisionedEvidence = <E extends ManagedExecution>(e: E) =>
  provisionedExecution(e) ? Effect.succeed(e) : missing("Provisioned");
export const approvedEvidence = <E extends ManagedExecution>(e: E) =>
  approvedExecution(e) ? Effect.succeed(e) : missing("Approved");
export const verifiedEvidence = <E extends ManagedExecution>(e: E) =>
  verifiedExecution(e) ? Effect.succeed(e) : missing("Verified");
export const deliveredEvidence = <E extends ManagedExecution>(e: E) =>
  deliveredExecution(e) ? Effect.succeed(e) : missing("Delivered");
