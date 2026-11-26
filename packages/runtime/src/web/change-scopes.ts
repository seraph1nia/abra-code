import { Schema } from "effect";
import { ChangeScopeSchema, type ChangeScope } from "@abracode/contracts/web/changes";
import type { IssueId } from "@abracode/contracts/identities";

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const incrementalStreamingEvents = new Set([
  "session.text.started",
  "session.text.delta",
  "session.text.ended",
  "session.tool.input.started",
  "session.tool.input.delta",
  "session.tool.input.ended",
  "session.tool.called",
  "session.tool.progress",
  "session.step.started",
  "session.step.ended",
  "session.step.failed",
  "session.step.first-token",
  "session.step.streamed",
]);

/** Native transport supplies the envelope; resource hints never authorize actions. */
export function nativeChangeScope(
  event: {
    readonly type: string;
    readonly data?: unknown;
    readonly location?: { readonly directory?: string };
  },
  home: string,
  supervisor: string,
  workerIssue: (session: string) => IssueId | undefined,
): ChangeScope | undefined {
  const data = object(event.data) ? event.data : {};
  if (event.type === "rpc.abracode-visibility.changed") {
    if (data.home !== home) return;
    // Authenticated home-scoped events may originate in any managed location.
    if (data.scope === undefined) return { all: true };
    const parsed = Schema.decodeUnknownResult(ChangeScopeSchema)(data.scope);
    return parsed._tag === "Success" ? parsed.success : { all: true };
  }
  if (event.type === "server.connected") return { all: true };
  if (event.type === "location.shutdown" && event.location?.directory === home)
    return { all: true };
  const session =
    typeof data.sessionID === "string"
      ? data.sessionID
      : object(data.form) && typeof data.form.sessionID === "string"
        ? data.form.sessionID
        : undefined;
  if (!session) return;
  if (
    event.type.startsWith("session.reasoning.") ||
    event.type === "session.viewed" ||
    event.type === "session.skill.activated"
  )
    return;
  if (session !== supervisor) {
    const issue = workerIssue(session);
    return issue &&
      (event.type.startsWith("session.") ||
        event.type.startsWith("form.") ||
        event.type.startsWith("permission."))
      ? { issues: [issue], finder: true }
      : undefined;
  }
  if (event.location?.directory && event.location.directory !== home) return;
  if (event.type.startsWith("form.") || event.type.startsWith("permission."))
    return { attention: true };
  if (event.type.startsWith("session.inbox.")) return { admissions: true, transcript: true };
  if (incrementalStreamingEvents.has(event.type)) return;
  if (event.type.startsWith("session.")) return { transcript: true };
  return;
}
