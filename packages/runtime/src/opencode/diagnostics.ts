import { DateTime } from "effect";
import {
  ActivityId,
  MessageId,
  ModelId,
  ModelVariant,
  ProviderId,
  ToolName,
} from "@abracode/contracts/identities";
import { createHash } from "node:crypto";
import { type SessionMessage } from "@opencode/schema/session-message";
import { type WorkerError, type WorkerModel } from "../domain.ts";

export function diagnosticText(text: string, limit = 1500): string {
  let result = text;
  for (const [name, value] of Object.entries(process.env))
    if (/key|token|password|secret/i.test(name) && value && value.length >= 4)
      result = result.replaceAll(value, "[redacted]");
  return result
    .replace(/Bearer\s+[\w.~+/=-]+/gi, "Bearer [redacted]")
    .replace(
      /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*["']?\s*[:=]\s*["']?)[^\s"',}]+/gi,
      "$1[redacted]",
    )
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[redacted]@")
    .slice(0, limit);
}

export const diagnosticError = (error: WorkerError): WorkerError => ({
  type: diagnosticText(error.type, 100),
  message: diagnosticText(error.message),
  ...(error.status === undefined ? {} : { status: error.status }),
});

/** Extract epoch milliseconds from a decoded DateTime or raw numeric timestamp. */
export const messageCreatedAt = (created: DateTime.DateTime | number): number =>
  typeof created === "number" ? created : DateTime.toEpochMillis(created);

export type DiagnosticMessage = SessionMessage.Info | typeof SessionMessage.Info.Encoded;
type NativeTool = Extract<
  Extract<DiagnosticMessage, { type: "assistant" }>["content"][number],
  { type: "tool" }
>;

export interface MessageSummary {
  id: MessageId;
  type: DiagnosticMessage["type"];
  at: number;
  text?: string;
  tools?: Array<{
    name: ToolName;
    status: NativeTool["state"]["status"];
    error?: WorkerError;
  }>;
}

/** Native queue execution can emit adjacent failed/succeeded idle markers.
 * An empty success marker is not evidence that the failed turn recovered. */
export function nativeIdle<M extends DiagnosticMessage>(messages: readonly M[]) {
  let idle: Extract<M, { type: "idle" }> | undefined;
  let executionEvidence = false;
  for (const message of messages) {
    if (message.type === "user" || message.type === "assistant") executionEvidence = true;
    if (message.type !== "idle") continue;
    if (
      !idle ||
      idle.outcome === "succeeded" ||
      message.outcome !== "succeeded" ||
      executionEvidence
    )
      idle = message as Extract<M, { type: "idle" }>;
    executionEvidence = false;
  }
  return idle;
}

export function summarizeContext(messages: readonly DiagnosticMessage[]) {
  const assistant = messages.findLast((m) => m.type === "assistant");
  const lastAssistant = messages.findLastIndex((m) => m.type === "assistant");
  const lastIdle = messages.findLastIndex((m) => m.type === "idle");
  const terminal = lastAssistant > lastIdle ? messages[lastAssistant] : nativeIdle(messages);
  const error =
    terminal && "error" in terminal && terminal.error ? diagnosticError(terminal.error) : undefined;
  const model: WorkerModel | undefined =
    assistant?.type === "assistant"
      ? {
          providerID: ProviderId.make(assistant.model.providerID),
          id: ModelId.make(assistant.model.id),
          ...(assistant.model.variant !== undefined
            ? { variant: ModelVariant.make(assistant.model.variant) }
            : {}),
        }
      : undefined;
  const meaningful =
    assistant?.type === "assistant"
      ? assistant.content.filter(
          (p) => (p.type === "text" && p.text.length > 0) || p.type === "tool",
        )
      : [];
  const activity =
    meaningful.length && assistant
      ? {
          identity: ActivityId.make(
            createHash("sha256")
              .update(assistant.id)
              .update(JSON.stringify(meaningful))
              .digest("hex"),
          ),
          at: messageCreatedAt(assistant.time.created),
          summary: diagnosticText(
            meaningful
              .map((p) =>
                p.type === "text"
                  ? p.text.slice(-512)
                  : p.type === "tool"
                    ? `${p.name}: ${p.state.status}`
                    : "",
              )
              .join("; "),
            1500,
          ),
        }
      : undefined;
  return {
    activity,
    model,
    error,
    error_at: error && terminal ? messageCreatedAt(terminal.time.created) : undefined,
    recent_messages: messages.slice(-12).map((m): MessageSummary => ({
      id: MessageId.make(m.id),
      type: m.type,
      at: messageCreatedAt(m.time.created),
      ...(m.type === "assistant"
        ? {
            text: diagnosticText(
              m.content
                .filter((p) => p.type === "text")
                .map((p) => p.text)
                .join("\n"),
              1200,
            ),
            tools: m.content
              .filter((p) => p.type === "tool")
              .slice(-8)
              .map((p) => ({
                name: ToolName.make(p.name),
                status: p.state.status,
                ...(p.state.status === "error" ? { error: diagnosticError(p.state.error) } : {}),
              })),
          }
        : {}),
    })),
  };
}
