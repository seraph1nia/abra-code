import { createContext, useContext } from "react";
import { useRenderTool, useRenderToolCall } from "@copilotkit/react-core/v2/headless";
import type {
  TranscriptTool,
  ToolPresentation,
} from "@abracode/contracts/web/presentation-contracts";
import { nativeToolCall, nativeToolMessage } from "@abracode/contracts/web/transcript";
import type { PresentationAttachmentSchema } from "@abracode/contracts/presentation/contracts";
import type { WebWorkItem } from "@abracode/contracts/web/wire";
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

const ObservationContext = createContext<
  | {
      tool: TranscriptTool;
      inspect: Inspect;
      work: readonly WebWorkItem[];
      attachments: readonly (typeof PresentationAttachmentSchema.Type)[];
    }
  | undefined
>(undefined);
function Presentation({ value, inspect }: { value: ToolPresentation; inspect: Inspect }) {
  switch (value.kind) {
    case "tasks":
      return (
        <>
          {value.tasks.map((task) => (
            <TaskCard key={task.issue_id} task={task} inspect={inspect} />
          ))}
          {value.limited && (
            <p className="muted">
              Showing {value.tasks.length} of {value.total} tasks. Search Work for the rest.
            </p>
          )}
        </>
      );
    case "decision":
      return <DecisionCard decision={value.decision} issue={value.issue_id} inspect={inspect} />;
    case "communication":
      return (
        <>
          {value.entries.map((entry) => (
            <CommunicationCard
              key={entry.request_id}
              entry={entry}
              issue={value.issue_id}
              inspect={inspect}
            />
          ))}
          <p className="muted">
            {value.outstanding} unanswered · {value.total} retained
            {value.limited ? " · Excerpts shown; inspect full evidence" : ""}
          </p>
        </>
      );
    case "sessions":
      return (
        <>
          {value.sessions.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              issue={value.issue_id}
              inspect={inspect}
            />
          ))}
          {value.sessions.length < value.total && (
            <p className="muted">
              Showing {value.sessions.length} of {value.total} sessions.
            </p>
          )}
        </>
      );
    case "findings":
      return (
        <>
          {value.findings.map((finding) => (
            <FindingCard
              key={finding.id}
              finding={finding}
              issue={value.issue_id}
              inspect={inspect}
            />
          ))}
          <p className="muted">
            Showing {value.findings.length} of {value.total} findings
            {value.limited ? " · Excerpts shown" : ""}
          </p>
        </>
      );
    case "artifacts":
      return (
        <>
          {value.artifacts.map((artifact) => (
            <ArtifactCard
              key={artifact.request_id}
              artifact={artifact}
              issue={value.issue_id}
              inspect={inspect}
            />
          ))}
        </>
      );
    case "surface":
      return null;
  }
}
function ObservedTool({ toolCallId }: { toolCallId: string }) {
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
      {tool.presentation ? (
        <div className="inline-presentations">
          <Presentation value={tool.presentation} inspect={inspect} />
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
            attachment.target.kind === "artifact" && tool.presentation?.kind !== "artifacts",
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

/** Render-only registry: no handler, parameter registration, follow-up or model tool. */
export function useNativeToolRendering() {
  useRenderTool(
    {
      name: "*",
      render: ({ toolCallId }: { toolCallId: string }) => <ObservedTool toolCallId={toolCallId} />,
    },
    [],
  );
}
export function ToolObservation({
  messageID,
  tool,
  inspect,
  work,
  attachments,
}: {
  messageID: string;
  tool: TranscriptTool;
  inspect: Inspect;
  work: readonly WebWorkItem[];
  attachments: readonly (typeof PresentationAttachmentSchema.Type)[];
}) {
  const render = useRenderToolCall();
  return (
    <ObservationContext.Provider value={{ tool, inspect, work, attachments }}>
      <div data-native-renderer="copilotkit">
        {render({
          toolCall: nativeToolCall(tool),
          toolMessage: nativeToolMessage(messageID, tool),
        })}
      </div>
    </ObservationContext.Provider>
  );
}
