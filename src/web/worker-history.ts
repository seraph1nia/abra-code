import { Schema } from "effect";
import { IssueId, SessionId, Timestamp } from "../identities.ts";
import { TranscriptMessageSchema } from "./workspace-wire.ts";
import type { TranscriptMessage } from "./contracts.ts";

export const WorkerHistoryQuery = Schema.Struct({
  issue_id: IssueId,
  session_id: SessionId,
  cursor: Schema.optional(Schema.String.check(Schema.isMaxLength(4096))),
});
export const WorkerHistoryMessageSchema = Schema.Struct({
  ...TranscriptMessageSchema.fields,
  limited: Schema.Boolean,
});
export const WorkerHistoryPageSchema = Schema.Struct({
  session_id: SessionId,
  observed_at: Timestamp,
  messages: Schema.Array(WorkerHistoryMessageSchema).check(Schema.isMaxLength(8)),
  older: Schema.optional(Schema.String.check(Schema.isMaxLength(4096))),
}).check(
  Schema.makeFilter(
    (page) =>
      new TextEncoder().encode(JSON.stringify(page)).length <= 512 * 1024 ||
      "Worker transcript page exceeds 512 KiB",
  ),
);

const encoder = new TextEncoder();
function excerpt(text: string, limit: number) {
  let size = 0,
    result = "";
  for (const character of text) {
    size += encoder.encode(character).length;
    if (size > limit) break;
    result += character;
  }
  return result;
}
/** Existing visible-message projection runs first; this adds page/excerpt bounds, never replay. */
export function workerHistoryMessage(
  message: TranscriptMessage,
): typeof WorkerHistoryMessageSchema.Type {
  let limited = false;
  const tools = message.tools?.slice(0, 8).map((tool) => {
    const input = tool.input === undefined ? undefined : excerpt(tool.input, 1024);
    const result = tool.result === undefined ? undefined : excerpt(tool.result, 2048);
    const presentation =
      tool.presentation && encoder.encode(JSON.stringify(tool.presentation)).length <= 2048
        ? tool.presentation
        : undefined;
    const truncated =
      input !== tool.input || result !== tool.result || presentation !== tool.presentation;
    limited ||= truncated || !!tool.limited;
    return { ...tool, input, result, presentation, limited: truncated || tool.limited };
  });
  limited ||=
    (message.tools?.length ?? 0) > (tools?.length ?? 0) || (message.files?.length ?? 0) > 8;
  let remaining = 8192;
  const parts = message.parts
    ?.slice(0, 32)
    .flatMap((part): NonNullable<TranscriptMessage["parts"]> => {
      if (part.type === "tool")
        return tools?.some((tool) => tool.id === part.tool_id) ? [part] : [];
      const text = excerpt(part.text, remaining);
      remaining -= encoder.encode(text).length;
      limited ||= text !== part.text;
      return text ? [{ type: "text" as const, text }] : [];
    });
  const text = parts
    ? parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")
    : excerpt(message.text, 8192);
  limited ||= (!parts && text !== message.text) || (message.parts?.length ?? 0) > 32;
  return { ...message, text, parts, tools, files: message.files?.slice(0, 8), limited };
}
