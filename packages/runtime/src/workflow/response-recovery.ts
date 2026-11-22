import { SessionMessage } from "@opencode/schema/session-message";
import { Effect } from "effect";
import type { SessionState, PromptAdmission } from "../opencode/runtime.ts";
import { Timestamp, timestamp } from "../identities.ts";
import { requiresResponse, type RequestSchema } from "./message-contracts.ts";
type Request = typeof RequestSchema.Type;
/** Classification is observation only; a missing response grants no admission authority. */
export function responseState(request: Request, state?: SessionState, admission?: PromptAdmission) {
  if (["cancelled", "superseded"].includes(request.status)) return "superseded";
  if (!requiresResponse(request)) return "resolved";
  if (!state || admission === undefined) return "unavailable";
  if (admission === "queued") return "queued";
  if (state.busy || state.executing) return "executing";
  if (state.completion_pending) return "unavailable";
  if (state.outcome === "failed" || state.assignment?.outcome === "failed") return "failed";
  if (state.outcome === "interrupted" || state.assignment?.outcome === "interrupted")
    return "interrupted";
  if (admission === "absent") return "uncertain";
  if (
    state.executing === false &&
    state.outcome === "succeeded" &&
    state.assignment?.id === request.prompt_id &&
    state.assignment.outcome === "succeeded" &&
    state.assignment.completion
  )
    return "missing";
  return "unavailable";
}

export function reminderTarget(request: Request) {
  const recovery = request.response_recovery;
  return recovery && recovery.status !== "suppressed" ? recovery : request;
}

export function reminderDecision(
  request: Request,
  state: SessionState,
  admission: PromptAdmission,
) {
  const observed = responseState(
    { ...request, prompt_id: reminderTarget(request).prompt_id },
    state,
    admission,
  );
  if (
    state.completion_pending ||
    ["queued", "executing", "resolved", "superseded"].includes(observed)
  )
    return { action: "wait" } as const;
  if (observed !== "missing") return { action: "escalate", reason: observed } as const;
  if (!request.response_recovery) return { action: "reserve" } as const;
  const reason =
    request.response_recovery.status === "suppressed"
      ? "Reserved reminder suppressed before admission; inspect before explicit retry"
      : "Recovery completed without the required response; automatic attempt exhausted";
  return { action: "escalate", reason } as const;
}

export const suppressReminder = (request: Request, manual: boolean) =>
  !requiresResponse(request) || manual;
const stopped = (state: SessionState) =>
  state.outcome === "failed" || state.outcome === "interrupted";
export function pendingReminder(state: SessionState) {
  if (state.busy || state.executing !== false || state.completion_pending) return "wait";
  return stopped(state) ? "suppress" : "admit";
}
export function queuedReminder(state: SessionState) {
  if (stopped(state)) return "escalate";
  return state.executing === false ? "wake" : "wait";
}

export const reserveReminder = (
  completion: NonNullable<NonNullable<SessionState["assignment"]>["completion"]>,
  prompt: string,
) =>
  Effect.gen(function* () {
    return {
      prompt_id: SessionMessage.ID.create(),
      prompt,
      created_at: yield* timestamp,
      completion_id: completion.id,
      completed_at: Timestamp.make(new Date(completion.at).toISOString()),
      status: "pending" as const,
    };
  });
