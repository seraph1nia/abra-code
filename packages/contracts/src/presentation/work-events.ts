import type { WorkSummary } from "../visibility/work-summary.ts";

export type WorkEvent = {
  id: string;
  issue: WorkSummary;
  at: number;
  label: string;
  detail: string;
};
/** Captured observations only: never use render time as a missing event time. */
export function workEvents(work: readonly WorkSummary[]) {
  const events: WorkEvent[] = [];
  for (const issue of work) {
    const add = (id: string, at: number | undefined, label: string, detail: string) => {
      if (at !== undefined && Number.isFinite(new Date(at).getTime()))
        events.push({ id: `${issue.issue_id}:${id}`, issue, at, label, detail });
    };
    if (issue.progress)
      add("progress", issue.progress.at, "Latest progress", issue.progress.summary);
    for (const decision of issue.decisions ?? []) {
      const id = `decision:${decision.generation}:${decision.key}`;
      add(`${id}:opened`, decision.opened_at, "Decision opened", decision.question);
      if (decision.status !== "open")
        add(
          `${id}:resolved`,
          decision.resolved_at,
          `Decision ${decision.status}`,
          decision.question,
        );
    }
    for (const wait of issue.waits ?? [])
      add(`wait:${wait.generation}:${wait.key}`, wait.started_at, "Wait declared", wait.condition);
    if (issue.closed_at) add("closed", Date.parse(issue.closed_at), "Issue closed", issue.title);
  }
  events.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  return { events: events.slice(0, 512), total: events.length };
}
