import { Schema } from "effect";
import { WorkerModelSchema } from "../contracts.ts";
import { ToolName, ActivityId, MessageId } from "../identities.ts";
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
type NativeMessage = typeof SessionMessage.Info.Encoded;
type NativeTool = Extract<
  Extract<NativeMessage, { type: "assistant" }>["content"][number],
  { type: "tool" }
>;
export interface MessageSummary {
  id: MessageId;
  type: NativeMessage["type"];
  at: number;
  text?: string;
  tools?: Array<{
    name: ToolName;
    status: NativeTool["state"]["status"];
    error?: WorkerError;
  }>;
}
export function summarizeContext(messages: readonly (typeof SessionMessage.Info.Encoded)[]) {
  const assistant = messages.findLast((m) => m.type === "assistant");
  const terminal = messages.findLast((m) => m.type === "assistant" || m.type === "idle");
  const error =
    terminal && "error" in terminal && terminal.error ? diagnosticError(terminal.error) : undefined;
  const model: WorkerModel | undefined =
    assistant?.type === "assistant"
      ? Schema.decodeSync(WorkerModelSchema)(assistant.model)
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
          at: assistant.time.created,
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
    error_at: error ? terminal?.time.created : undefined,
    recent_messages: messages.slice(-12).map((m): MessageSummary => ({
      id: MessageId.make(m.id),
      type: m.type,
      at: m.time.created,
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
