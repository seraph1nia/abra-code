import { SessionMessage } from "@opencode/schema/session-message";
import { Effect } from "effect";
import type { Runtime, SessionState, PromptAdmission } from "../../opencode/runtime.ts";
import {
  type MessageId,
  type RequestId,
  type Timestamp,
  timestamp,
  timestampAt,
} from "@abracode/contracts/identities";
import {
  requiresResponse,
  type RequestSchema,
} from "@abracode/contracts/workflow/message-contracts";
import { ensure, type CrewError } from "../../domain.ts";

type Request = typeof RequestSchema.Type;
export type RecoveryStatus = "pending" | "admission_uncertain" | "admitted" | "suppressed";
type NativeCompletion = NonNullable<NonNullable<SessionState["assignment"]>["completion"]>;

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

function reminderTarget(request: Request) {
  const recovery = request.response_recovery;
  return recovery && recovery.status !== "suppressed" ? recovery : request;
}

function reminderDecision(request: Request, state: SessionState, admission: PromptAdmission) {
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

function pendingReminder(state: SessionState) {
  if (state.busy || state.executing !== false || state.completion_pending) return "wait";
  return stopped(state) ? "suppress" : "admit";
}

function queuedReminder(state: SessionState) {
  if (stopped(state)) return "escalate";
  return state.executing === false ? "wake" : "wait";
}

function renderReminderPrompt(
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

const reserveReminder = (completion: NativeCompletion, prompt: string) =>
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

type NewRequest = Pick<
  Request,
  | "request_id"
  | "generation"
  | "sender_session_id"
  | "recipient_session_id"
  | "prompt"
  | "delivery"
  | "body"
  | "response"
>;

type AdmissionStatus = "admission_uncertain" | "admitted";

/** One retained native prompt across retries, including a reply arriving during admission. */
export class DurableRequestChannel<T extends Request> {
  constructor(
    private runtime: Pick<Runtime, "prompt" | "promptAdmission" | "session">,
    readonly request: T,
  ) {}

  static prepare<const T extends NewRequest>(intent: T) {
    return Effect.map(timestamp, (created_at) => ({
      ...intent,
      type: "request" as const,
      schema_version: 1 as const,
      prompt_id: SessionMessage.ID.create(),
      created_at,
      status: "pending" as const,
    }));
  }

  static reflectAdmission<T extends Request>(current: T, status: AdmissionStatus): T {
    return ["acknowledged", "answered", "cancelled", "superseded"].includes(current.status)
      ? current
      : { ...current, status };
  }

  static acknowledge<T extends Request>(current: T, now: Timestamp): T {
    return ["acknowledged", "answered"].includes(current.status)
      ? current
      : { ...current, status: "acknowledged", acknowledged_at: now };
  }

  static answer<T extends Request>(
    current: T,
    body: string,
    evidence: NonNullable<Request["reply"]>["evidence"],
    now: Timestamp,
    check?: {
      fingerprint: NonNullable<NonNullable<Request["reply"]>["check"]>["fingerprint"];
      capture: () => NonNullable<NonNullable<Request["reply"]>["check"]>;
    },
  ): T {
    if (current.reply) {
      ensure(
        current.reply.body === body &&
          current.reply.check?.fingerprint === check?.fingerprint &&
          JSON.stringify(current.reply.evidence) === JSON.stringify(evidence),
        "MESSAGE_REBIND",
        "Request already has another answer",
      );
      return current;
    }
    return {
      ...current,
      status: "answered",
      acknowledged_at: current.acknowledged_at ?? now,
      reply: { body, evidence, at: now, ...(check && { check: check.capture() }) },
    };
  }

  admit(
    commit: (status: AdmissionStatus) => Effect.Effect<unknown, CrewError>,
    observed?: PromptAdmission,
  ) {
    const { runtime, request } = this;
    return Effect.gen(function* () {
      if (request.status !== "pending") {
        const admission =
          observed ??
          (yield* runtime.promptAdmission(
            request.recipient_session_id,
            request.prompt_id,
            request.prompt,
          ));
        if (admission !== "absent" && request.status === "admission_uncertain")
          yield* commit("admitted");
        return admission;
      }
      yield* commit("admission_uncertain");
      yield* runtime.prompt(
        request.recipient_session_id,
        request.prompt,
        request.prompt_id,
        request.delivery === "steer",
      );
      yield* commit("admitted");
      return "submitted" as const;
    });
  }

  wakeQueued(
    admission: PromptAdmission | "submitted",
    state: SessionState,
    stopped: boolean,
    beforeWake: Effect.Effect<void, CrewError>,
  ) {
    if (admission !== "queued" || state.executing !== false || stopped)
      return Effect.succeed(false);
    const { request, runtime } = this;
    return beforeWake.pipe(
      Effect.andThen(() =>
        runtime.prompt(
          request.recipient_session_id,
          request.prompt,
          request.prompt_id,
          request.delivery === "steer",
        ),
      ),
      Effect.as(true),
    );
  }
  reconcileReminder(
    host: ReminderTransport,
    observed?: NativeObservation,
  ): Effect.Effect<TransportOutcome, CrewError> {
    const { request, runtime } = this;
    return Effect.gen(function* () {
      const recovery = request.response_recovery;
      if (!recovery || recovery.status === "suppressed") return { settled: true, submitted: false };
      if (recovery.status === "pending") {
        if (host.prepare && !(yield* host.prepare)) return { settled: true, submitted: false };
        const state = yield* host.inspect("pending", recovery.prompt_id);
        if (!state) return { settled: false, submitted: false };
        const action = pendingReminder(state);
        if (action === "wait") return { settled: false, submitted: false };
        if (action === "suppress") {
          yield* host.setStatus("suppressed");
          yield* host.escalate(
            host.recipient === "worker"
              ? "Worker stopped before reminder admission"
              : "Reminder suppressed before native admission",
            state,
          );
          return { settled: true, submitted: false };
        }
        if (!(yield* host.setStatus("admission_uncertain"))) {
          if (host.recipient === "lead")
            yield* host.escalate("Reminder suppressed before native admission", state);
          return { settled: true, submitted: false };
        }
        yield* runtime.prompt(request.recipient_session_id, recovery.prompt, recovery.prompt_id);
        yield* host.setStatus("admitted");
        return { settled: false, submitted: true };
      }
      const admission =
        observed?.admission ??
        (yield* runtime.promptAdmission(
          request.recipient_session_id,
          recovery.prompt_id,
          recovery.prompt,
        ));
      if (admission === "absent") {
        yield* host.escalate(
          "Recovery admission uncertain; absence does not authorize resubmission",
          observed?.state,
        );
        return { settled: false, submitted: false };
      }
      if (recovery.status === "admission_uncertain") yield* host.setStatus("admitted");
      if (admission === "queued") {
        const state = observed?.state ?? (yield* host.inspect("queued", recovery.prompt_id));
        if (!state) return { settled: false, submitted: false };
        const action = queuedReminder(state);
        if (action === "escalate") {
          yield* host.escalate(
            host.recipient === "worker"
              ? "Worker stopped with the reminder still queued"
              : "Lead stopped with the reminder still queued",
            state,
          );
          return { settled: false, submitted: false };
        }
        if (action === "wake") {
          yield* host.beforeWake;
          yield* runtime.prompt(request.recipient_session_id, recovery.prompt, recovery.prompt_id);
        }
        return { settled: false, submitted: false };
      }
      return { settled: true, submitted: false };
    });
  }

  recover(
    recipient: "worker" | "lead",
    host: ResponseRecoveryHost<T>,
  ): Effect.Effect<void, CrewError> {
    const { request, runtime } = this;
    return Effect.gen(function* () {
      const recovery = request.response_recovery;
      if (host.reconcileExisting && recovery?.status === "suppressed") {
        if (requiresResponse(request))
          yield* host.escalate(
            "Reserved reminder suppressed before admission; explicit recovery required",
          );
        return;
      }
      const input = reminderTarget(request);
      const state = yield* runtime.session(request.recipient_session_id, input.prompt_id);
      yield* host.validateState(state);
      const admission = yield* runtime.promptAdmission(
        request.recipient_session_id,
        input.prompt_id,
        input.prompt,
      );
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
        const completion = state.assignment?.completion;
        if (!completion) return;
        const reminder = reserveReminder(
          completion,
          renderReminderPrompt(recipient, {
            requestId: request.request_id,
            generation: request.generation,
            response: request.response,
          }),
        );
        const outcome = yield* host.reserve(reminder);
        if (outcome.kind === "escalate") {
          yield* host.escalate(outcome.reason, state);
          return;
        }
        if (outcome.kind !== "reserved") return;
        yield* host.transport(outcome.request);
        return;
      }
      if (host.reconcileExisting) {
        const outcome = yield* host.transport(request, { state, admission });
        if (!outcome.settled || outcome.submitted) return;
      }
      const decision = reminderDecision(request, state, admission);
      if (decision.action === "escalate") yield* host.escalate(decision.reason, state);
    });
  }
}

interface ReminderTransport {
  readonly recipient: "worker" | "lead";
  readonly prepare?: Effect.Effect<boolean, CrewError>;
  readonly inspect: (
    stage: "pending" | "queued",
    prompt: MessageId,
  ) => Effect.Effect<SessionState | undefined, CrewError>;
  readonly setStatus: (status: RecoveryStatus) => Effect.Effect<boolean, CrewError>;
  readonly beforeWake: Effect.Effect<void, CrewError>;
  readonly escalate: (reason: string, state?: SessionState) => Effect.Effect<void, CrewError>;
}

type NativeObservation = { readonly state: SessionState; readonly admission: PromptAdmission };

interface TransportOutcome {
  readonly settled: boolean;
  readonly submitted: boolean;
}

type ReservationOutcome<T extends Request> =
  | { readonly kind: "skip" }
  | { readonly kind: "escalate"; readonly reason: string }
  | { readonly kind: "reserved"; readonly request: T };

interface ResponseRecoveryHost<T extends Request> {
  readonly manual: boolean;
  readonly validateState: (state: SessionState) => Effect.Effect<void, CrewError>;
  readonly reserve: (
    reminder: ReturnType<typeof reserveReminder>,
  ) => Effect.Effect<ReservationOutcome<T>, CrewError>;
  readonly escalate: (reason: string, state?: SessionState) => Effect.Effect<void, CrewError>;
  readonly transport: (
    request: T,
    observed?: NativeObservation,
  ) => Effect.Effect<TransportOutcome, CrewError>;
  /** When true, existing reminders are also reconciled & escalated in this pass (e.g. leads). */
  readonly reconcileExisting?: boolean;
}
