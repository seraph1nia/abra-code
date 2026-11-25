import { ThoughtSource } from "./thought-source.tsx";
import type { SubmissionReceipt } from "@abracode/contracts/web/workspace-wire";
import { deferred } from "@abracode/presentation/deferred";
import { selectionMarker, thoughtSubmission } from "@abracode/contracts/web/workspace-wire";
import { createContext, useContext, memo, useMemo } from "react";
import type { TranscriptMessage } from "@abracode/contracts/web/contracts";
import type { WebWorkItem } from "@abracode/contracts/web/wire";
import type {
  PresentationAttachmentSchema,
  PresentationDiagnosticSchema,
} from "@abracode/contracts/presentation/contracts";
import type { Inspect } from "@abracode/presentation/cards";
import { Paperclip } from "@abracode/presentation/icons";
import { orderedParts } from "@abracode/contracts/web/transcript";
import { Markdown } from "./markdown.tsx";
import { ToolObservation } from "./presentation/tools.tsx";
import { attachmentKey } from "./presentation/tool-context.ts";

const MessageAttachment = deferred<
  React.ComponentProps<typeof import("./presentation/attachments.tsx").MessageAttachment>
>(
  () =>
    import("./presentation/attachments.tsx").then((module) => ({
      default: module.MessageAttachment,
    })),
  "Retained presentation",
);
const HistoricalThought = deferred<{ message: TranscriptMessage; request: string }>(
  () => import("./historical-thought.tsx"),
  "Notebook source",
);
const SelectedMessage = deferred<{ message: TranscriptMessage }>(
  () => import("./presentation/selected-message.tsx"),
  "Captured selection",
);
export const TranscriptWork = createContext<readonly WebWorkItem[]>([]);
function TranscriptTool(props: Omit<React.ComponentProps<typeof ToolObservation>, "work">) {
  return <ToolObservation {...props} work={useContext(TranscriptWork)} />;
}
function TranscriptAttachment(props: Omit<React.ComponentProps<typeof MessageAttachment>, "work">) {
  return <MessageAttachment {...props} work={useContext(TranscriptWork)} />;
}
export const emptyAttachments: readonly (typeof PresentationAttachmentSchema.Type)[] = [];
export const emptyDiagnostics: readonly (typeof PresentationDiagnosticSchema.Type)[] = [];
export const MessageContent = memo(function MessageContent({
  message,
  inspect,
  thoughtReceipt,
  attachments,
  diagnostics,
}: {
  message: TranscriptMessage;
  thoughtReceipt?: SubmissionReceipt;
  inspect: Inspect;
  attachments: readonly (typeof PresentationAttachmentSchema.Type)[];
  diagnostics: readonly (typeof PresentationDiagnosticSchema.Type)[];
}) {
  const request =
    message.role === "user" && !thoughtReceipt ? thoughtSubmission(message.text) : undefined;
  const byTool = useMemo(() => {
    const result = new Map<string, (typeof PresentationAttachmentSchema.Type)[]>();
    for (const attachment of attachments) {
      if (!attachment.tool_call_id) continue;
      const entries = result.get(attachment.tool_call_id) ?? [];
      entries.push(attachment);
      result.set(attachment.tool_call_id, entries);
    }
    return result;
  }, [attachments]);
  return (
    <article
      className={`message ${message.role}`}
      tabIndex={-1}
      id={"message-" + message.id}
      data-native-message-id={message.id}
    >
      <div className="message-body">
        <header>
          <strong>
            {message.role === "user" ? "You" : message.role === "system" ? "Session" : "Abra"}
          </strong>
          <time dateTime={message.at}>
            {new Date(message.at).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </time>
        </header>
        {request && <HistoricalThought message={message} request={request} />}
        {message.role === "user" &&
          thoughtReceipt?.thought &&
          thoughtReceipt.message_id === message.id &&
          thoughtReceipt.native_text === message.text &&
          thoughtReceipt.status === "admitted" && (
            <ThoughtSource reference={thoughtReceipt.thought} />
          )}
        {message.role === "assistant"
          ? orderedParts(message).map((part, index) => {
              if (part.type === "text")
                return (
                  <Markdown
                    key={`text-${index}`}
                    className="message-text prose"
                    content={part.text}
                  />
                );
              const tool = message.tools?.find((tool) => tool.id === part.tool_id);
              return tool ? (
                <TranscriptTool
                  key={tool.id}
                  messageID={message.id}
                  tool={tool}
                  inspect={inspect}
                  attachments={byTool.get(tool.id) ?? emptyAttachments}
                />
              ) : null;
            })
          : message.text &&
            (message.role === "user" && message.text.includes(selectionMarker) ? (
              <SelectedMessage message={message} />
            ) : (
              <div className="message-text">
                {thoughtReceipt?.native_text === message.text &&
                thoughtReceipt.message_id === message.id
                  ? thoughtReceipt.text
                  : message.text}
              </div>
            ))}
        {message.files?.map((f) => (
          <p className="attachment" key={f}>
            <Paperclip aria-hidden="true" /> {f}
          </p>
        ))}
        {attachments
          .filter(
            (attachment) =>
              !attachment.tool_call_id ||
              !message.tools?.some((tool) => tool.id === attachment.tool_call_id),
          )
          .map((attachment) => (
            <TranscriptAttachment
              key={attachmentKey(attachment)}
              attachment={attachment}
              inspect={inspect}
            />
          ))}
        {diagnostics.map((diagnostic) => (
          <output key={diagnostic.unavailable} className="error">
            {diagnostic.unavailable}
          </output>
        ))}
      </div>
    </article>
  );
});
