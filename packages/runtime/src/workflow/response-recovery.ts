import { SessionMessage } from "@opencode/schema/session-message";
import { Effect } from "effect";
import type { Runtime, SessionState, PromptAdmission } from "../opencode/runtime.ts";
import {
  type MessageId,
  type RequestId,
  type SessionId,
  timestamp,
  timestampAt,
} from "@abracode/contracts/identities";
import {
  requiresResponse,
  type RequestSchema,
} from "@abracode/contracts/workflow/message-contracts";
import type { CrewError } from "../domain.ts";

type Request = typeof RequestSchema.Type;
export type RecoveryStatus = "pending" | "admission_uncertain" | "admitted" | "suppressed";
export type NativeCompletion = NonNullable<NonNullable<SessionState["assignment"]>["completion"]>;

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

export const isUnresolvedRecovery = (m: Request) =>
  requiresResponse(m) ||
  (!["cancelled", "superseded"].includes(m.status) &&
    m.response_recovery?.status === "admission_uncertain");

export const isResolvableUncertainReminder = (m: Request, text: string, delivery: string) =>
  delivery === "queue" &&
  m.response_recovery?.status === "admission_uncertain" &&
  m.response_recovery.prompt === text &&
  ["answered", "acknowledged"].includes(m.status) &&
  !requiresResponse(m);

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

export function renderReminderPrompt(
  kind: "worker" | "lead",
  opts: {
    readonly requestId: RequestId;
    readonly generation: number;
    readonly response?: Request["response"];
  },
): string {
  if (kind === "lead")
    return `AbraCode response-only reminder for original project-lead request ${opts.requestId}, registration revision ${opts.generation}. Its admitted native turn completed without the required answer. Do not repeat its substantive task, create work or broaden scope. Use abra_lead_action action reply, revision ${opts.generation}, ORIGINAL request_id ${opts.requestId}. No approval or delivery authority is granted.`;
  const action = opts.response === "answer" ? "answer" : "acknowledge";
  return `AbraCode response-only reminder for original request ${opts.requestId}, generation ${opts.generation}. The admitted request's native turn completed, but its required ${opts.response} is missing. Do not repeat the substantive task or broaden scope. This grants no approval. Use abra_worker_reply action ${action} with the ORIGINAL request_id ${opts.requestId} and generation ${opts.generation}.`;
}

export function formatNativeState(state?: SessionState): string {
  return state
    ? JSON.stringify({
        executing: state.executing,
        busy: state.busy,
        outcome: state.outcome,
        completion: state.assignment?.completion,
      })
    : "unavailable";
}

export const reserveReminder = (completion: NativeCompletion, prompt: string) =>
  Effect.gen(function* () {
    return {
      prompt_id: SessionMessage.ID.create(),
      prompt,
      created_at: yield* timestamp,
      completion_id: completion.id,
      completed_at: timestampAt(completion.at),
      status: "pending" as const,
    };
  });

/** Shared persist-before-native transport for worker and management recipients.
 * An uncertain absence is not permission to resubmit. Callers own authorization,
 * capacity and generation checks; OpenCode owns queue delivery. */
export const admitNativeRequest = (
  runtime: Pick<Runtime, "prompt" | "promptAdmission">,
  request: Request,
  commit: (status: "admission_uncertain" | "admitted") => Effect.Effect<unknown, CrewError>,
) =>
  Effect.gen(function* () {
    if (request.status !== "pending") {
      const observed = yield* runtime.promptAdmission(
        request.recipient_session_id,
        request.prompt_id,
        request.prompt,
      );
      if (observed === "absent") return false;
      if (request.status === "admission_uncertain") yield* commit("admitted");
      return true;
    }
    yield* commit("admission_uncertain");
    yield* runtime.prompt(
      request.recipient_session_id,
      request.prompt,
      request.prompt_id,
      request.delivery === "steer",
    );
    yield* commit("admitted");
    return true;
  });

export interface ReminderTransportHost {
  readonly sessionId: SessionId;
  readonly request: Request;
  readonly pendingPromptId?: MessageId;
  readonly observedState?: SessionState;
  readonly observedAdmission?: PromptAdmission;
  readonly checkPending?: Effect.Effect<boolean, CrewError>;
  readonly preflight?: Effect.Effect<void, CrewError>;
  readonly readState: (bound?: MessageId) => Effect.Effect<SessionState | undefined, CrewError>;
  readonly validateState: (state: SessionState, stage: "pending" | "queued") => void;
  readonly setStatus: (status: RecoveryStatus) => Effect.Effect<boolean, CrewError>;
  readonly beforeWake: Effect.Effect<void, CrewError>;
  readonly escalate: (reason: string, state?: SessionState) => Effect.Effect<void, CrewError>;
  readonly absentReason: string;
  readonly pendingStoppedReason: string;
  readonly concurrentSuppressReason?: string;
  readonly queuedStoppedReason: string;
}

export interface TransportOutcome {
  readonly settled: boolean;
  readonly submitted: boolean;
}

/** Shared durable reminder transport reconciliation for both worker messages and project leads. */
export const reconcileReminderTransport = (
  runtime: Pick<Runtime, "prompt" | "promptAdmission">,
  host: ReminderTransportHost,
): Effect.Effect<TransportOutcome, CrewError> =>
  Effect.gen(function* () {
    const recovery = host.request.response_recovery;
    if (!recovery || recovery.status === "suppressed") return { settled: true, submitted: false };
    if (recovery.status === "pending") {
      if (host.checkPending && !(yield* host.checkPending))
        return { settled: true, submitted: false };
      if (host.preflight) yield* host.preflight;
      const state = yield* host.readState(host.pendingPromptId);
      if (!state) return { settled: false, submitted: false };
      host.validateState(state, "pending");
      const action = pendingReminder(state);
      if (action === "wait") return { settled: false, submitted: false };
      if (action === "suppress") {
        yield* host.setStatus("suppressed");
        yield* host.escalate(host.pendingStoppedReason, state);
        return { settled: true, submitted: false };
      }
      if (!(yield* host.setStatus("admission_uncertain"))) {
        if (host.concurrentSuppressReason)
          yield* host.escalate(host.concurrentSuppressReason, state);
        return { settled: true, submitted: false };
      }
      yield* runtime.prompt(host.sessionId, recovery.prompt, recovery.prompt_id);
      yield* host.setStatus("admitted");
      return { settled: false, submitted: true };
    }
    const observed =
      host.observedAdmission ??
      (yield* runtime.promptAdmission(host.sessionId, recovery.prompt_id, recovery.prompt));
    if (observed === "absent") {
      yield* host.escalate(host.absentReason, host.observedState);
      return { settled: false, submitted: false };
    }
    if (recovery.status === "admission_uncertain") yield* host.setStatus("admitted");
    if (observed === "queued") {
      const state = host.observedState ?? (yield* host.readState(recovery.prompt_id));
      if (!state) return { settled: false, submitted: false };
      if (!host.observedState) host.validateState(state, "queued");
      const action = queuedReminder(state);
      if (action === "escalate") {
        yield* host.escalate(host.queuedStoppedReason, state);
        return { settled: false, submitted: false };
      }
      if (action === "wake") {
        yield* host.beforeWake;
        yield* runtime.prompt(host.sessionId, recovery.prompt, recovery.prompt_id);
      }
      return { settled: false, submitted: false };
    }
    return { settled: true, submitted: false };
  });

export type ReservationOutcome =
  | { readonly kind: "skip" }
  | { readonly kind: "escalate"; readonly reason: string }
  | { readonly kind: "reserved"; readonly request: Request };

export interface ResponseRecoveryHost {
  readonly sessionId: SessionId;
  readonly request: Request;
  readonly manual: boolean;
  readonly validateState: (state: SessionState) => void;
  readonly reserve: (
    completion: NativeCompletion,
    state: SessionState,
  ) => Effect.Effect<ReservationOutcome, CrewError>;
  readonly escalate: (reason: string, state?: SessionState) => Effect.Effect<void, CrewError>;
  readonly transport: (
    request: Request,
    observed?: { readonly state: SessionState; readonly admission: PromptAdmission },
  ) => Effect.Effect<TransportOutcome, CrewError>;
  /** When true, existing reminders are also reconciled & escalated in this pass (e.g. leads). */
  readonly reconcileExisting?: boolean;
}

/** Shared durable response-recovery state machine: observe -> decide -> reserve once -> transport -> escalate. */
export const runResponseRecovery = (
  runtime: Pick<Runtime, "session" | "promptAdmission">,
  host: ResponseRecoveryHost,
): Effect.Effect<void, CrewError> =>
  Effect.gen(function* () {
    let request = host.request;
    const recovery = request.response_recovery;
    if (host.reconcileExisting && recovery?.status === "suppressed") {
      if (requiresResponse(request))
        yield* host.escalate(
          "Reserved reminder suppressed before admission; explicit recovery required",
        );
      return;
    }
    const input = reminderTarget(request);
    const state = yield* runtime.session(host.sessionId, input.prompt_id);
    host.validateState(state);
    const admission = yield* runtime.promptAdmission(host.sessionId, input.prompt_id, input.prompt);
    if (!recovery) {
      const decision = reminderDecision(request, state, admission);
      if (decision.action === "wait") return;
      if (decision.action === "escalate") {
        yield* host.escalate(decision.reason, state);
        return;
      }
      if (host.manual) {
        yield* host.escalate("Manual posture requires explicit recovery", state);
        return;
      }
      const outcome = yield* host.reserve(state.assignment!.completion!, state);
      if (outcome.kind === "escalate") {
        yield* host.escalate(outcome.reason, state);
        return;
      }
      if (outcome.kind !== "reserved") return;
      request = outcome.request;
      yield* host.transport(request);
      return;
    }
    if (host.reconcileExisting) {
      const outcome = yield* host.transport(request, { state, admission });
      if (!outcome.settled || outcome.submitted) return;
    }
    const decision = reminderDecision(request, state, admission);
    if (decision.action === "escalate") yield* host.escalate(decision.reason, state);
  });
