import { Effect } from "effect";
import { type MessageId, type SessionId } from "@abracode/contracts/identities";
import { externalOwns } from "@abracode/contracts/validation/contracts";
import {
  messageRequests,
  requiresResponse,
  requestPromptIDs,
  type MessageIntent,
} from "@abracode/contracts/workflow/message-contracts";
import { CrewError, ensure, type Execution } from "../../domain.ts";
import { tryDomainValue } from "../../effect.ts";
import type { Runtime, SessionState, PromptAdmission } from "../../opencode/runtime.ts";
import type { Records } from "../../storage/store.ts";
import type { AttentionService } from "../attention.ts";
import type { Capacity } from "../capacity.ts";
import type { Queries } from "../queries.ts";
import { isActiveWorker, workerSessionID } from "../worker-assignment.ts";
import { diagnosticTurnsExhausted } from "../diagnostic-budget.ts";
import {
  DurableRequestChannel,
  isResolvableUncertainReminder,
  suppressReminder,
  type RecoveryStatus,
} from "./durable-request-channel.ts";

export function workerRecipient(e: Execution, m?: MessageIntent) {
  const session = workerSessionID(e);
  ensure(
    session && !externalOwns(e) && isActiveWorker(e, session),
    "MESSAGE_RECIPIENT",
    "No active eligible worker",
  );
  if (m)
    ensure(
      m.generation === e.control_generation &&
        m.assignment_id === e.prompt_id &&
        m.recipient_session_id === session &&
        m.role === e.active_role,
      "MESSAGE_STALE",
      "Message belongs to another assignment or generation",
    );
  return session;
}
/** Reconcile the worker's original native prompts and their single response-only reminders. */
export class WorkerMessageTransport {
  constructor(
    private records: Records,
    private runtime: Runtime,
    private capacity: Capacity,
    private queries: Queries,
    private attention: AttentionService,
  ) {}
  private status(e: Execution, m: MessageIntent, status: "admitted" | "admission_uncertain") {
    return this.records.update(e.issue_id, (current) => {
      workerRecipient(current, m);
      return {
        ...current,
        ...(current.capacity_reservation?.status === "preparing" &&
          status === "admission_uncertain" && {
            capacity_reservation: {
              ...current.capacity_reservation,
              status: "uncertain" as const,
            },
          }),
        messages: current.messages?.map((entry) =>
          entry.type !== "finding" && entry.prompt_id === m.prompt_id
            ? DurableRequestChannel.reflectAdmission(entry, status)
            : entry,
        ),
      };
    });
  }
  /** Only the native new-prompt guard calls this, before rejecting an unused reminder. */
  refuseResolvedReminder = Effect.fn("WorkerMessageTransport.refuseResolvedReminder")(
    { self: this },
    function* (
      e: Execution,
      session: SessionId,
      message: MessageId,
      text: string,
      delivery: string,
    ) {
      let refused = false;
      yield* this.records.update(e.issue_id, (current) => {
        if (
          !isActiveWorker(current, session) ||
          current.prompt_id !== e.prompt_id ||
          current.control_generation !== e.control_generation
        )
          return;
        const m = messageRequests(current.messages).find(
          (item) => item.response_recovery?.prompt_id === message,
        );
        if (
          !m ||
          m.recipient_session_id !== session ||
          m.generation !== current.control_generation ||
          m.assignment_id !== current.prompt_id ||
          m.role !== current.active_role ||
          !isResolvableUncertainReminder(m, text, delivery)
        )
          return;
        refused = true;
        return {
          ...current,
          messages: current.messages!.map((entry) =>
            entry === m
              ? {
                  ...m,
                  response_recovery: { ...m.response_recovery!, status: "suppressed" as const },
                }
              : entry,
          ),
        };
      });
      return refused;
    },
  );
  private recoveryStatus = Effect.fn("WorkerMessageTransport.recoveryStatus")(
    { self: this },
    function* (e: Execution, m: MessageIntent, status: RecoveryStatus) {
      let allowed = false;
      yield* this.records.update(e.issue_id, (current) => {
        workerRecipient(current, m);
        const messages = current.messages?.map((entry) => {
          if (entry.type === "finding" || entry.request_id !== m.request_id) return entry;
          const recovery = entry.response_recovery;
          ensure(
            recovery && recovery.prompt_id === m.response_recovery?.prompt_id,
            "MESSAGE_REBIND",
            "Recovery identity changed",
          );
          const suppressed =
            recovery.status === "pending" &&
            suppressReminder(entry, this.queries.settings.supervisionMode === "manual");
          allowed = !suppressed && status !== "suppressed";
          return {
            ...entry,
            response_recovery: {
              ...recovery,
              status: suppressed ? ("suppressed" as const) : status,
            },
          };
        });
        return {
          ...current,
          messages,
          ...(allowed &&
            status === "admission_uncertain" &&
            current.capacity_reservation?.status === "preparing" && {
              capacity_reservation: {
                ...current.capacity_reservation,
                status: "uncertain" as const,
              },
            }),
        };
      });
      return allowed;
    },
  );
  private recoveryTransport = Effect.fn("WorkerMessageTransport.recoveryTransport")(
    { self: this },
    function* (e: Execution, m: MessageIntent) {
      if (!m.response_recovery || m.response_recovery.status === "suppressed") return true;
      const session = yield* tryDomainValue(workerRecipient, e, m);
      const outcome = yield* new DurableRequestChannel(this.runtime, m).reconcileReminder({
        recipient: "worker",
        prepare: this.recoveryStatus(e, m, "pending").pipe(
          Effect.flatMap((allowed) =>
            allowed
              ? this.runtime.preflight(e, m.role).pipe(Effect.as(true))
              : Effect.succeed(false),
          ),
        ),
        inspect: (stage, reminder) =>
          Effect.gen({ self: this }, function* () {
            const bound = stage === "pending" ? e.prompt_id : reminder;
            const state = yield* this.runtime
              .session(session, bound)
              .pipe(
                Effect.catch((error) =>
                  bound === e.prompt_id && requiresResponse(m)
                    ? this.attention
                        .responseIncident(
                          e,
                          m,
                          `Native state unavailable (${error.code}); no recovery admission authorized`,
                        )
                        .pipe(Effect.as(undefined))
                    : Effect.fail(error),
                ),
              );
            if (state && state.directory !== e.worktree_directory)
              return yield* new CrewError(
                "SESSION_LOCATION",
                stage === "queued"
                  ? "Queued recovery recipient moved outside its owned worktree"
                  : "Recovery recipient moved outside its owned worktree",
              );
            return state;
          }),
        setStatus: (status) => this.recoveryStatus(e, m, status),
        beforeWake: Effect.gen({ self: this }, function* () {
          const current = yield* this.records.execution(e.issue_id);
          if (!current)
            return yield* new CrewError(
              "MESSAGE_STALE",
              "Execution disappeared during recovery reconciliation",
            );
          yield* tryDomainValue(workerRecipient, current, m);
          e = current;
        }),
        escalate: (reason, state) => this.attention.responseIncident(e, m, reason, state),
      });
      if (!outcome.submitted) yield* this.capacity.releaseIfPreparing(e, m.role);
      return outcome.settled;
    },
  );
  /** Called only with execution operation ownership; all native work stays outside coordination. */
  recover = Effect.fn("Messages.recover")({ self: this }, function* (e: Execution) {
    for (const m of messageRequests(e.messages)) {
      if (
        !requiresResponse(m) ||
        m.generation !== e.control_generation ||
        m.assignment_id !== e.prompt_id
      )
        continue;
      yield* Effect.gen({ self: this }, function* () {
        yield* tryDomainValue(workerRecipient, e, m);
        yield* new DurableRequestChannel(this.runtime, m).recover("worker", {
          manual: this.queries.settings.supervisionMode === "manual",
          validateState: (state) =>
            state.directory === e.worktree_directory
              ? Effect.void
              : Effect.fail(
                  new CrewError(
                    "SESSION_LOCATION",
                    "Recovery recipient moved outside its owned worktree",
                  ),
                ),
          escalate: (reason, state) => this.attention.responseIncident(e, m, reason, state),
          reserve: (reminder) =>
            this.records.withActiveIndex(() =>
              Effect.gen({ self: this }, function* () {
                const current = yield* this.records.execution(e.issue_id);
                if (!current)
                  return yield* new CrewError(
                    "MESSAGE_STALE",
                    "Execution disappeared before recovery reservation",
                  );
                yield* tryDomainValue(workerRecipient, current, m);
                const request = messageRequests(current.messages).find(
                  (entry) => entry.request_id === m.request_id,
                )!;
                e = current;
                if (!requiresResponse(request) || request.response_recovery)
                  return { kind: "skip" } as const;
                if (
                  yield* diagnosticTurnsExhausted(
                    this.records,
                    e.issue_id,
                    current.attention_turns,
                    current.effective_policy.diagnostic_turns,
                  )
                )
                  return {
                    kind: "escalate",
                    reason: "Diagnostic budget exhausted; no automatic reminder admitted",
                  } as const;
                const reservation = yield* this.capacity.reserve(
                  e,
                  m.role,
                  yield* this.queries.effectiveProject(e),
                  false,
                  m.request_id,
                );
                e = reservation.execution;
                if (!reservation.admitted) return { kind: "skip" } as const;
                const recovery = yield* reminder;
                e = yield* this.records.update(e.issue_id, (fresh) => ({
                  ...fresh,
                  attention_turns: (fresh.attention_turns ?? 0) + 1,
                  messages: fresh.messages?.map((entry) =>
                    entry.request_id === m.request_id && entry.type !== "finding"
                      ? { ...entry, response_recovery: recovery }
                      : entry,
                  ),
                }));
                const retained = messageRequests(e.messages).find(
                  (entry) => entry.request_id === m.request_id,
                )!;
                return { kind: "reserved", request: retained } as const;
              }),
            ),
          transport: (retained) =>
            this.recoveryTransport(e, retained).pipe(
              Effect.map((settled) => ({ settled, submitted: !settled })),
            ),
        });
      }).pipe(
        Effect.onError(() => this.capacity.releaseIfPreparing(e, m.role)),
        Effect.catch((error) =>
          this.attention.responseIncident(
            e,
            m,
            `Native recovery unavailable (${error.code}); inspect before explicit retry`,
          ),
        ),
      );
      e = yield* this.records.ownedSnapshot(e);
      // A reserved reminder owns capacity and may now be queued or executing.
      if (e.capacity_reservation) break;
    }
    return e;
  });
  /** False keeps capacity/checkpoints held; absence after submission is not non-admission. */
  reconcile = Effect.fn("WorkerMessageTransport.reconcile")(
    { self: this },
    function* (e: Execution) {
      const requests = messageRequests(e.messages).filter(
        (m) =>
          m.generation === e.control_generation &&
          m.assignment_id === e.prompt_id &&
          !["cancelled", "superseded"].includes(m.status),
      );
      if (!requests.length) return { execution: e, settled: true };
      // Native callbacks can persist message status, incidents and concurrent replies.
      const result = (settled: boolean) =>
        this.records.ownedSnapshot(e).pipe(Effect.map((execution) => ({ execution, settled })));
      const ownedPrompts = new Set(requests.flatMap(requestPromptIDs));
      let observation: SessionState | undefined;
      let queued: ReadonlySet<MessageId> | undefined;
      let admissions: ReadonlyMap<MessageId, PromptAdmission> | undefined;
      const invalidate = () => {
        observation = undefined;
        queued = undefined;
        admissions = undefined;
      };
      // A reply resolves business work, not a native queued instruction.
      const transportActive = (m: MessageIntent) =>
        !["answered", "acknowledged"].includes(m.status) ||
        requiresResponse(m) ||
        queued === undefined ||
        queued.has(m.prompt_id);
      for (const m of requests) {
        const session = yield* tryDomainValue(workerRecipient, e, m);
        if (
          !(yield* this.recoveryTransport(e, m).pipe(
            Effect.onError(() => this.capacity.releaseIfPreparing(e, m.role)),
            Effect.catch((error) =>
              this.attention
                .responseIncident(
                  e,
                  m,
                  `Recovery admission unavailable (${error.code}); preserve the exact identity`,
                )
                .pipe(Effect.as(false)),
            ),
          ))
        )
          return yield* result(false);
        // Recovery transport can submit/wake a prompt or merge a concurrent response.
        if (m.response_recovery && m.response_recovery.status !== "suppressed") invalidate();
        const state =
          observation ??
          (yield* this.runtime
            .session(session, e.prompt_id)
            .pipe(
              Effect.catch((error) =>
                requiresResponse(m)
                  ? this.attention
                      .responseIncident(
                        e,
                        m,
                        `Native state unavailable (${error.code}); no recovery admission authorized`,
                      )
                      .pipe(Effect.as(undefined))
                  : Effect.fail(error),
              ),
            ));
        if (!state) return yield* result(false);
        if (state !== observation)
          queued = state.queued_prompt_ids ? new Set(state.queued_prompt_ids) : undefined;
        observation = state;
        if (state.directory !== e.worktree_directory)
          return yield* new CrewError(
            "SESSION_LOCATION",
            "Message recipient moved outside its owned worktree",
          );
        if (!transportActive(m)) continue;
        const channel = new DurableRequestChannel(this.runtime, m);
        const commit = (status: "admission_uncertain" | "admitted") => this.status(e, m, status);
        if (m.status !== "pending") {
          admissions ??= yield* this.runtime
            .promptAdmissions(
              session,
              requests.filter((req) => req.status !== "pending" && transportActive(req)),
            )
            .pipe(
              Effect.catch((error) =>
                requiresResponse(m)
                  ? this.attention
                      .responseIncident(
                        e,
                        m,
                        `Native admission unavailable (${error.code}); preserve original identity`,
                        state,
                      )
                      .pipe(Effect.as(undefined))
                  : Effect.fail(error),
              ),
            );
          const observed = admissions?.get(m.prompt_id);
          if (!observed || observed === "absent") {
            if (requiresResponse(m))
              yield* this.attention.responseIncident(
                e,
                m,
                "Original request admission uncertain; absence cannot authorize another instruction",
                state,
              );
            return yield* result(false);
          }
          yield* channel.admit(commit, observed);
          const stopped =
            ["failed", "interrupted"].includes(state.assignment?.outcome ?? "") ||
            (["failed", "interrupted"].includes(state.outcome ?? "") &&
              (!state.outcome_prompt_id ||
                state.outcome_prompt_id === e.prompt_id ||
                ownedPrompts.has(state.outcome_prompt_id)));
          if (stopped && requiresResponse(m))
            yield* this.attention.responseIncident(
              e,
              m,
              "Worker failed or was interrupted; use explicit recovery rather than a queue wake",
              state,
            );
          if (
            yield* channel.wakeQueued(
              observed,
              state,
              stopped,
              Effect.gen({ self: this }, function* () {
                const current = yield* this.records.execution(e.issue_id);
                if (!current)
                  return yield* new CrewError(
                    "MESSAGE_STALE",
                    "Execution disappeared during queue reconciliation",
                  );
                yield* tryDomainValue(workerRecipient, current, m);
                e = current;
              }),
            )
          )
            invalidate();
          continue;
        }
        if (!state.busy && ["failed", "interrupted"].includes(state.outcome ?? ""))
          return yield* new CrewError(
            "MESSAGE_RECIPIENT",
            "Use the existing recovery route for failed or interrupted native work",
          );
        const admitted = yield* Effect.gen({ self: this }, function* () {
          if (!e.capacity_reservation) {
            const reservation = yield* this.capacity.reserve(
              e,
              m.role,
              yield* this.queries.effectiveProject(e),
              false,
              m.request_id,
            );
            e = reservation.execution;
            if (!reservation.admitted) return false;
          }
          yield* this.runtime.preflight(e, m.role);
          yield* channel.admit(commit);
          return true;
        }).pipe(Effect.onError(() => this.capacity.releaseIfPreparing(e, m.role)));
        if (!admitted) return yield* result(false);
        invalidate();
      }
      return yield* result(true);
    },
  );
}
