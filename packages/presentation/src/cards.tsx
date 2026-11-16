import type { ReactNode } from "react";
import type { ResourceSelection } from "@abracode/contracts/web/resources";
import type {
  TaskCardSchema,
  SessionCardSchema,
  FindingCardSchema,
  CommunicationCardSchema,
} from "@abracode/contracts/web/presentation-contracts";
import type { DecisionSchema, ArtifactSummarySchema } from "@abracode/contracts/web/wire";
import type { IssueId } from "@abracode/contracts/identities";
import { phaseLabel } from "@abracode/contracts/presentation/work-state";
import { actionable } from "@abracode/contracts/workflow/feedback-contracts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./ui/card.tsx";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";

export type Inspect = (target: ResourceSelection) => void;
const words = (value: string) => value.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
const role = (value: string) =>
  ({
    explore: "Planning worker",
    apply: "Implementation worker",
    review: "Review worker",
    research: "Research worker",
  })[value] ?? words(value);
export function Evidence({ children }: { children: ReactNode }) {
  return (
    <details className="presentation-evidence">
      <summary>Evidence & provenance</summary>
      <div>{children}</div>
    </details>
  );
}
function Frame({
  kind,
  title,
  status,
  description,
  children,
}: {
  kind: string;
  title: string;
  status?: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card size="sm" className="presentation-card" data-presentation={kind}>
      <CardHeader>
        <div className="presentation-heading">
          <CardTitle>{title}</CardTitle>
          {status && <Badge variant="secondary">{status}</Badge>}
        </div>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
export function TaskCard({
  task,
  inspect,
}: {
  task: typeof TaskCardSchema.Type;
  inspect?: Inspect;
}) {
  const status =
    task.issue_status === "closed"
      ? "Closed"
      : task.outcome?.cleanup.state === "blocked"
        ? "Cleanup blocked"
        : task.phase
          ? phaseLabel(task.phase)
          : task.issue_status
            ? words(task.issue_status)
            : "Observation unavailable";
  return (
    <Frame
      kind="task"
      title={task.title ?? "Task"}
      status={status}
      description={task.progress?.summary ?? task.outcome?.next_action}
    >
      {inspect && (
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            inspect({ action: "open_task", issue_id: task.issue_id, section: "summary" })
          }
        >
          Inspect task
        </Button>
      )}
      <Evidence>
        <p>
          Task: <code>{task.issue_id}</code>
        </p>
        {task.generation !== undefined && <p>Generation {task.generation}</p>}
        {task.supervision && (
          <p>
            Native activity: {words(task.supervision.native_activity)} · Observed{" "}
            <time dateTime={task.supervision.observed_at}>{task.supervision.observed_at}</time>
          </p>
        )}
        {task.outcome && <OutcomeSummary outcome={task.outcome} />}
      </Evidence>
    </Frame>
  );
}
export function OutcomeSummary({
  outcome,
}: {
  outcome: NonNullable<(typeof TaskCardSchema.Type)["outcome"]>;
}) {
  return (
    <dl className="outcome-summary">
      <dt>Approval</dt>
      <dd>{words(outcome.approval.state)}</dd>
      <dt>Delivery</dt>
      <dd>{words(outcome.delivery.state)}</dd>
      <dt>Cleanup</dt>
      <dd>{words(outcome.cleanup.state)}</dd>
      <dt>Issue closure</dt>
      <dd>{words(outcome.closure)}</dd>
    </dl>
  );
}
export function DecisionCard({
  decision,
  issue,
  inspect,
  children,
}: {
  decision: typeof DecisionSchema.Type;
  issue?: IssueId;
  inspect?: Inspect;
  children?: ReactNode;
}) {
  return (
    <Frame
      kind="decision"
      title={decision.question}
      status={words(decision.status)}
      description={
        decision.status === "open"
          ? decision.owner === "user"
            ? "Your answer is needed"
            : "Abra's answer is needed"
          : `Answer owner: ${decision.owner === "user" ? "you" : "Abra"}`
      }
    >
      {inspect && issue && (
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            inspect({
              action: "open_decision",
              issue_id: issue,
              key: decision.key,
              generation: decision.generation,
            })
          }
        >
          Inspect decision
        </Button>
      )}
      {children}
      <Evidence>
        <p>{decision.scope}</p>
        {decision.answer && <p>Answer: {decision.answer}</p>}
        <p>
          Decision: <code>{decision.key}</code> · Generation {decision.generation}
        </p>
      </Evidence>
    </Frame>
  );
}
export function CommunicationCard({
  entry,
  issue,
  inspect,
  children,
}: {
  entry: typeof CommunicationCardSchema.Type;
  issue: IssueId;
  inspect?: Inspect;
  children?: ReactNode;
}) {
  const decision = entry.source?.type === "decision" ? entry.source : undefined;
  const status = entry.finding
    ? "Finding retained"
    : entry.status === "admitted"
      ? entry.response && entry.response !== "none"
        ? "Admitted; awaiting response"
        : "Admitted"
      : entry.status === "acknowledged" && entry.response === "answer"
        ? "Acknowledged; awaiting answer"
        : words(entry.status ?? "unavailable");
  return (
    <Frame
      kind="communication"
      title={entry.finding ? `${role(entry.role)} → Abra` : `Abra → ${role(entry.role)}`}
      status={status}
      description={entry.body ?? "Retained request"}
    >
      {inspect && (
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            inspect({
              action: "open_task",
              issue_id: issue,
              section: "activity",
              activity: "communication",
            })
          }
        >
          Inspect communication
        </Button>
      )}
      {inspect && decision && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            inspect({
              action: "open_decision",
              issue_id: issue,
              key: decision.key,
              generation: entry.generation,
            })
          }
        >
          Existing decision
        </Button>
      )}
      {children}
      <Evidence>
        {entry.reply && <p>Reply: {entry.reply.body}</p>}
        {entry.recovery && (
          <p>Response recovery: {words(entry.recovery)}. Admission does not establish an answer.</p>
        )}
        <p>
          Request: <code>{entry.request_id}</code>
        </p>
        <p>Observed native activity: {words(entry.native_state ?? "unavailable")}</p>
      </Evidence>
    </Frame>
  );
}
export function SessionCard({
  session,
  issue,
  inspect,
}: {
  session: typeof SessionCardSchema.Type;
  issue: IssueId;
  inspect?: Inspect;
}) {
  const model = session.model ?? session.configured_model;
  return (
    <Frame
      kind="session"
      title={role(session.role)}
      status={words(session.native_activity)}
      description={
        model
          ? `${model.providerID} / ${model.id}${model.variant ? ` · ${model.variant}` : ""}`
          : "Model unavailable"
      }
    >
      {inspect && (
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            inspect({ action: "open_session", issue_id: issue, session_id: session.id })
          }
        >
          Inspect session
        </Button>
      )}
      <Evidence>
        <p>{session.note}</p>
        <p>
          Session: <code>{session.id}</code>
        </p>
        <p>
          {session.observed_at ? (
            <>
              Observed <time dateTime={session.observed_at}>{session.observed_at}</time>
            </>
          ) : (
            "Observation time unavailable"
          )}
        </p>
        {session.outcome && <p>Last native turn: {words(session.outcome)}</p>}
      </Evidence>
    </Frame>
  );
}
export function FindingCard({
  finding,
  issue,
  inspect,
  children,
}: {
  finding: typeof FindingCardSchema.Type;
  issue: IssueId;
  inspect?: Inspect;
  children?: ReactNode;
}) {
  return (
    <Frame
      kind="finding"
      title={`${words(finding.kind)} finding`}
      status={
        actionable(finding, finding.head)
          ? "Blocking"
          : finding.disposition
            ? words(finding.disposition.status)
            : "Informational"
      }
      description={finding.text}
    >
      <p>{finding.disposition ? words(finding.disposition.status) : "Awaiting classification"}</p>
      {inspect && (
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            inspect({
              action: "open_task",
              issue_id: issue,
              section: "activity",
              activity: "checks",
            })
          }
        >
          Inspect reviews & checks
        </Button>
      )}
      {children}
      <Evidence>
        {finding.evidence_unavailable && <p>{finding.evidence_unavailable}</p>}
        {finding.disposition && <p>{finding.disposition.reason}</p>}
        <p>
          Finding: <code>{finding.id}</code>
        </p>
      </Evidence>
    </Frame>
  );
}
export function ArtifactCard({
  artifact,
  issue,
  inspect,
}: {
  artifact: typeof ArtifactSummarySchema.Type;
  issue: IssueId;
  inspect?: Inspect;
}) {
  const hash = artifact.hash;
  return (
    <Frame
      kind="artifact"
      title={artifact.title ?? "Saved report"}
      status={words(artifact.status)}
      description={
        artifact.format === "a2ui-snapshot"
          ? "Saved JSON evidence snapshot"
          : "Retained HTML report"
      }
    >
      <p>
        {artifact.captured_at ? (
          <>
            Captured{" "}
            <time dateTime={artifact.captured_at}>
              {new Date(artifact.captured_at).toLocaleString()}
            </time>
          </>
        ) : (
          "Capture time unavailable"
        )}
      </p>
      {inspect && hash && artifact.status === "published" && (
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            inspect({
              action: "open_artifact",
              issue_id: issue,
              request_id: artifact.request_id,
              hash,
            })
          }
        >
          Open report
        </Button>
      )}
      <Evidence>
        {artifact.error && <p>{artifact.error}</p>}
        <p>
          Request: <code>{artifact.request_id}</code>
        </p>
        {hash && (
          <p>
            Content: <code>{hash}</code>
          </p>
        )}
      </Evidence>
    </Frame>
  );
}
