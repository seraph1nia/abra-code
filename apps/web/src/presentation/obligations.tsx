import { PaginationBar } from "../pagination-bar.tsx";
import { ArrowUpRight } from "@abracode/presentation/icons";
import type { EvidenceReferenceSchema } from "@abracode/contracts/workflow/report-contracts";
import { useState, type ReactNode } from "react";
import { useSearch } from "@tanstack/react-router";
import { Markdown } from "../markdown.tsx";
import type { IssueId } from "@abracode/contracts/identities";
import type {
  DeclaredWaitSchema,
  DecisionSchema,
  MessagesPageSchema,
} from "@abracode/contracts/web/wire";
import type { AttentionForm } from "@abracode/contracts/web/contracts";
import { communicationSummary } from "@abracode/contracts/web/presentation-contracts";
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
import {
  CommunicationCard,
  DecisionCard,
  Evidence,
  type Inspect,
} from "@abracode/presentation/cards";
const words = (value: string) => value.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
function Body({ children }: { children: string }) {
  return <Markdown content={children} mode="static" className="prose" />;
}
function Disclosure({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="presentation-evidence">
      <summary>{title}</summary>
      {children}
    </details>
  );
}
export function DecisionsPanel({
  issue,
  forms,
  focusForm,
}: {
  issue: IssueId;
  forms: readonly AttentionForm[];
  focusForm: (id: string, binding?: string) => void;
}) {
  const route = useSearch({ from: "__root__" });
  const target = route.resource?.action === "open_decision" ? route.resource : undefined;
  return (
    <RequestState query={queries.decisions(issue)}>
      {(page) => {
        const selected = target
          ? page.decisions.filter((d) => d.key === target.key && d.generation === target.generation)
          : page.decisions.filter((decision) => decision.status === "open");
        const history = page.decisions.filter((decision) => decision.status !== "open");
        return (
          <div className="space-y-4">
            {target && !selected.length && (
              <output>This retained decision generation is unavailable.</output>
            )}
            {!target && !selected.length && <p>No retained decisions.</p>}
            {selected.map((decision) => (
              <DecisionRow
                key={`${decision.key}/${decision.generation}`}
                decision={decision}
                forms={forms}
                focusForm={focusForm}
              />
            ))}
            {!target && history.length > 0 && (
              <details>
                <summary>Resolved decision history · {history.length}</summary>
                <div className="space-y-3">
                  {history.map((decision) => (
                    <DecisionRow
                      key={`${decision.key}/${decision.generation}`}
                      decision={decision}
                      forms={forms}
                      focusForm={focusForm}
                    />
                  ))}
                </div>
              </details>
            )}
            {page.waits.length > 0 && (
              <section className="space-y-3" aria-label="Declared waits">
                <h3>Waits</h3>
                {page.waits.map((wait) => (
                  <WaitCard key={`${wait.key}/${wait.generation}`} wait={wait} />
                ))}
              </section>
            )}
          </div>
        );
      }}
    </RequestState>
  );
}
function DecisionRow({
  decision,
  forms,
  focusForm,
}: {
  decision: typeof DecisionSchema.Type;
  forms: readonly AttentionForm[];
  focusForm: (id: string, binding?: string) => void;
}) {
  return (
    <section data-decision-key={decision.key}>
      <DecisionCard decision={decision}>
        {decision.status === "open" &&
          decision.owner === "user" &&
          (forms.some((item) => item.active && item.form.id === decision.form_id) ? (
            <Button
              variant="outline"
              onClick={() =>
                focusForm(
                  decision.form_id!,
                  forms.find((item) => item.active && item.form.id === decision.form_id)?.binding,
                )
              }
            >
              Answer in native form
            </Button>
          ) : (
            <output>
              The current native answer form is unavailable. Ask Abra to reconcile this existing
              decision.
            </output>
          ))}
      </DecisionCard>
    </section>
  );
}
function WaitCard({ wait }: { wait: typeof DeclaredWaitSchema.Type }) {
  return (
    <Card size="sm" data-presentation="wait">
      <CardHeader>
        <CardTitle>
          {words(wait.kind)} wait{" "}
          <StatusBadge tone={statusTone(wait.status)}>{words(wait.status)}</StatusBadge>
        </CardTitle>
        <CardDescription>Owner: {wait.owner}</CardDescription>
      </CardHeader>
      <CardContent>
        <p>{wait.condition}</p>
        <Evidence>
          <p>
            Reference: <code>{wait.reference}</code>
          </p>
          {wait.evidence && <Body>{wait.evidence}</Body>}
          <p>
            {wait.expires_at !== undefined
              ? `Expires ${new Date(wait.expires_at).toLocaleString()}`
              : "Expiry observation unavailable"}
          </p>
          {wait.next_check_at !== undefined && (
            <p>Next observation {new Date(wait.next_check_at).toLocaleString()}</p>
          )}
          <p>Generation {wait.generation}</p>
        </Evidence>
      </CardContent>
    </Card>
  );
}
export function CommunicationPanel({ issue, inspect }: { issue: IssueId; inspect: Inspect }) {
  const [offset, setOffset] = useState(0);
  return (
    <RequestState query={queries.messages(issue, offset)}>
      {(page) => (
        <>
          <p>
            {page.outstanding} unanswered · {page.total} retained
          </p>
          <p className="muted">Observed {new Date(page.observed_at).toLocaleString()}</p>
          <div className="space-y-4">
            {page.entries.map((entry) => (
              <Thread key={entry.record.request_id} entry={entry} issue={issue} inspect={inspect} />
            ))}
          </div>
          {!page.entries.length && <p>No retained communication on this page.</p>}
          <PaginationBar
            label="Communication pages"
            previousLabel="Previous communication"
            nextLabel="Next communication"
            previous={offset ? () => setOffset(Math.max(0, offset - page.limit)) : undefined}
            next={page.next_offset === undefined ? undefined : () => setOffset(page.next_offset!)}
          />
        </>
      )}
    </RequestState>
  );
}
function Thread({
  entry,
  issue,
  inspect,
}: {
  entry: (typeof MessagesPageSchema.Type.entries)[number];
  issue: IssueId;
  inspect: Inspect;
}) {
  const record = entry.record;
  return (
    <CommunicationCard entry={communicationSummary(entry)} issue={issue}>
      <Disclosure title="Request body & replies">
        <Body>{record.body ?? "This legacy request has no separately captured display body."}</Body>
        {record.type === "finding" ? (
          <>
            <p>Finding retained for Abra.</p>
            <EvidenceReferences references={record.evidence} />
          </>
        ) : (
          <>
            <p>
              Response required:{" "}
              {record.response === "answer"
                ? "Answer"
                : record.response === "acknowledgement"
                  ? "Acknowledgement"
                  : record.response === "none"
                    ? "None"
                    : "Not recorded"}
            </p>
            {record.acknowledged_at && (
              <p>Acknowledged {new Date(record.acknowledged_at).toLocaleString()}</p>
            )}
            {record.reply ? (
              <>
                <h4>Retained answer</h4>
                <Body>{record.reply.body}</Body>
                <EvidenceReferences references={record.reply.evidence} />
                <p>{new Date(record.reply.at).toLocaleString()}</p>
              </>
            ) : (
              <p>No retained answer.</p>
            )}
            <p>Original native admission: {entry.native ?? "unavailable"}</p>
            <p>
              Observed native turn: {entry.native_state ? words(entry.native_state) : "Unavailable"}
              {entry.native_outcome ? ` · ${words(entry.native_outcome)}` : ""}
            </p>
            {record.response_recovery && (
              <p>
                Response recovery: {words(record.response_recovery.status)} · Native admission{" "}
                {entry.recovery_native ?? "unavailable"}. A recovery admission does not establish an
                answer.
              </p>
            )}
            {entry.escalation && (
              <div>
                <p>Response escalation: {words(entry.escalation.status)}</p>
                <Body>{entry.escalation.evidence}</Body>
                {entry.escalation.disposition && <p>Disposition: {entry.escalation.disposition}</p>}
              </div>
            )}
          </>
        )}
        {entry.decision ? (
          <Button
            variant="outline"
            onClick={() =>
              inspect({
                action: "open_decision",
                issue_id: issue,
                key: entry.decision!.key,
                generation: entry.decision!.generation,
              })
            }
          >
            Open existing decision
          </Button>
        ) : (
          record.type !== "finding" &&
          record.source?.type === "decision" && (
            <p>The referenced decision is unavailable; no replacement question was created.</p>
          )
        )}
      </Disclosure>
    </CommunicationCard>
  );
}

function EvidenceReferences({
  references,
}: {
  references: readonly (typeof EvidenceReferenceSchema.Type)[];
}) {
  return references.length ? (
    <ul aria-label="Retained source evidence">
      {references.map((reference, index) => (
        <li key={index}>
          {reference.path && (
            <span>
              {reference.path}
              {reference.line ? `:${reference.line}` : ""} at <code>{reference.base}</code>
            </span>
          )}
          {reference.url && (
            <a href={reference.url} target="_blank" rel="noreferrer">
              Source evidence <ArrowUpRight aria-hidden="true" />
            </a>
          )}
        </li>
      ))}
    </ul>
  ) : null;
}
