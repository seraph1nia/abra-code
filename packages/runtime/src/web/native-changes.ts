import { trustedSessionEvent, type NativeEventEnvelope } from "../opencode/agui/native-state.ts";
import { nativeChangeScope } from "./change-scopes.ts";
import { Effect, Result, Stream } from "effect";
import type { OpenCodeClient } from "@opencode/client/effect";
import { CrewError } from "../domain.ts";
import { AbsolutePath, IssueId, SessionId } from "@abracode/contracts/identities";

const subscribedSessionEventTypes = [
  "session.agent.selected",
  "session.archived",
  "session.compaction.started",
  "session.compaction.ended",
  "session.compaction.failed",
  "session.created",
  "session.deleted",
  "session.execution.started",
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
  "session.forked",
  "session.inbox.enqueued",
  "session.inbox.delivered",
  "session.inbox.cancelled",
  "session.inbox.delivery.changed",
  "session.instructions.updated",
  "session.metadata.updated",
  "session.model.selected",
  "session.moved",
  "session.permissions",
  "session.reasoning.started",
  "session.reasoning.ended",
  "session.renamed",
  "session.retry.scheduled",
  "session.revert.cleared",
  "session.revert.committed",
  "session.revert.staged",
  "session.shell.started",
  "session.shell.ended",
  "session.skill.activated",
  "session.step.started",
  "session.step.first-token",
  "session.step.streamed",
  "session.step.ended",
  "session.step.failed",
  "session.synthetic",
  "session.text.started",
  "session.text.delta",
  "session.text.ended",
  "session.tool.input.started",
  "session.tool.input.delta",
  "session.tool.input.ended",
  "session.tool.called",
  "session.tool.progress",
  "session.tool.success",
  "session.tool.failed",
  "session.unarchived",
  "session.viewed",
] as const;

type SessionEventName = (typeof subscribedSessionEventTypes)[number];
const sessionEventNames = new Set<string>(subscribedSessionEventTypes);
function isSubscribedSessionEvent<T extends { readonly type: string }>(
  event: T,
): event is Extract<T, { type: SessionEventName }> {
  return sessionEventNames.has(event.type);
}

const subscribedEventTypes = [
  "rpc.abracode-visibility.changed",
  "location.shutdown",
  "form.created",
  "form.replied",
  "form.cancelled",
  "permission.asked",
  "permission.replied",
  ...subscribedSessionEventTypes,
] as const;

const domainRpcFailureTypes = new Set([
  "not_found",
  "resource_unavailable",
  "invalid_selection",
  "refused",
  "rpc.method_not_found",
]);

export function isTransportFailure(cause: unknown): boolean {
  if (cause instanceof CrewError) return cause.code === "WEB_SERVICE";
  if (
    cause &&
    typeof cause === "object" &&
    "type" in cause &&
    typeof cause.type === "string" &&
    domainRpcFailureTypes.has(cause.type)
  )
    return false;
  return true;
}

export function nativeChanges(
  client: OpenCodeClient,
  home: AbsolutePath,
  sessionID: SessionId,
  issueForWorker: (session: string) => IssueId | undefined,
  forget: (client: OpenCodeClient) => Effect.Effect<void>,
) {
  return client.event.subscribe({ types: subscribedEventTypes }).pipe(
    Stream.filterMap((event) => {
      const scope = nativeChangeScope(event, home, sessionID, issueForWorker);
      const nativeEnvelope: NativeEventEnvelope | undefined =
        event.type === "server.connected"
          ? event
          : isSubscribedSessionEvent(event) &&
              event.data.sessionID === sessionID &&
              (!event.location?.directory || event.location.directory === home)
            ? trustedSessionEvent(event)
            : undefined;
      return scope || nativeEnvelope
        ? Result.succeed({ ...scope, ...(nativeEnvelope ? { native: nativeEnvelope } : {}) })
        : Result.fail(undefined);
    }),
    Stream.tapError((cause) => (isTransportFailure(cause) ? forget(client) : Effect.void)),
    Stream.mapError(CrewError.from),
  );
}
