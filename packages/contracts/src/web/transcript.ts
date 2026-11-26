import { EventType, type Event, type Message, type ToolCall, type ToolMessage } from "@ag-ui/core";
import type { TranscriptMessage } from "./contracts.ts";
import { Schema } from "effect";
import { ToolPresentationSchema, type TranscriptTool } from "./presentation-contracts.ts";

export const orderedParts = (message: TranscriptMessage): NonNullable<TranscriptMessage["parts"]> =>
  message.parts ?? [
    ...(message.text ? [{ type: "text" as const, text: message.text }] : []),
    ...(message.tools ?? []).map((tool) => ({ type: "tool" as const, tool_id: tool.id })),
  ];
export function nativeToolCall(tool: TranscriptTool): ToolCall {
  let args = tool.input ?? "{}",
    unavailable = false;
  if (tool.status !== "streaming") {
    try {
      args = JSON.stringify(JSON.parse(args));
    } catch {
      args = "{}";
      unavailable = true;
    }
  } else if (tool.limited) {
    args = "{}";
    unavailable = true;
  }
  return {
    id: tool.id,
    type: "function",
    function: { name: tool.name, arguments: args },
    metadata: {
      abracode_native_status: tool.status,
      ...(tool.limited ? { abracode_limited: true } : {}),
      ...(unavailable
        ? { abracode_arguments_unavailable: true, abracode_limited_input: tool.input }
        : {}),
    },
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
    metadata: {
      abracode_native_message_id: messageID,
      abracode_native_status: tool.status,
      ...(tool.presentation && { abracode_presentation: true }),
    },
  };
}

/** AG-UI has one text block followed by calls per assistant message. Split native
 * ordered content into stable display segments, retaining its original first ID
 * and explicit native-message provenance on every derived segment/result. */
const projectedMessages = new WeakMap<TranscriptMessage, Message[]>();
function projectMessage(message: TranscriptMessage): Message[] {
  const metadata = {
    abracode_native_message_id: message.id,
    abracode_at: message.at,
    ...(message.files && { abracode_files: message.files }),
  };
  if (message.role !== "assistant")
    return [{ id: message.id, role: message.role, content: message.text, metadata }];
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
      metadata: { ...metadata, abracode_part: ordinal },
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
}

export function nativeAguiMessages(messages: readonly TranscriptMessage[]): Message[] {
  return messages.flatMap((message) => {
    let projection = projectedMessages.get(message);
    if (!projection) {
      projection = projectMessage(message);
      projectedMessages.set(message, projection);
    }
    return projection;
  });
}

type ToolEnvelope = { toolCall: ToolCall; toolMessage?: ToolMessage };
const liveTools = new WeakMap<TranscriptTool, ToolEnvelope>();
/** The live reader retains the exact AG-UI call. Older HTTP history supplies
 * native observations, which use the same standard envelope as a baseline. */
export function observedToolEnvelope(messageId: string, tool: TranscriptTool): ToolEnvelope {
  return (
    liveTools.get(tool) ?? {
      toolCall: nativeToolCall(tool),
      toolMessage: nativeToolMessage(messageId, tool),
    }
  );
}
/** Reassemble the native message's ordered display parts from the AG-UI client reducer. */
export function transcriptFromAgent(messages: readonly Message[]): TranscriptMessage[] {
  const results = new Map<string, ToolMessage>();
  for (const message of messages) {
    if (message.role === "tool") results.set(message.id, message);
  }
  const rows = new Map<string, TranscriptMessage>();
  for (const message of messages) {
    if (message.role !== "assistant" && message.role !== "system" && message.role !== "user")
      continue;
    const metadata = message.metadata;
    const id =
      typeof metadata?.abracode_native_message_id === "string"
        ? metadata.abracode_native_message_id
        : message.id;
    const at = typeof metadata?.abracode_at === "string" ? metadata.abracode_at : "";
    const text = typeof message.content === "string" ? message.content : "";
    if (message.role !== "assistant") {
      const files = metadata?.abracode_files;
      rows.set(id, {
        id,
        at,
        role: message.role,
        text,
        ...(Array.isArray(files) && files.every((f) => typeof f === "string") && { files }),
      });
      continue;
    }
    const prior = rows.get(id);
    const parts = [...(prior?.parts ?? [])];
    const tools = [...(prior?.tools ?? [])];
    if (text) parts.push({ type: "text", text });
    for (const call of message.toolCalls ?? []) {
      const result = results.get(`${id}:tool:${call.id}:result`);
      const nativeStatus: unknown = call.metadata?.abracode_native_status;
      const status = result
        ? result.error || result.metadata?.abracode_native_status === "error"
          ? "error"
          : "completed"
        : nativeStatus === "running" || nativeStatus === "completed" || nativeStatus === "error"
          ? nativeStatus
          : "streaming";
      let presentation;
      if (result?.metadata?.abracode_presentation) {
        const decoded = Schema.decodeUnknownResult(Schema.fromJsonString(ToolPresentationSchema))(
          result.content,
        );
        if (decoded._tag === "Success") presentation = decoded.success;
      }
      const observation: TranscriptTool = {
        id: call.id,
        name: call.function.name,
        status,
        input:
          typeof call.metadata?.abracode_limited_input === "string"
            ? call.metadata.abracode_limited_input
            : call.function.arguments,
        limited: call.metadata?.abracode_limited === true,
        ...(presentation
          ? { presentation }
          : result
            ? { result: result.error ?? (typeof result.content === "string" ? result.content : "") }
            : {}),
      };
      liveTools.set(observation, { toolCall: call, toolMessage: result });
      tools.push(observation);
      parts.push({ type: "tool", tool_id: call.id });
    }
    rows.set(id, {
      id,
      at,
      role: "assistant",
      text: [prior?.text, text].filter(Boolean).join("\n"),
      tools,
      parts,
    });
  }
  return [...rows.values()];
}

type OpenTextStream = { id: string; hasContent: boolean };

const metadataSubset = (
  previous: Record<string, unknown> | undefined,
  next: Record<string, unknown> | undefined,
) => {
  if (!previous) return true;
  if (!next) return false;
  return Object.keys(previous).every((key) => key in next);
};

function indexTools(messages: readonly TranscriptMessage[]) {
  const index = new Map<string, Map<string, TranscriptTool>>();
  for (const message of messages)
    for (const tool of message.tools ?? []) {
      let owners = index.get(tool.id);
      if (!owners) index.set(tool.id, (owners = new Map()));
      owners.set(message.id, tool);
    }
  return index;
}
/** Incremental text and tool arguments retain native IDs. Incompatible structure,
 * argument rewrites and native-only result/status fields recover a complete view. */
export function nativeMessageEvents(
  before: readonly TranscriptMessage[],
  after: readonly TranscriptMessage[],
  streaming?: { openText?: OpenTextStream },
): Event[] {
  return diffNativeMessages(
    before,
    after,
    nativeAguiMessages(before),
    nativeAguiMessages(after),
    streaming,
  );
}

function diffNativeMessages(
  before: readonly TranscriptMessage[],
  after: readonly TranscriptMessage[],
  old: readonly Message[],
  next: Message[],
  streaming?: { openText?: OpenTextStream },
): Event[] {
  // A call ID can reappear in another native message. Only changed calls need
  // the ownership index; ordinary text deltas never scan historical tools.
  let previousTools: Map<string, Map<string, TranscriptTool>> | undefined;
  for (const [index, message] of after.entries()) {
    const prior = before[index];
    if (prior === message || !message.tools?.length) continue;
    for (const [offset, tool] of message.tools.entries()) {
      if (prior?.id === message.id && prior.tools?.[offset] === tool) continue;
      previousTools ??= indexTools(before);
      const owners = previousTools.get(tool.id);
      if (!owners || (owners.size === 1 && owners.has(message.id))) continue;
      const previous = owners.get(message.id);
      if (previous !== tool && (!previous || JSON.stringify(previous) !== JSON.stringify(tool)))
        return [{ type: EventType.MESSAGES_SNAPSHOT, messages: next }];
    }
  }
  const snapshot = (): Event => ({ type: EventType.MESSAGES_SNAPSHOT, messages: next });
  if (old.length > next.length || old.some((message, i) => message.id !== next[i]?.id))
    return [snapshot()];
  const events: Event[] = [];
  let reconcile = false;
  let openText: OpenTextStream | undefined = streaming?.openText
    ? { ...streaming.openText }
    : undefined;
  let openTextAdvanced = false;
  const closeOpenText = () => {
    if (!openText) return;
    events.push({ type: EventType.TEXT_MESSAGE_END, messageId: openText.id });
    openText = undefined;
  };
  for (let i = 0; i < next.length; i++) {
    const message = next[i]!,
      prior = old[i];
    if (message === prior) continue;
    if (message.content === prior?.content && JSON.stringify(message) === JSON.stringify(prior))
      continue;
    if (message.role === "tool") {
      if (prior) return [snapshot()];
      closeOpenText();
      events.push({
        type: EventType.TOOL_CALL_RESULT,
        messageId: message.id,
        toolCallId: message.toolCallId,
        content: message.content,
        metadata: message.metadata,
      });
      if (message.error) reconcile = true;
      continue;
    }
    if (message.role !== "assistant" && message.role !== "user" && message.role !== "system")
      return [snapshot()];
    if (
      typeof message.content !== "string" ||
      (prior && (prior.role !== message.role || typeof prior.content !== "string"))
    )
      return [snapshot()];
    const oldText = prior?.content ?? "";
    if (typeof oldText !== "string" || !message.content.startsWith(oldText)) return [snapshot()];
    if (JSON.stringify(prior?.metadata ?? message.metadata) !== JSON.stringify(message.metadata))
      return [snapshot()];
    const delta = message.content.slice(oldText.length);
    const calls = message.role === "assistant" ? (message.toolCalls ?? []) : [];
    const keepOpen =
      streaming !== undefined &&
      message.role === "assistant" &&
      i === next.length - 1 &&
      calls.length === 0;
    if (!prior || delta) {
      if (openText && openText.id !== message.id) closeOpenText();
      if (!openText) {
        events.push({
          type: EventType.TEXT_MESSAGE_START,
          messageId: message.id,
          role: message.role,
          metadata: message.metadata,
        });
        openText = { id: message.id, hasContent: false };
      }
      if (delta) {
        events.push({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: message.id, delta });
        openText.hasContent = true;
        openTextAdvanced = true;
      }
      if (!keepOpen) closeOpenText();
    }
    const previousCalls = prior?.role === "assistant" ? (prior.toolCalls ?? []) : [];
    if (previousCalls.length > calls.length) return [snapshot()];
    for (let c = 0; c < calls.length; c++) {
      const call = calls[c]!,
        previous = previousCalls[c];
      if (
        previous &&
        (previous.id !== call.id ||
          previous.function.name !== call.function.name ||
          !call.function.arguments.startsWith(previous.function.arguments))
      )
        return [snapshot()];
      if (!previous) {
        closeOpenText();
        events.push({
          type: EventType.TOOL_CALL_START,
          toolCallId: call.id,
          toolCallName: call.function.name,
          parentMessageId: message.id,
          metadata: call.metadata,
        });
      }
      const args = call.function.arguments.slice(previous?.function.arguments.length ?? 0);
      if (args) events.push({ type: EventType.TOOL_CALL_ARGS, toolCallId: call.id, delta: args });
      const streamingCall = call.metadata?.abracode_native_status === "streaming";
      const emittedEnd =
        !streamingCall && (!previous || previous.metadata?.abracode_native_status === "streaming");
      if (emittedEnd)
        events.push({
          type: EventType.TOOL_CALL_END,
          toolCallId: call.id,
          metadata: call.metadata,
        });
      if (
        previous &&
        JSON.stringify(previous.metadata) !== JSON.stringify(call.metadata) &&
        !(emittedEnd && metadataSubset(previous.metadata, call.metadata))
      )
        reconcile = true;
    }
  }
  // When an already-streamed open text message receives a no-delta update (e.g.
  // session.text.ended or turn idle), close it cleanly once instead of leaving it dangling.
  if (openText && !openTextAdvanced && openText.hasContent) closeOpenText();
  return reconcile ? [...events, snapshot()] : events;
}

/** Per-observer cursor closes only streams it opened before an authoritative reset. */
export class NativeMessageCursor {
  private previous: readonly TranscriptMessage[] = [];
  private previousAgui: Message[] = [];
  private open = new Set<string>();
  private openText: OpenTextStream | undefined;
  close(): Event[] {
    const output: Event[] = [];
    if (this.openText) {
      output.push({ type: EventType.TEXT_MESSAGE_END, messageId: this.openText.id });
      this.openText = undefined;
    }
    for (const toolCallId of this.open) output.push({ type: EventType.TOOL_CALL_END, toolCallId });
    this.open.clear();
    return output;
  }
  update(messages: readonly TranscriptMessage[], baseline = false): Event[] {
    const next = messages === this.previous ? this.previousAgui : nativeAguiMessages(messages);
    let events = baseline
      ? [
          {
            type: EventType.MESSAGES_SNAPSHOT,
            messages: next,
          } satisfies Event,
        ]
      : diffNativeMessages(this.previous, messages, this.previousAgui, next, {
          openText: this.openText,
        });
    const active = new Set(this.open);
    for (const event of events) {
      if (event.type === EventType.TOOL_CALL_START) active.add(event.toolCallId);
      if (event.type === EventType.TOOL_CALL_END) active.delete(event.toolCallId);
      if (event.type === EventType.MESSAGES_SNAPSHOT) active.clear();
      if (event.type === EventType.TOOL_CALL_ARGS && !active.has(event.toolCallId)) {
        events = [{ type: EventType.MESSAGES_SNAPSHOT, messages: next }];
        break;
      }
    }
    const output: Event[] = [];
    for (const event of events) {
      if (event.type === EventType.TOOL_CALL_END && !this.open.has(event.toolCallId)) continue;
      if (event.type === EventType.TEXT_MESSAGE_END && this.openText?.id !== event.messageId)
        continue;
      if (event.type === EventType.MESSAGES_SNAPSHOT) {
        output.push(...this.close());
      }
      output.push(event);
      if (event.type === EventType.TEXT_MESSAGE_START)
        this.openText = { id: event.messageId, hasContent: false };
      if (event.type === EventType.TEXT_MESSAGE_CONTENT && this.openText?.id === event.messageId)
        this.openText.hasContent = true;
      if (event.type === EventType.TEXT_MESSAGE_END && this.openText?.id === event.messageId)
        this.openText = undefined;
      if (event.type === EventType.TOOL_CALL_START) this.open.add(event.toolCallId);
      if (event.type === EventType.TOOL_CALL_END) this.open.delete(event.toolCallId);
    }
    this.previous = messages;
    this.previousAgui = next;
    return output;
  }
}
