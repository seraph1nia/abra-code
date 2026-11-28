import { Schema } from "effect";
import { Fingerprint, IssueId, ObligationKey } from "../identities.ts";
import { Count } from "../primitives.ts";

export const ProposalReviewSelection = Schema.Literals(["supervisor", "user"]);
const text = Schema.NonEmptyString.check(Schema.isPattern(/\S/), Schema.isMaxLength(2048));
export const ReaderReport = Schema.Struct({
  reading: text,
  findings: Schema.Array(
    Schema.Struct({
      owner: Schema.Literals(["planner", "human"]),
      question: text,
      evidence: text,
    }),
  ).check(Schema.isMaxLength(16)),
});
export const ReviewStatus = Schema.Literals(["pending", "unavailable", "completed", "continued"]);
export const ProposalReviewSource = Schema.Struct({ issue_id: IssueId, fingerprint: Fingerprint });
export const ProposalReviewView = Schema.Struct({
  ...ProposalReviewSource.fields,
  path: Schema.String,
  status: ReviewStatus,
  current: Schema.Boolean,
  reason: Schema.optional(Schema.String),
  report: Schema.optional(ReaderReport),
  decisions: Schema.Array(
    Schema.Struct({ key: ObligationKey, generation: Count, label: Schema.String }),
  ),
});
export type ProposalReviewView = typeof ProposalReviewView.Type;
