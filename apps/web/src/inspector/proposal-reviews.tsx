import { useMemo, useState } from "react";
import { GeneratedSurface } from "@abracode/presentation/surfaces";
import type { Inspect } from "@abracode/presentation/cards";
import { proposalReviewSurface } from "@abracode/contracts/web/proposal-review-surface";
import type { ProposalReviewView } from "@abracode/contracts/visibility/proposal-review";
import type { WebWorkItem } from "@abracode/contracts/web/wire";

export function ProposalReviewsPanel({
  reviews,
  work,
  inspect,
}: {
  reviews: readonly ProposalReviewView[];
  work: WebWorkItem;
  inspect: Inspect;
}) {
  const [selected, select] = useState("");
  const review =
    reviews.find((r) => r.fingerprint === selected) ??
    reviews.find((r) => r.current) ??
    reviews.at(-1)!;
  const surface = useMemo(() => proposalReviewSurface("proposal-review", review), [review]);
  return (
    <section aria-label="Independent proposal review">
      {reviews.length > 1 && (
        <label>
          Reviewed plan{" "}
          <select value={review.fingerprint} onChange={(e) => select(e.target.value)}>
            {reviews.map((r) => (
              <option key={r.fingerprint} value={r.fingerprint}>
                {r.current ? "Current" : "Historical"} · {r.fingerprint.slice(0, 12)}
              </option>
            ))}
          </select>
        </label>
      )}
      <GeneratedSurface
        record={{ surface, revision: 1, at: "", snapshot: [work] }}
        work={[work]}
        inspect={(target) => {
          if (target.action === "open_task" && target.section === "plan") select("");
          inspect(target);
        }}
      />
    </section>
  );
}
