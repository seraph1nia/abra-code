import { DateTime } from "effect";
import type { SessionMessage } from "@opencode/schema/session-message";
import type { TranscriptMessage } from "@abracode/contracts/web/contracts";
import type {
  TranscriptTool,
  ToolPresentation,
} from "@abracode/contracts/web/presentation-contracts";
import { Timestamp } from "../../identities.ts";
const text = (value: string) =>
  value.length > 65536
    ? value.slice(0, 65536) + "\n[Native text limited to 64 Ki characters]"
    : value;
const time = (at: DateTime.Utc) => DateTime.formatIso(at);
export type ToolPresenter = (
  name: string,
  input: unknown,
  content: SessionMessage.ToolStateCompleted["content"],
  observedAt: Timestamp | undefined,
) => ToolPresentation | undefined;
const jsonText = (value: unknown) =>
  JSON.stringify(value, (key, v) => (key === "native" ? undefined : v), 2);
function projectTool(
  tool: SessionMessage.AssistantTool,
  observedAt: Timestamp | undefined,
  present?: ToolPresenter,
): TranscriptTool {
  const state = tool.state;
  const input = state.status === "streaming" ? state.input : jsonText(state.input);
  const presentation =
    state.status === "completed"
      ? present?.(tool.name, state.input, state.content, observedAt)
      : undefined;
  const result =
    state.status === "error"
      ? state.error.message
      : state.status === "completed" && !presentation
        ? state.content
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("\n")
        : undefined;
  return {
    id: tool.id,
    name: tool.name,
    status: state.status,
    input: input?.slice(0, 4096),
    result: result?.slice(0, 8192),
    presentation,
    limited: (input?.length ?? 0) > 4096 || (result?.length ?? 0) > 8192,
  };
}
/** Explicit projection keeps provider replay/hidden reasoning out of the browser. */
export function projectNativeMessage(
  message: SessionMessage.Info,
  present?: ToolPresenter,
): TranscriptMessage | undefined {
  const base = { id: message.id, at: time(message.time.created) };
  if (message.type === "user")
    return {
      ...base,
      role: "user",
      text: message.text,
      files: message.files?.map(
        (f) => f.name ?? (f.source.type === "uri" ? f.source.uri : "Attachment"),
      ),
    };
  if (message.type === "assistant") {
    const tools = message.content
      .filter((part) => part.type === "tool")
      .map((part) =>
        projectTool(
          part,
          part.time.completed ? Timestamp.make(time(part.time.completed)) : undefined,
          present,
        ),
      );
    return {
      ...base,
      role: "assistant",
      text: message.content
        .filter((c) => c.type === "text")
        .map((c) => text(c.text))
        .join("\n"),
      tools,
      parts: message.content.flatMap((part): NonNullable<TranscriptMessage["parts"]> =>
        part.type === "text"
          ? [{ type: "text", text: text(part.text) }]
          : part.type === "tool"
            ? [{ type: "tool", tool_id: part.id }]
            : [],
      ),
    };
  }
  if (message.type === "system" || message.type === "synthetic")
    return { ...base, role: "system", text: message.description ?? message.text };
  if (message.type === "compaction")
    return { ...base, role: "system", text: `Conversation compaction: ${message.status}` };
  return undefined;
}
