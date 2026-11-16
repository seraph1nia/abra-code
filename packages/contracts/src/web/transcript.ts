import { EventType, type Event, type Message, type ToolCall, type ToolMessage } from "@ag-ui/core";
import type { TranscriptMessage } from "./contracts.ts";
import type { TranscriptTool } from "./presentation-contracts.ts";

export const orderedParts = (message: TranscriptMessage): NonNullable<TranscriptMessage["parts"]> =>
  message.parts ?? [
    ...(message.text ? [{ type: "text" as const, text: message.text }] : []),
    ...(message.tools ?? []).map((tool) => ({ type: "tool" as const, tool_id: tool.id })),
  ];
export function nativeToolCall(tool: TranscriptTool): ToolCall {
  return {
    id: tool.id,
    type: "function",
    function: { name: tool.name, arguments: tool.input ?? "{}" },
    metadata: { abracode_native_status: tool.status },
  };
}
export function nativeToolMessage(
  messageID: string,
  tool: TranscriptTool,
): ToolMessage | undefined {
  if (tool.status !== "completed" && tool.status !== "error") return undefined;
  return {
    id: `${messageID}:tool:${tool.id}:result`,
    role: "tool",
    toolCallId: tool.id,
    content: tool.presentation ? JSON.stringify(tool.presentation) : (tool.result ?? ""),
    ...(tool.status === "error" ? { error: tool.result ?? "Native tool failed" } : {}),
    metadata: { abracode_native_message_id: messageID, abracode_native_status: tool.status },
  };
}

/** AG-UI has one text block followed by calls per assistant message. Split native
 * ordered content into stable display segments, retaining its original first ID
 * and explicit native-message provenance on every derived segment/result. */
export function nativeAguiMessages(messages: readonly TranscriptMessage[]): Message[] {
  return messages.flatMap((message): Message[] => {
    if (message.role !== "assistant")
      return [{ id: message.id, role: message.role, content: message.text }];
    const result: Message[] = [];
    const tools = new Map(message.tools?.map((tool) => [tool.id, tool]));
    let content = "";
    let ordinal = 0;
    const append = (tool?: TranscriptTool) => {
      result.push({
        id: ordinal === 0 ? message.id : `${message.id}:part:${ordinal}`,
        role: "assistant",
        content,
        ...(tool ? { toolCalls: [nativeToolCall(tool)] } : {}),
        metadata: { abracode_native_message_id: message.id, abracode_part: ordinal },
      });
      if (tool) {
        const observation = nativeToolMessage(message.id, tool);
        if (observation) result.push(observation);
      }
      content = "";
      ordinal++;
    };
    for (const part of orderedParts(message)) {
      if (part.type === "text") content += part.text;
      else {
        const tool = tools.get(part.tool_id);
        if (tool) append(tool);
      }
    }
    if (content || !result.length) append();
    return result;
  });
}

/** Append-only visible text uses standard AG-UI deltas. Structural/tool changes
 * recover a complete projection so IDs, tool metadata and part order stay exact. */
export function nativeMessageEvents(
  before: readonly TranscriptMessage[],
  after: readonly TranscriptMessage[],
): Event[] {
  const old = nativeAguiMessages(before),
    next = nativeAguiMessages(after);
  const fallback = (): Event[] => [{ type: EventType.MESSAGES_SNAPSHOT, messages: next }];
  if (old.length > next.length || old.some((message, i) => message.id !== next[i]?.id))
    return fallback();
  const events: Event[] = [];
  for (let i = 0; i < next.length; i++) {
    const message = next[i]!,
      prior = old[i];
    if (JSON.stringify(message) === JSON.stringify(prior)) continue;
    if (message.role !== "assistant" && message.role !== "user" && message.role !== "system")
      return fallback();
    if (
      ("toolCalls" in message && message.toolCalls?.length) ||
      typeof message.content !== "string"
    )
      return fallback();
    let delta = message.content;
    if (prior) {
      const { content: oldText, ...oldFields } = prior;
      const { content: newText, ...newFields } = message;
      if (
        JSON.stringify(oldFields) !== JSON.stringify(newFields) ||
        typeof oldText !== "string" ||
        typeof newText !== "string" ||
        !newText.startsWith(oldText)
      )
        return fallback();
      delta = newText.slice(oldText.length);
    }
    events.push({
      type: EventType.TEXT_MESSAGE_START,
      messageId: message.id,
      role: message.role,
      metadata: message.metadata,
    });
    if (delta) events.push({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: message.id, delta });
    events.push({ type: EventType.TEXT_MESSAGE_END, messageId: message.id });
  }
  return events;
}
