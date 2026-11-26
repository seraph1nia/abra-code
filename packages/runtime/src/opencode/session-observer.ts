import { DateTime, Effect, Schema } from "effect";
import {
  Agent,
  type OpenCodeClient,
  type Session,
  type SessionMessage,
} from "@opencode/client/effect";
import type { Context } from "@opencode/plugin/effect/plugin";
import {
  type AbsolutePath,
  type ActivityId,
  MessageId,
  type SessionId,
  StorageKey,
  Timestamp,
  ToolName,
} from "@abracode/contracts/identities";
import { WorkerModelSchema } from "@abracode/contracts/primitives";
import { CrewError, type WorkerError, type WorkerModel } from "../domain.ts";
import { decode } from "../decode.ts";
import type { Store } from "../storage/store.ts";
import { originatingUserMessage } from "./tool-caller.ts";
import { nativeSession, nativeDomain, nativeError } from "./native-call.ts";
import {
  diagnosticText,
  messageCreatedAt,
  nativeIdle,
  summarizeContext,
  type MessageSummary,
} from "./diagnostics.ts";

export interface SessionState {
  executing?: boolean;
  /** Context has a consumed input without a later native completion observation. */
  completion_pending?: boolean;
  /** One native inbox observation, never persisted as controller authority. */
  queued_prompt_ids?: readonly MessageId[];
  outcome_prompt_id?: MessageId;
  assignment?: {
    id: MessageId;
    outcome?: typeof Session.Info.Type.outcome;
    completion?: { id: MessageId; at: number };
    error?: WorkerError;
    at?: number;
  };
  activity?: { identity: ActivityId; at: number; summary: string };
  id: SessionId;
  directory: AbsolutePath;
  outcome?: typeof Session.Info.Type.outcome;
  busy: boolean;
  metadata?: Record<string, unknown>;
  model?: WorkerModel;
  agent?: Agent.ID;
  error?: WorkerError;
  error_at?: number;
  diagnostic_error?: string;
  recent_messages?: MessageSummary[];
  available_tools?: {
    model: WorkerModel;
    names: ToolName[];
    at: Timestamp;
  };
}

export type PromptAdmission = "queued" | "consumed" | "absent";
export type PromptIdentity = { prompt_id: MessageId; prompt: string };

const AvailableToolsSchema = Schema.UndefinedOr(
  Schema.Struct({
    model: WorkerModelSchema,
    names: Schema.mutable(Schema.Array(ToolName)),
    at: Timestamp,
  }),
);

export const observeSession = (
  ctx: Context,
  store: Store,
  client: OpenCodeClient,
  id: SessionId,
  assignment?: MessageId,
): Effect.Effect<SessionState, CrewError> =>
  Effect.gen(function* () {
    const sessions = nativeSession(ctx);
    const [s, active, pending, contextRead, available_tools] = yield* Effect.all(
      [
        sessions.get({ sessionID: id }),
        nativeDomain(client.session).active(),
        nativeDomain(client.session.inbox).list({ sessionID: id }),
        sessions.context({ sessionID: id }).pipe(
          Effect.map((messages) => ({ messages, error: undefined as string | undefined })),
          Effect.catch((error) =>
            Effect.succeed({
              messages: [] as readonly SessionMessage.Info[],
              error: diagnosticText(error.message),
            }),
          ),
        ),
        store
          .get(StorageKey.make(`worker-tools/${id}`))
          .pipe(
            Effect.flatMap((value) => decode(AvailableToolsSchema, value, `worker-tools/${id}`)),
          ),
      ],
      { concurrency: "unbounded" },
    );

    let diagnostic_error = contextRead.error;
    let history: readonly SessionMessage.Info[] = contextRead.messages;
    if (
      assignment &&
      !active[id] &&
      pending.length === 0 &&
      !history.some((m) => m.type === "user" && m.id === assignment)
    ) {
      // Native context starts at the latest compaction. Read bounded native
      // history using only server-issued cursors; never mirror it in records.
      const descending: SessionMessage.Info[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 20; page++) {
        const result = yield* nativeDomain(client.message).list({
          sessionID: id,
          limit: 200,
          ...(cursor ? { cursor } : { order: "desc" as const }),
        });
        descending.push(...result.data);
        if (
          result.data.some((m) => m.type === "user" && m.id === assignment) ||
          !result.cursor.next
        )
          break;
        cursor = result.cursor.next;
      }
      history = descending.toReversed();
      if (!history.some((m) => m.type === "user" && m.id === assignment))
        diagnostic_error =
          "Assignment outcome unavailable within the bounded native history observation";
    }

    const start = assignment
      ? history.findIndex((m) => m.type === "user" && m.id === assignment)
      : -1;
    let end = -1;
    if (start >= 0)
      for (let index = start + 1; index < history.length; index++) {
        const message = history[index]!;
        if (message.type === "idle") end = index;
        else if (
          end >= 0 &&
          !["assistant", "agent-switched", "model-switched", "location-switched"].includes(
            message.type,
          )
        )
          break;
      }
    const idle = end < 0 ? undefined : nativeIdle(history.slice(start, end + 1));
    const observedIdle = nativeIdle(history);
    const bound = end < 0 ? undefined : summarizeContext(history.slice(0, end + 1));
    const lastIdle = history.findLastIndex((m) => m.type === "idle");
    // Session, active, inbox and context are separate native reads. A queued
    // input can be consumed between them. Later unfinished context must not
    // turn an earlier empty active/inbox snapshot into verified idleness.
    // Native interruption can finish a consumed input without appending an
    // idle context message. Its server-owned idle timestamp is still evidence
    // of completion, provided it is strictly later than the trailing input.
    const terminalAt = s.time?.idle ? DateTime.toEpochMillis(s.time.idle) : -Infinity;
    const unfinished = history
      .slice(lastIdle + 1)
      .some(
        (m) =>
          (m.type === "user" || m.type === "assistant") &&
          messageCreatedAt(m.time.created) >= terminalAt,
      );
    if (unfinished && !active[id] && pending.length === 0)
      diagnostic_error ??=
        "Native context contains input without a later verified completion; execution outcome is unconfirmed";
    const outcomePrompt =
      lastIdle < 0 ? undefined : history.slice(0, lastIdle + 1).findLast((m) => m.type === "user");
    return {
      id: s.id,
      agent: s.agent ?? Agent.ID.make("build"),
      directory: s.location.directory,
      outcome:
        s.outcome === "succeeded" ||
        s.outcome === undefined ||
        (observedIdle && s.time?.idle && messageCreatedAt(observedIdle.time.created) > terminalAt)
          ? (observedIdle?.outcome ?? s.outcome)
          : s.outcome,
      busy: !!active[id] || pending.length > 0,
      executing: !!active[id],
      completion_pending: unfinished,
      queued_prompt_ids: pending.map((item) => MessageId.make(item.id)),
      outcome_prompt_id: outcomePrompt ? MessageId.make(outcomePrompt.id) : undefined,
      assignment: assignment
        ? {
            id: assignment,
            outcome: idle?.type === "idle" ? idle.outcome : undefined,
            completion: idle
              ? { id: MessageId.make(idle.id), at: messageCreatedAt(idle.time.created) }
              : undefined,
            error: bound?.error,
            at: bound?.error_at,
          }
        : undefined,
      metadata: s.metadata,
      ...summarizeContext(history),
      available_tools,
      ...(diagnostic_error ? { diagnostic_error } : {}),
    };
  });

export const observePromptAdmissions = (
  ctx: Context,
  client: OpenCodeClient,
  sessionID: SessionId,
  requests: readonly PromptIdentity[],
): Effect.Effect<ReadonlyMap<MessageId, PromptAdmission>, CrewError> =>
  Effect.gen(function* () {
    const observations = new Map<MessageId, PromptAdmission>();
    if (!requests.length) return observations;
    const [inbox, context] = yield* Effect.all(
      [
        nativeDomain(client.session.inbox).list({ sessionID }),
        nativeSession(ctx).context({ sessionID }),
      ],
      { concurrency: "unbounded" },
    );
    const queuedByID = new Map(inbox.map((item) => [item.id, item]));
    const consumedByID = new Map(context.map((item) => [item.id, item]));
    for (const { prompt_id: id, prompt: text } of requests) {
      const queued = queuedByID.get(id);
      const consumed =
        consumedByID.get(id) ??
        (!queued
          ? yield* client.session.message.get({ sessionID, messageID: id }).pipe(
              Effect.catchTag("MessageNotFoundError", () => Effect.void),
              Effect.mapError(nativeError),
            )
          : undefined);
      const payload =
        queued?.type === "user" ? queued.payload : consumed?.type === "user" ? consumed : undefined;
      if (!queued && !consumed) {
        observations.set(id, "absent");
        continue;
      }
      if (
        !payload ||
        payload.text !== text ||
        payload.files?.length ||
        payload.agents?.length ||
        payload.skills?.length
      )
        return yield* new CrewError(
          "MESSAGE_REBIND",
          "Native prompt differs from retained controller intent",
        );
      observations.set(id, queued ? "queued" : "consumed");
    }
    return observations;
  });

export const observePromptOrigin = (ctx: Context, session: SessionId, message: MessageId) =>
  Effect.gen(function* () {
    return (yield* originatingUserMessage(ctx, session, message))?.id;
  });
