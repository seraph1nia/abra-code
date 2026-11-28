import type { ProposalReviewView } from "../visibility/proposal-review.ts";
import { catalogId, validateSurface } from "./surfaces.ts";

/** Both the Plan panel and Supervisor publications render the same retained evidence. */
export function proposalReviewSurface(id: string, review: ProposalReviewView) {
  const state =
    review.status === "completed"
      ? review.report?.findings.length
        ? "Independent review completed"
        : "Independent review completed with no material findings"
      : review.status === "continued"
        ? "Human chose to continue without independent review"
        : review.status === "unavailable"
          ? "Review pending · reviewer unavailable"
          : "Independent review pending";
  const items = [
    { id: "heading", component: "Text", text: state },
    {
      id: "source",
      component: "Text",
      text: `${review.current ? "Reviewed revision" : "Historical revision"} · ${review.fingerprint} · ${review.path || "Proposal unavailable"}`,
    },
    ...(review.reason ? [{ id: "reason", component: "Text", text: review.reason }] : []),
    ...(review.report ? [{ id: "reading", component: "Text", text: review.report.reading }] : []),
    ...(review.report?.findings.length
      ? [
          {
            id: "findings",
            component: "Table",
            caption: "Material findings",
            columns: ["Owner", "Finding or question", "Evidence"],
            rows: review.report.findings.map((f) => [
              f.owner === "human" ? "Human decision" : "Planner",
              f.question,
              f.evidence,
            ]),
          },
        ]
      : []),
    ...review.decisions.map((d, i) => ({
      id: "decision" + i,
      component: "ResourceLink",
      label: d.label.slice(0, 256),
      target: {
        action: "open_decision",
        issue_id: review.issue_id,
        key: d.key,
        generation: d.generation,
      },
    })),
    {
      id: "current",
      component: "ResourceLink",
      label: "Open current plan",
      target: { action: "open_task", issue_id: review.issue_id, section: "plan" },
    },
  ];
  return validateSurface({
    version: "1.0",
    createSurface: {
      surfaceId: id,
      catalogId,
      components: [{ id: "root", component: "Column", children: items.map((i) => i.id) }, ...items],
    },
  });
}
