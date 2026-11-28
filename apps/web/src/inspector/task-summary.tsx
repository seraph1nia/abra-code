import { ThoughtSource } from "../thought-source.tsx";
import { Button } from "@abracode/presentation/ui/button";
import { usableForm } from "@abracode/contracts/visibility/attention";
import type { AttentionForm } from "@abracode/contracts/web/contracts";
import type { WebWorkItem } from "@abracode/contracts/web/wire";
import { phaseLabel } from "@abracode/contracts/presentation/work-state";
import type { Inspect } from "@abracode/presentation/cards";
import { OutcomeSummary } from "@abracode/presentation/cards";
import { RequestState } from "../request-state.tsx";
import { queries } from "../work-data.ts";
import { actionable } from "@abracode/contracts/workflow/feedback-contracts";
import { VerificationPanel } from "../presentation/verification.tsx";

export function TaskSummary({
  work,
  forms,
  showGoal,
  focusForm,
}: {
  work: WebWorkItem;
  forms: readonly AttentionForm[];
  showGoal: boolean;
  focusForm: (id: string) => void;
}) {
  const human = forms.find((f) => usableForm(f) && f.checkpoint?.issue_id === work.issue_id);
  const progress =
    work.progress?.generation === work.generation ? work.progress?.summary : undefined;
  const owner = human
    ? "You"
    : work.issue_status === "closed"
      ? "Complete"
      : (work.active_role ?? "Abra");
  return (
    <section className="task-summary" aria-label="Task summary">
      <RequestState query={queries.overview(work.issue_id)}>
        {(detail) => (
          <>
            {showGoal && <p>{detail.intent?.goal || detail.description || work.title}</p>}
            {detail.thought_source && (
              <ThoughtSource
                reference={detail.thought_source.reference}
                excerpt={detail.thought_source.excerpt}
              />
            )}
          </>
        )}
      </RequestState>
      <dl>
        <div>
          <dt>Status</dt>
          <dd>{work.phase ? phaseLabel(work.phase) : work.issue_status}</dd>
        </div>
        <div>
          <dt>Next owner</dt>
          <dd>{owner}</dd>
        </div>
        {(progress || work.latest_evidence) && (
          <div>
            <dt>Latest progress</dt>
            <dd>{progress || work.latest_evidence}</dd>
          </div>
        )}
      </dl>
      {human?.checkpoint?.kind === "decision" && (
        <Button size="sm" onClick={() => focusForm(human.form.id)}>
          {human.form.title}
        </Button>
      )}
    </section>
  );
}

export function OutcomeReport({
  work,
  inspect,
  focusForm,
}: {
  work: WebWorkItem;
  inspect: Inspect;
  focusForm: (id: string) => void;
}) {
  return (
    <section className="task-report inspector-stack" aria-label="Outcome report">
      <h3>Outcome report</h3>
      <RequestState query={queries.overview(work.issue_id)}>
        {(detail) => {
          const intent = detail.intent;
          const outcome = detail.work.outcome;
          return (
            <>
              <p>{intent?.goal || detail.description || work.title}</p>
              {outcome && (
                <>
                  <OutcomeSummary outcome={outcome} />
                  <p>
                    {outcome.delivery.kind === "branch" &&
                      outcome.delivery.state === "verified" &&
                      "Branch preserved. "}
                    {outcome.next_action}
                  </p>
                  {outcome.delivered_commit && (
                    <details>
                      <summary>Delivery revision</summary>
                      <p>
                        Delivery revision <code>{outcome.delivered_commit}</code>
                      </p>
                    </details>
                  )}
                </>
              )}
              {intent?.results?.some((result) => !result.met) && (
                <section>
                  <h4>Unmet acceptance criteria</h4>
                  <ul>
                    {intent.results
                      .filter((result) => !result.met)
                      .map((result) => (
                        <li key={result.criterion}>{result.criterion}</li>
                      ))}
                  </ul>
                </section>
              )}
              {intent?.comparison || intent?.criteria.length || work.phase === "awaiting_merge" ? (
                <details>
                  <summary>Delivery and acceptance evidence</summary>
                  {intent?.comparison ? (
                    <p>
                      {intent.comparison.url ? (
                        <a href={intent.comparison.url}>Compare with the previous delivery</a>
                      ) : (
                        "Comparison link unavailable"
                      )}{" "}
                      ·{" "}
                      <code>
                        {intent.comparison.previous.slice(0, 12)} …{" "}
                        {intent.comparison.current.slice(0, 12)}
                      </code>
                    </p>
                  ) : (
                    work.phase === "awaiting_merge" && (
                      <p>No prior delivery comparison is available.</p>
                    )
                  )}
                  {intent?.criteria.length ? (
                    <>
                      <h4>Acceptance criteria</h4>
                      <ul>
                        {intent.criteria.map((criterion, i) => {
                          const result = intent.results?.find((row) => row.criterion === criterion);
                          return (
                            <li key={i}>
                              {criterion} ·{" "}
                              {result
                                ? (result.met ? "Met" : "Unmet") + " — " + result.evidence
                                : "No criterion-level verdict recorded"}
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  ) : null}
                </details>
              ) : null}
              {intent?.limitations?.length ? (
                <>
                  <h4>Limitations</h4>
                  <ul>
                    {intent.limitations.map((text, i) => (
                      <li key={i}>{text}</li>
                    ))}
                  </ul>
                </>
              ) : null}
            </>
          );
        }}
      </RequestState>
      {work.outcome?.delivery.kind === "github-pr" && (
        <RequestState query={queries.feedback(work.issue_id)}>
          {(page) => {
            const observation = page.observation;
            if (!observation || observation.head !== page.head)
              return <p>Current pull request findings are unavailable.</p>;
            const findings = page.findings.filter((f) => actionable(f, observation.head));
            return (
              <section>
                <h4>Pull request findings</h4>
                <p>
                  {findings.length} unresolved blocking findings on this page
                  {observation.complete ? "." : " · Partial observation."}
                </p>
                <ul>
                  {findings.map((f) => (
                    <li key={f.id}>
                      <Button
                        variant="link"
                        size="sm"
                        onClick={() =>
                          inspect({
                            action: "open_finding",
                            issue_id: work.issue_id,
                            finding_id: f.id,
                            revision: f.revision,
                          })
                        }
                      >
                        {f.text.slice(0, 200)}
                      </Button>
                    </li>
                  ))}
                </ul>
                {page.finding_total > page.findings.length && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      inspect({
                        action: "open_task",
                        issue_id: work.issue_id,
                        section: "activity",
                        activity: "checks",
                      })
                    }
                  >
                    All findings
                  </Button>
                )}
              </section>
            );
          }}
        </RequestState>
      )}
      {work.policy !== "research-only" && (
        <VerificationPanel compact work={work} inspect={inspect} focusForm={focusForm} />
      )}
    </section>
  );
}
