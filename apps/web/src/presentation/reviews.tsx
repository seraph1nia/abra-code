import { useState } from "react";
import { useDeadline } from "../deadline.ts";
import { Markdown as DeferredMarkdown } from "../markdown.tsx";
import type { IssueId } from "@abracode/contracts/identities";
import type { FeedbackPageSchema } from "@abracode/contracts/web/wire";
import { queries } from "../work-data.ts";
import { RequestState } from "../request-state.tsx";
import { Button } from "@abracode/presentation/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@abracode/presentation/ui/card";
import { StatusBadge, statusTone } from "@abracode/presentation/cockpit";
import { FindingCard, Evidence } from "@abracode/presentation/cards";
const words = (value: string) =>
  value
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/^./, (c) => c.toUpperCase());
type Page = typeof FeedbackPageSchema.Type;
function Markdown({ text }: { text: string }) {
  return <DeferredMarkdown key={text} content={text} mode="static" className="prose" />;
}
function Deadline({ deadline }: { deadline: number }) {
  return useDeadline(deadline) ? " · Stale retained observation" : null;
}
export function ReviewsPanel({ issue }: { issue: IssueId }) {
  const [page, setPage] = useState(0);
  return (
    <RequestState query={queries.feedback(issue, page)}>
      {(evidence) => {
        const next =
          (page + 1) * evidence.page_size <
            Math.max(evidence.finding_total, evidence.history_total, evidence.action_total) ||
          page + 1 < evidence.external_history_total;
        return (
          <div className="space-y-4">
            <h3>Reviews & checks</h3>
            {evidence.observation ? (
              <>
                <p>
                  {evidence.observation.complete
                    ? "Complete feedback observation"
                    : "Feedback observation incomplete"}{" "}
                  · {new Date(evidence.observation.observed_at).toLocaleString()}
                </p>
                <p className="muted">
                  Recheck due {new Date(evidence.observation.next_check_at).toLocaleString()}
                  <Deadline deadline={evidence.observation.next_check_at} />
                </p>
                {evidence.observation.error && <output>{evidence.observation.error}</output>}
                <Evidence>
                  <p>
                    Assessed head <code>{evidence.observation.head}</code> · Target{" "}
                    {evidence.observation.target}
                  </p>
                </Evidence>
              </>
            ) : (
              <p>No retained PR feedback observation. This does not establish successful checks.</p>
            )}
            <section className="space-y-3" aria-label="Current review and check findings">
              <h4>Current findings · {evidence.finding_total}</h4>
              {evidence.findings.map((finding) => (
                <FindingEvidence key={finding.id} finding={finding} issue={issue} />
              ))}
              {!evidence.findings.length && <p>No findings on this page.</p>}
            </section>
            {evidence.history_total > 0 && (
              <details>
                <summary>Previous findings · {evidence.history_total}</summary>
                <div className="space-y-3">
                  {evidence.history.map((finding) => (
                    <FindingEvidence key={finding.id} finding={finding} issue={issue} />
                  ))}
                </div>
              </details>
            )}
            {evidence.action_total > 0 && (
              <section className="space-y-3" aria-label="Retained review actions">
                <h4>Actions · {evidence.action_total}</h4>
                {evidence.actions.map((action) => (
                  <Card key={action.id} size="sm">
                    <CardHeader>
                      <CardTitle>
                        {words(action.kind)}{" "}
                        <StatusBadge tone={statusTone(action.status)}>
                          {words(action.status)}
                        </StatusBadge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p>
                        Authority:{" "}
                        {action.authority === "manual"
                          ? "Explicit approval"
                          : words(action.authority)}
                      </p>
                      {action.schema_version === 2 && (
                        <p>Submission: {words(action.submission.stage)}</p>
                      )}
                      {action.schema_version === 2 && action.preflight && (
                        <output>
                          {action.preflight.retryable
                            ? "Preflight retry available"
                            : "Preflight refused"}
                          : {action.preflight.reason}
                          {action.preflight.next_check_at !== undefined &&
                            ` · Recheck due ${new Date(action.preflight.next_check_at).toLocaleString()}`}
                        </output>
                      )}
                      <Evidence>
                        {action.result && <Markdown text={action.result} />}
                        <p>
                          Head: <code>{action.head}</code>
                        </p>
                        <p>Updated {new Date(action.updated_at).toLocaleString()}</p>
                      </Evidence>
                    </CardContent>
                  </Card>
                ))}
              </section>
            )}
            {evidence.external_validation && (
              <ExternalEvidence
                record={evidence.external_validation}
                title="Current external validation"
              />
            )}
            {evidence.external_history.map((record) => (
              <ExternalEvidence
                key={record.nonce}
                record={record}
                title="Retained external validation"
              />
            ))}
            {!evidence.external_validation && !evidence.external_history_total && (
              <p>No retained external validation. Its outcome is unavailable.</p>
            )}
            <nav aria-label="Review and check pages" className="button-row">
              <Button variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>
                Previous evidence
              </Button>
              <Button variant="outline" disabled={!next} onClick={() => setPage(page + 1)}>
                Next evidence
              </Button>
            </nav>
          </div>
        );
      }}
    </RequestState>
  );
}
function FindingEvidence({
  finding,
  issue,
}: {
  finding: Page["findings"][number];
  issue: IssueId;
}) {
  return (
    <FindingCard finding={finding} issue={issue}>
      {finding.review_state && <p>Review disposition: {words(finding.review_state)}</p>}
      <Evidence>
        {finding.path && <p>Path: {finding.path}</p>}
        {finding.author && <p>Author: {finding.author}</p>}
        {finding.logs && (
          <details>
            <summary>Retained check logs</summary>
            <pre className="whitespace-pre-wrap break-all">{finding.logs}</pre>
          </details>
        )}
        <p>
          Assessed head <code>{finding.head}</code>
        </p>
      </Evidence>
    </FindingCard>
  );
}
function ExternalEvidence({
  record,
  title,
}: {
  record: NonNullable<Page["external_validation"]>;
  title: string;
}) {
  const observation = record.observation;
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>
          {title} <StatusBadge tone={statusTone(record.status)}>{words(record.status)}</StatusBadge>
        </CardTitle>
        <CardDescription>
          {observation?.outcome
            ? `Observed outcome: ${words(observation.outcome)}`
            : "No terminal outcome recorded"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p>Custody: {words(record.custody)}</p>
        {record.error && <output>{record.error}</output>}
        {observation?.gate && (
          <section>
            <h4>Awaiting approval · {words(observation.gate.step)}</h4>
            {observation.gate.summary && <p>{observation.gate.summary}</p>}
            {observation.gate.risk && <p>{observation.gate.risk}</p>}
            {observation.gate.findings.map((finding) => (
              <details key={finding.id}>
                <summary>
                  {finding.severity} · {finding.description}
                </summary>
                <p>
                  {finding.file} · {finding.action}
                </p>
              </details>
            ))}
          </section>
        )}
        {observation?.run && (
          <>
            <p>Native run: {words(observation.run.status)}</p>
            <ol>
              {observation.run.steps.map((step) => (
                <li key={step.step}>
                  {words(step.step)} · {words(step.status)} · {step.findings} findings
                </li>
              ))}
            </ol>
          </>
        )}
        <Evidence>
          <p>
            Submitted head: <code>{record.submitted_head}</code>
          </p>
          <p>Observed {new Date(record.observed_at).toLocaleString()}</p>
          <p>
            {record.adoption
              ? `Adopted head: ${record.adoption.head}`
              : "No adoption receipt recorded"}
          </p>
          {record.responses.map((response) => (
            <p key={response.id}>
              {words(response.step)} · {words(response.action)} · {words(response.status)}
            </p>
          ))}
        </Evidence>
      </CardContent>
    </Card>
  );
}
