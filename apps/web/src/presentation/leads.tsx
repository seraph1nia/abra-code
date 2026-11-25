import { useState } from "react";
import { Markdown } from "../markdown.tsx";
import type { IssueId, LeadId, RepositoryId } from "@abracode/contracts/identities";
import type {
  LeadEvidencePageSchema,
  LeadEvidenceQuery,
} from "@abracode/contracts/visibility/lead-observation";
import { queries } from "../work-data.ts";
import { RequestState } from "../request-state.tsx";
import { Button } from "@abracode/presentation/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@abracode/presentation/ui/card";
import { StatusBadge, statusTone } from "@abracode/presentation/cockpit";
import { Evidence, type Inspect } from "@abracode/presentation/cards";
const words = (value: string) => value.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
function Body({ text }: { text: string }) {
  return <Markdown key={text} content={text} mode="static" className="prose" />;
}
type Scope = { issue: IssueId; repository?: never } | { repository: RepositoryId; issue?: never };
export function LeadsPanel({
  issue,
  repository,
  initialLead,
  inspect,
}: Scope & { initialLead?: LeadId; inspect: Inspect }) {
  const scope = issue ? { issue_id: issue } : { repository_id: repository };
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<LeadId | undefined>(initialLead);
  return (
    <div className="space-y-4">
      <h3>Project leads & proposals</h3>
      <RequestState query={queries.leads({ ...scope, offset })}>
        {(page) => (
          <>
            <p>{page.total} leads with configured scope or retained history for this repository.</p>
            {page.diagnostics.map((diagnostic, index) => (
              <output key={index}>{diagnostic}</output>
            ))}
            <div className="space-y-3">
              {page.entries.map((lead) => (
                <Card key={lead.id} size="sm" data-lead-id={lead.id}>
                  <CardHeader>
                    <CardTitle>
                      {lead.id}{" "}
                      <StatusBadge tone={statusTone(lead.state)}>{words(lead.state)}</StatusBadge>
                    </CardTitle>
                    <CardDescription>
                      {lead.model.providerID} / {lead.model.id}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p>
                      {lead.scope === "retained_history"
                        ? "Retained history; this repository is outside the current lead scope."
                        : "Configured for this repository."}
                    </p>
                    <p>
                      {lead.outstanding_count} unanswered · {lead.pending_proposal_count} unaccepted
                      proposals
                    </p>
                    <Button variant="outline" onClick={() => setSelected(lead.id)}>
                      Inspect lead history
                    </Button>
                    <Evidence>
                      <p>Current repository scope: {lead.repositories.join(", ")}</p>
                      <p>Native session: {lead.session_available ? "Available" : "Unavailable"}</p>
                      <p>
                        Observed {new Date(lead.observed_at).toLocaleString()} · Revision{" "}
                        {lead.revision}
                      </p>
                    </Evidence>
                  </CardContent>
                </Card>
              ))}
            </div>
            <nav aria-label="Scoped lead pages" className="button-row">
              <Button
                variant="outline"
                disabled={!offset}
                onClick={() => setOffset(Math.max(0, offset - 20))}
              >
                Previous leads
              </Button>
              <Button
                variant="outline"
                disabled={page.next_offset === undefined}
                onClick={() => {
                  if (page.next_offset !== undefined) setOffset(page.next_offset);
                }}
              >
                Next leads
              </Button>
            </nav>
          </>
        )}
      </RequestState>
      {selected && <LeadDetails key={selected} scope={scope} lead={selected} inspect={inspect} />}
    </div>
  );
}
function LeadDetails({
  scope,
  lead,
  inspect,
}: {
  scope: Pick<typeof LeadEvidenceQuery.Type, "issue_id" | "repository_id">;
  lead: LeadId;
  inspect: Inspect;
}) {
  const [requests, setRequests] = useState(0),
    [proposals, setProposals] = useState(0);
  return (
    <RequestState
      query={queries.leads({
        ...scope,
        lead_id: lead,
        request_offset: requests,
        proposal_offset: proposals,
      })}
    >
      {(page) =>
        page.detail ? (
          <LeadHistory
            detail={page.detail}
            inspect={inspect}
            setRequests={setRequests}
            setProposals={setProposals}
          />
        ) : (
          <output>Retained lead evidence is unavailable.</output>
        )
      }
    </RequestState>
  );
}
function LeadHistory({
  detail,
  inspect,
  setRequests,
  setProposals,
}: {
  detail: NonNullable<typeof LeadEvidencePageSchema.Type.detail>;
  inspect: Inspect;
  setRequests: (offset: number) => void;
  setProposals: (offset: number) => void;
}) {
  return (
    <section aria-label="Retained lead history" className="space-y-4">
      <h4>Lead history</h4>
      <p>
        {detail.request_total} retained requests in this scope · {detail.proposal_total} captured
        proposals for its repository.
      </p>
      {detail.requests.map((request) => (
        <Card size="sm" key={request.request_id}>
          <CardHeader>
            <CardTitle>
              Abra → Project lead{" "}
              <StatusBadge tone={statusTone(request.status)}>{words(request.status)}</StatusBadge>
            </CardTitle>
            <CardDescription>
              {request.reply
                ? "Retained answer available"
                : request.response === "answer"
                  ? "No retained answer"
                  : "Response requirement recorded"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <details>
              <summary>Request & reply</summary>
              <Body text={request.body ?? "No separately captured request body is retained."} />
              {request.reply && (
                <>
                  <h5>Retained answer</h5>
                  <Body text={request.reply.body} />
                </>
              )}
              {request.acknowledged_at && (
                <p>Acknowledged {new Date(request.acknowledged_at).toLocaleString()}</p>
              )}
              {request.recovery && (
                <p>
                  Response recovery: {words(request.recovery)}. Admission does not establish an
                  answer.
                </p>
              )}
              <p>
                Generation {request.generation} · Recipient{" "}
                <code>{request.recipient_session_id}</code>
              </p>
            </details>
          </CardContent>
        </Card>
      ))}
      <nav aria-label="Lead request pages" className="button-row">
        <Button
          variant="outline"
          disabled={!detail.request_offset}
          onClick={() => setRequests(Math.max(0, detail.request_offset - detail.request_limit))}
        >
          Previous lead requests
        </Button>
        <Button
          variant="outline"
          disabled={detail.request_next === undefined}
          onClick={() => {
            if (detail.request_next !== undefined) setRequests(detail.request_next);
          }}
        >
          Next lead requests
        </Button>
      </nav>
      {detail.proposals.map((proposal) => (
        <Card size="sm" key={proposal.request_id}>
          <CardHeader>
            <CardTitle>
              {proposal.accepted ? "Accepted proposal" : "Proposal retained; not accepted"}
            </CardTitle>
            <CardDescription>Captured revision {proposal.revision}</CardDescription>
          </CardHeader>
          <CardContent>
            {proposal.tasks.map((task) => (
              <details key={task.key}>
                <summary>{task.title}</summary>
                <Body text={task.description} />
                <p>
                  {task.policy ?? "Repository workflow default"}
                  {task.priority !== undefined ? ` · Priority ${task.priority}` : ""}
                </p>
                {task.dependencies.length > 0 && (
                  <ul>
                    {task.dependencies.map((dependency, index) => (
                      <li key={index}>
                        {dependency.type === "local"
                          ? `Proposed dependency: ${dependency.client_key}`
                          : `Existing dependency: ${dependency.issue_id}`}
                      </li>
                    ))}
                  </ul>
                )}
                {task.accepted_issue_id && (
                  <Button
                    variant="outline"
                    onClick={() =>
                      inspect({
                        action: "open_task",
                        issue_id: task.accepted_issue_id!,
                        section: "summary",
                      })
                    }
                  >
                    Inspect accepted work
                  </Button>
                )}
                {task.limited && <output>Proposal text is excerpted.</output>}
              </details>
            ))}
          </CardContent>
        </Card>
      ))}
      <nav aria-label="Lead proposal pages" className="button-row">
        <Button
          variant="outline"
          disabled={!detail.proposal_offset}
          onClick={() => setProposals(Math.max(0, detail.proposal_offset - 5))}
        >
          Previous proposals
        </Button>
        <Button
          variant="outline"
          disabled={detail.proposal_next === undefined}
          onClick={() => {
            if (detail.proposal_next !== undefined) setProposals(detail.proposal_next);
          }}
        >
          Next proposals
        </Button>
      </nav>
      <details>
        <summary>Related retained work · {detail.related_total}</summary>
        {detail.related_work.map((work) => (
          <p key={work.issue_id}>
            <Button
              variant="ghost"
              onClick={() =>
                inspect({ action: "open_task", issue_id: work.issue_id, section: "summary" })
              }
            >
              {work.title}
            </Button>{" "}
            · {words(work.issue_status)}
          </p>
        ))}
        {detail.related_work.length < detail.related_total && (
          <output>Related-work preview is limited to 50. Use the work finder for more.</output>
        )}
      </details>
      {detail.retired_sessions.length > 0 && (
        <Evidence>
          <p>Retired lead sessions: {detail.retired_sessions.join(", ")}</p>
        </Evidence>
      )}
    </section>
  );
}
