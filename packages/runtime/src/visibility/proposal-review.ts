import type { Execution } from "../domain.ts";
import type { ProposalReviewView } from "@abracode/contracts/visibility/proposal-review";
import type { ReviewRevision } from "../workflow/proposal-review-contracts.ts";

export function proposalReviewView(e: Execution, revision: ReviewRevision): ProposalReviewView {
  const current = e.plan_fingerprint === revision.fingerprint;
  return {
    issue_id: e.issue_id,
    fingerprint: revision.fingerprint,
    current,
    path: revision.path,
    status: revision.status,
    reason: revision.reason,
    report: revision.report,
    decisions: current
      ? (e.decisions ?? [])
          .filter(
            (d) =>
              d.status === "open" &&
              d.generation === e.control_generation &&
              d.proposal_fingerprint === revision.fingerprint,
          )
          .map((d) => ({
            key: d.key,
            generation: d.generation,
            label: d.choices ? "Retry review or continue" : d.question.split("\n")[0]!,
          }))
      : [],
  };
}
