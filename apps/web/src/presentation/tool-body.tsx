import type { WebWorkItem } from "@abracode/contracts/web/wire";
import { actionable } from "@abracode/contracts/workflow/feedback-contracts";
import { useContext, useState, type ReactNode } from "react";
import type { ToolPresentation } from "@abracode/contracts/web/presentation-contracts";
import { SurfaceAttachment, MessageAttachment } from "./attachments.tsx";
import {
  TaskCard,
  DecisionCard,
  CommunicationCard,
  SessionCard,
  FindingCard,
  ArtifactCard,
  type Inspect,
} from "@abracode/presentation/cards";
import { ObservationContext } from "./tool-context.ts";
function ResultList<T>({
  items,
  total,
  noun,
  priority,
  render,
}: {
  items: readonly T[];
  total: number;
  noun: string;
  priority?: (item: T) => boolean;
  render: (item: T) => ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!items.length)
    return total ? (
      <small>
        Showing 0 of {total} {noun}.
      </small>
    ) : (
      <p>No {noun} in this observation.</p>
    );
  const index = priority ? Math.max(0, items.findIndex(priority)) : 0;
  return (
    <>
      {render(items[index]!)}
      {items.length > 1 && (
        <details onToggle={(event) => setExpanded(event.currentTarget.open)}>
          <summary>
            {items.length - 1} more {items.length === 2 ? noun.replace(/s$/, "") : noun}
          </summary>
          {expanded && items.filter((_, i) => i !== index).map(render)}
        </details>
      )}
      {items.length < total && (
        <small>
          Showing {items.length} of {total} {noun}.
        </small>
      )}
    </>
  );
}

function Presentation({
  value,
  inspect,
  work,
}: {
  value: ToolPresentation;
  inspect: Inspect;
  work: readonly WebWorkItem[];
}) {
  switch (value.kind) {
    case "tasks":
      return (
        <>
          <ResultList
            items={value.tasks}
            total={value.total}
            noun="tasks"
            priority={(task) => task.issue_status === "blocked" || !!task.outcome?.next_action}
            render={(task) => (
              <TaskCard
                key={task.issue_id}
                task={task}
                current={work.find((w) => w.issue_id === task.issue_id)}
                inspect={inspect}
              />
            )}
          />
          {value.limited && <small>Search Work for full coverage.</small>}
        </>
      );
    case "decision":
      return <DecisionCard decision={value.decision} issue={value.issue_id} inspect={inspect} />;
    case "communication":
      return (
        <>
          <ResultList
            items={value.entries}
            total={value.total}
            noun="communications"
            priority={(entry) => !entry.reply && entry.response === "answer"}
            render={(entry) => (
              <CommunicationCard
                key={entry.request_id}
                entry={entry}
                issue={value.issue_id}
                inspect={inspect}
              />
            )}
          />
          <p className="muted">
            {value.outstanding} unanswered · {value.total} retained
            {value.limited ? " · Excerpts shown; inspect full evidence" : ""}
          </p>
        </>
      );
    case "sessions":
      return (
        <>
          <ResultList
            items={value.sessions}
            total={value.total}
            noun="sessions"
            priority={(session) => !!session.outcome}
            render={(session) => (
              <SessionCard
                key={session.id}
                session={session}
                issue={value.issue_id}
                inspect={inspect}
              />
            )}
          />
        </>
      );
    case "findings":
      return (
        <>
          <ResultList
            items={value.findings}
            total={value.total}
            noun="findings"
            priority={(finding) => actionable(finding, finding.head)}
            render={(finding) => (
              <FindingCard
                key={finding.id}
                finding={finding}
                issue={value.issue_id}
                inspect={inspect}
              />
            )}
          />
          {value.limited && <small>Finding text is excerpted.</small>}
        </>
      );
    case "artifacts":
      return (
        <>
          <ResultList
            items={value.artifacts}
            total={value.total}
            noun="reports"
            priority={(artifact) => artifact.status === "failed"}
            render={(artifact) => (
              <ArtifactCard
                key={artifact.request_id}
                artifact={artifact}
                issue={value.issue_id}
                inspect={inspect}
              />
            )}
          />
        </>
      );
    case "surface":
      return null;
  }
}
export function ObservedTool({ toolCallId }: { toolCallId: string }) {
  const observation = useContext(ObservationContext);
  if (!observation || observation.tool.id !== toolCallId) return null;
  const { tool, inspect } = observation;
  const associated = observation.attachments.find(
    (attachment) => attachment.target.kind === "surface",
  )?.target;
  const surface =
    associated?.kind === "surface"
      ? associated
      : tool.presentation?.kind === "surface"
        ? {
            kind: "surface" as const,
            surface_id: tool.presentation.surface_id,
            revision: tool.presentation.revision,
          }
        : undefined;
  const title = tool.name.replace(/^abra_/, "").replaceAll("_", " ");
  const status = {
    streaming: "Preparing",
    running: "Running",
    completed: "Complete",
    error: "Failed",
  }[tool.status];
  return (
    <section
      className="native-tool-observation"
      data-tool-call-id={tool.id}
      data-tool-state={tool.status}
    >
      {surface ? (
        tool.status === "error" && <small>Publication response unavailable · retained view</small>
      ) : tool.presentation ? (
        <div className="inline-presentations">
          <Presentation value={tool.presentation} work={observation.work} inspect={inspect} />
        </div>
      ) : (
        <details className="tool">
          <summary>
            <span className={`tool-indicator ${tool.status}`} />
            {title}
            <span>{status}</span>
          </summary>
          {tool.result && <pre>{tool.result}</pre>}
          {tool.input && (
            <details>
              <summary>Observed input</summary>
              <pre>{tool.input}</pre>
            </details>
          )}
          {tool.limited && (
            <p className="muted">
              Details are limited to 4,096 input characters and 8,192 output characters.
            </p>
          )}
        </details>
      )}
      {surface && <SurfaceAttachment target={surface} work={observation.work} inspect={inspect} />}
      {observation.attachments
        .filter(
          (attachment) =>
            attachment.target.kind === "review" ||
            (attachment.target.kind === "artifact" && tool.presentation?.kind !== "artifacts"),
        )
        .map((attachment) => (
          <MessageAttachment
            key={JSON.stringify(attachment)}
            attachment={attachment}
            work={observation.work}
            inspect={inspect}
          />
        ))}
    </section>
  );
}
