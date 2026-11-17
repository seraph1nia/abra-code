import { memo, useMemo } from "react";
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
import { MessageAttachment } from "./presentation/attachments.tsx";
export const emptyAttachments: readonly (typeof PresentationAttachmentSchema.Type)[] = [];
export const emptyDiagnostics: readonly (typeof PresentationDiagnosticSchema.Type)[] = [];
export const MessageContent = memo(function MessageContent({
  message,
  work,
  inspect,
  attachments,
  diagnostics,
}: {
  message: TranscriptMessage;
  work: readonly WebWorkItem[];
  inspect: Inspect;
  attachments: readonly (typeof PresentationAttachmentSchema.Type)[];
  diagnostics: readonly (typeof PresentationDiagnosticSchema.Type)[];
}) {
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
    <article className={`message ${message.role}`} data-native-message-id={message.id}>
      <div className="message-avatar">
        {message.role === "user" ? "You" : message.role === "system" ? "·" : "a"}
      </div>
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
                <ToolObservation
                  key={tool.id}
                  messageID={message.id}
                  tool={tool}
                  inspect={inspect}
                  work={work}
                  attachments={byTool.get(tool.id) ?? emptyAttachments}
                />
              ) : null;
            })
          : message.text && <div className="message-text">{message.text}</div>}
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
            <MessageAttachment
              key={JSON.stringify(attachment)}
              attachment={attachment}
              work={work}
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
