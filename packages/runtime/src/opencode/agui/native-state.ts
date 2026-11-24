import { DateTime, Schema } from "effect";
import { SessionEvent } from "@opencode/schema/session-event";
import { SessionMessage } from "@opencode/schema/session-message";
import type { TranscriptMessage } from "@abracode/contracts/web/contracts";
import type { NativeSessionView } from "./adapter.ts";
import { projectNativeMessage, type ToolPresenter } from "./messages.ts";

const DECODED_SESSION_EVENT = Symbol("abracode.decodedSessionEvent");
export type DecodedSessionEvent = typeof SessionEvent.All.Type;
export type NativeEventEnvelope = {
  type: string;
  data?: unknown;
  id?: string;
  created?: number;
  durable?: { aggregateID: string; seq: number; version: number };
  location?: { directory?: string };
  readonly [DECODED_SESSION_EVENT]?: DecodedSessionEvent;
};
/** Mark an event already validated by `@opencode/client` so token streaming skips re-decoding. */
export const trustedSessionEvent = (event: DecodedSessionEvent): NativeEventEnvelope => ({
  ...event,
  [DECODED_SESSION_EVENT]: event,
});
const visibleAssistant = (
  message: SessionMessage.Assistant,
  content: readonly SessionMessage.AssistantContent[],
): SessionMessage.Assistant => ({
  id: message.id,
  type: "assistant",
  agent: message.agent,
  model: message.model,
  time: message.time,
  content,
  finish: message.finish,
});
/** Bounded native projection. A baseline blocks ambiguous in-flight fragments until
 * their full-value boundary; fresh parts can stream immediately without replay. */
export class NativeSessionProjection {
  private messages = new Map<string, SessionMessage.Info>();
  private projected = new Map<string, TranscriptMessage>();
  private streamable = new Set<string>();
  private seen = new Set<string>();
  private seq?: number;
  private recovering = false;
  private busy = false;
  private inbox: readonly { id: string }[] = [];
  private delivered = new Set<string>();
  private turnInputs = new Map<string, readonly string[]>();
  constructor(
    private sessionID: string,
    private present?: ToolPresenter,
  ) {}
  baseline(
    messages: readonly SessionMessage.Info[],
    busy: boolean,
    inbox: readonly { id: string }[],
    preserveLive = false,
  ) {
    const previous = this.messages;
    const previousProjected = this.projected;
    const live = new Set<string>();
    const retain = preserveLive && !this.recovering;
    const nextMessages = new Map<string, SessionMessage.Info>();
    const nextProjected = new Map<string, TranscriptMessage>();
    for (const message of messages) {
      const old = previous.get(message.id);
      let resolved: SessionMessage.Info = message;
      if (message.type === "assistant" && old?.type === "assistant" && !message.time.completed) {
        const content = message.content.map((part, i) => {
          const prior = old.content[i];
          if (
            part.type === "tool" &&
            prior?.type === "tool" &&
            part.id === prior.id &&
            part.state.status === "streaming" &&
            prior.state.status === "streaming" &&
            prior.state.input.startsWith(part.state.input)
          ) {
            const key = `${message.id}/tool/${part.id}`;
            if (retain && this.streamable.has(key)) live.add(key);
            return { ...part, state: { status: "streaming" as const, input: prior.state.input } };
          }
          if (part.type === "text" && prior?.type === "text" && prior.text.startsWith(part.text)) {
            const key = `${message.id}/text/${i}`;
            if (retain && this.streamable.has(key)) live.add(key);
            return { ...part, text: prior.text };
          }
          return part;
        });
        resolved = visibleAssistant(message, content);
      }
      nextMessages.set(resolved.id, resolved);
      const cached = old === resolved ? previousProjected.get(resolved.id) : undefined;
      const projected = cached ?? projectNativeMessage(resolved, this.present);
      if (projected) nextProjected.set(resolved.id, projected);
    }
    this.messages = nextMessages;
    this.projected = nextProjected;
    this.busy = busy;
    this.inbox = inbox;
    this.streamable = live;
    this.recovering = false;
    this.delivered.clear();
    for (const message of messages) {
      if (message.type === "idle") this.delivered.clear();
      else if (message.type === "user") this.delivered.add(message.id);
    }
    return this.current();
  }
  current(): NativeSessionView {
    const completions: NonNullable<NativeSessionView["completions"]>[number][] = [];
    const projectedMessages: TranscriptMessage[] = [];
    let inputs: string[] = [];
    for (const [id, message] of this.messages) {
      if (message.type === "user") inputs.push(message.id);
      if (message.type === "idle") {
        completions.push({
          inputs: [...new Set([...inputs, ...(this.turnInputs.get(message.id) ?? [])])],
          outcome: message.outcome,
          ...(message.error ? { error: message.error.message.slice(0, 1024) } : {}),
        });
        inputs = [];
      }
      const projected = this.projected.get(id);
      if (projected) projectedMessages.push(projected);
    }
    return {
      busy: this.busy,
      inbox: this.inbox,
      completions,
      messages: projectedMessages,
    };
  }
  private put(message: SessionMessage.Info) {
    this.messages.set(message.id, message);
    const projected = projectNativeMessage(message, this.present);
    if (projected) this.projected.set(message.id, projected);
    else this.projected.delete(message.id);
    while (this.messages.size > 100) {
      const evicted = this.messages.keys().next().value!;
      this.messages.delete(evicted);
      this.projected.delete(evicted);
    }
  }
  applyDecoded(event: DecodedSessionEvent): { view?: NativeSessionView; repair?: boolean } {
    return this.applyEvent(event);
  }
  apply(raw: NativeEventEnvelope): { view?: NativeSessionView; repair?: boolean } {
    if (raw.type === "server.connected") {
      this.recovering = true;
      this.seq = undefined;
      this.streamable.clear();
      return { repair: true };
    }
    const predecoded = raw[DECODED_SESSION_EVENT];
    if (predecoded) return this.applyEvent(predecoded);
    if (!raw.type.startsWith("session.")) return {};
    const parsed = Schema.decodeUnknownResult(SessionEvent.All)(raw);
    if (parsed._tag === "Failure") return { repair: true };
    return this.applyEvent(parsed.success);
  }
  private applyEvent(event: DecodedSessionEvent): { view?: NativeSessionView; repair?: boolean } {
    if (event.data.sessionID !== this.sessionID) return {};
    if (this.seen.has(event.id)) return {};
    this.seen.add(event.id);
    if (this.seen.size > 4096) this.seen.delete(this.seen.values().next().value!);
    if ("durable" in event) {
      const seq = event.durable.seq;
      if (this.seq !== undefined && seq <= this.seq) return {};
      const gap = this.seq !== undefined && seq !== this.seq + 1;
      this.seq = seq;
      if (gap) {
        this.recovering = true;
        this.streamable.clear();
        return { repair: true };
      }
    }
    if (this.recovering) return { repair: true };
    if ("ordinal" in event.data && event.data.ordinal > 1023) return { repair: true };
    const data = event.data,
      created = DateTime.makeUnsafe(event.created);
    if (event.type === "session.execution.started") this.busy = true;
    else if (event.type === "session.inbox.delivered") {
      this.delivered.add(event.data.inboxID);
      this.inbox = this.inbox.filter((item) => item.id !== event.data.inboxID);
    } else if (
      event.type === "session.execution.succeeded" ||
      event.type === "session.execution.failed" ||
      (event.type === "session.execution.interrupted" && event.data.reason !== "shutdown")
    ) {
      const outcome =
        event.type === "session.execution.succeeded"
          ? "succeeded"
          : event.type === "session.execution.failed"
            ? "failed"
            : "interrupted";
      // Idle membership is based on delivered input identities, never a global busy flag.
      const idleID = SessionMessage.ID.fromEvent(event.id);
      this.turnInputs.set(idleID, [...this.delivered]);
      while (this.turnInputs.size > 100)
        this.turnInputs.delete(this.turnInputs.keys().next().value!);
      this.put({
        id: idleID,
        type: "idle",
        time: { created },
        outcome,
        ...(event.type === "session.execution.failed" ? { error: event.data.error } : {}),
      });
      this.busy = false;
      this.delivered.clear();
    } else if (event.type === "session.step.started") {
      if (!this.messages.has(event.data.assistantMessageID))
        this.put({
          id: event.data.assistantMessageID,
          type: "assistant",
          agent: event.data.agent,
          model: event.data.model,
          time: { created },
          content: [],
        });
    } else if ("assistantMessageID" in data) {
      const message = this.messages.get(data.assistantMessageID);
      if (!message || message.type !== "assistant") return { repair: true };
      let content = [...message.content];
      if (message.time.completed && event.type.startsWith("session.text.")) return {};
      if (event.type === "session.text.started") {
        const key = `${message.id}/text/${event.data.ordinal}`;
        if (!content[event.data.ordinal]) {
          content[event.data.ordinal] = { type: "text", text: "" };
          this.streamable.add(key);
        } else {
          const existing = content[event.data.ordinal];
          if (existing?.type === "text" && existing.text === "") this.streamable.add(key);
        }
      } else if (event.type === "session.text.delta" || event.type === "session.text.ended") {
        const key = `${message.id}/text/${event.data.ordinal}`,
          prior = content[event.data.ordinal];
        if (event.type === "session.text.delta" && !this.streamable.has(key)) return {};
        if (prior && prior.type !== "text") return { repair: true };
        content[event.data.ordinal] = {
          type: "text",
          text: (event.type === "session.text.ended"
            ? event.data.text
            : (prior?.text ?? "") + event.data.delta
          ).slice(0, 65537),
        };
        if (event.type === "session.text.ended") this.streamable.delete(key);
      } else if (event.type === "session.tool.input.started") {
        if (!content.some((part) => part.type === "tool" && part.id === event.data.id)) {
          content.push({
            type: "tool",
            id: event.data.id,
            name: event.data.name,
            time: { created },
            state: { status: "streaming", input: "" },
          });
          this.streamable.add(`${message.id}/tool/${event.data.id}`);
        } else {
          const tool = content.find((part) => part.type === "tool" && part.id === event.data.id);
          if (tool?.type === "tool" && tool.state.status === "streaming" && tool.state.input === "")
            this.streamable.add(`${message.id}/tool/${event.data.id}`);
        }
      } else if (
        event.type === "session.tool.input.delta" ||
        event.type === "session.tool.input.ended" ||
        event.type === "session.tool.called" ||
        event.type === "session.tool.success" ||
        event.type === "session.tool.failed"
      ) {
        const index = content.findIndex(
          (part) => part.type === "tool" && part.id === event.data.id,
        );
        const tool = content[index];
        if (!tool || tool.type !== "tool") return { repair: true };
        const key = `${message.id}/tool/${tool.id}`;
        let next = tool;
        if (
          event.type === "session.tool.input.delta" ||
          event.type === "session.tool.input.ended"
        ) {
          if (event.type === "session.tool.input.delta" && !this.streamable.has(key)) return {};
          if (tool.state.status !== "streaming") return {};
          next = {
            ...tool,
            state: {
              status: "streaming",
              input: (event.type === "session.tool.input.ended"
                ? event.data.text
                : tool.state.input + event.data.delta
              ).slice(0, 4097),
            },
          };
        } else if (event.type === "session.tool.called") {
          if (tool.state.status === "completed" || tool.state.status === "error") return {};
          next = {
            ...tool,
            state: { status: "running", input: event.data.input, metadata: {} },
            time: { ...tool.time, ran: created },
          };
          this.streamable.delete(key);
        } else {
          if (tool.state.status === "streaming") return { repair: true };
          next = {
            ...tool,
            state:
              event.type === "session.tool.success"
                ? { status: "completed", input: tool.state.input, content: event.data.content }
                : {
                    status: "error",
                    input: tool.state.input,
                    error: event.data.error,
                    content: event.data.content,
                  },
            time: { ...tool.time, completed: created },
          };
          this.streamable.delete(key);
        }
        content[index] = next;
      } else if (event.type.startsWith("session.reasoning.")) return {};
      else return {};
      // Holes represent hidden reasoning ordinals and carry no provider bytes.
      content = Array.from(
        { length: content.length },
        (_, i) => content[i] ?? { type: "reasoning", text: "" },
      );
      this.put(visibleAssistant(message, content));
    } else return {};
    return { view: this.current() };
  }
}
