import { WorkflowError } from "../errors.ts";
import { tryDomainValue } from "../effect.ts";
import { executionAuthority } from "./execution-authority.ts";
import {
  attentionId,
  attentionLock,
  paused,
  allowsAttention,
  hasDecision,
  detectAttention,
  isObsoleteAttention,
  shouldScanAttention,
  planAttentionDelivery,
} from "./attention-policy.ts";
import {
  messageRequests,
  requiresResponse,
  type MessageIntent,
} from "@abracode/contracts/workflow/message-contracts";
import {
  IncidentId,
  IssueId,
  MessageId,
  SessionId,
  ObligationKey,
} from "@abracode/contracts/identities";
import { Clock, Effect } from "effect";
import { SessionMessage } from "@opencode/schema/session-message";
import { type Config, type Execution } from "../domain.ts";
import { type Records } from "../storage/store.ts";
import { type Runtime, type SessionState } from "../opencode/runtime.ts";
import { type Coordination } from "./coordination.ts";
import { type Locks } from "../storage/lock.ts";
import { type Attention } from "@abracode/contracts/workflow/attention-contracts";
import { workerSessionID } from "./worker-assignment.ts";
import { readDiagnosticCapacity } from "./diagnostic-budget.ts";
import { appendDecision, makeControllerDecision } from "./decision-ledger.ts";
import { formatNativeState, isUnresolvedRecovery } from "./messaging/durable-request-channel.ts";

/** Observations never grant authority. Admission and handling are retained separately. */
export class AttentionService {
  constructor(
    private config: Config,
    private records: Records,
    private runtime: Runtime,
    private coordination: Coordination,
    private locks: Locks,
  ) {}
  /** One original-request incident; detection does not dispatch a model or answer it. */
  responseIncident = Effect.fn("Attention.responseIncident")(
    { self: this },
    function* (e: Execution, request: MessageIntent, reason: string, state?: SessionState) {
      const now = yield* Clock.currentTimeMillis;
      yield* this.records.update(e.issue_id, (current) => {
        const m = messageRequests(current.messages).find(
          (item) => item.request_id === request.request_id,
        );
        if (
          !m ||
          !isUnresolvedRecovery(m) ||
          current.stop_status ||
          m.generation !== current.control_generation ||
          m.assignment_id !== current.prompt_id
        )
          return;
        const key = `response:${m.generation}:${m.request_id}`;
        const evidence = `Worker communication requires inspection. Issue: ${current.issue_id}. Role: ${m.role}. Request: ${m.request_id}. Outstanding: ${requiresResponse(m) ? m.response : "reminder admission observation (business response already committed)"}. Original instruction: ${m.status}. Recovery: ${m.response_recovery?.status ?? "not attempted"} (maximum one). Last verified completion: ${m.response_recovery?.completed_at ?? state?.assignment?.completion?.at ?? "unavailable"}. Reason: ${reason}. Native state: ${formatNativeState(state)}. Inspect abra_work_messages using the original request identity; inspect the worker context and explicitly retry/resume if needed. Admission and escalation do not answer this request.`;
        const existing = current.attention?.find(
          (a) =>
            a.generation === m.generation &&
            a.code === "message_pending" &&
            a.message_refs?.some((r) => r.request_id === m.request_id),
        );
        if (existing) {
          if (existing.evidence === evidence) return;
          return {
            ...current,
            attention: current.attention!.map((a) =>
              a.id === existing.id ? { ...a, evidence } : a,
            ),
          };
        }
        if ((current.attention?.length ?? 0) >= 256)
          throw new WorkflowError("ATTENTION_LIMIT", "Attention history is full");
        return {
          ...current,
          attention: [
            ...(current.attention ?? []),
            {
              schema_version: 1 as const,
              id: attentionId(current, key),
              key,
              generation: m.generation,
              code: "message_pending" as const,
              message_refs: [
                {
                  request_id: m.request_id,
                  state: requiresResponse(m)
                    ? ("unanswered" as const)
                    : m.status === "answered"
                      ? ("answered" as const)
                      : ("acknowledged" as const),
                },
              ],
              evidence,
              created_at: now,
              attempts: 0,
              status: "pending" as const,
            },
          ],
        };
      });
    },
  );
  guard = Effect.fn("Attention.guard")(
    { self: this },
    function* (session: SessionId, message: MessageId, diagnosticAllowed: boolean) {
      if (diagnosticAllowed) return;
      const owned = (yield* executionAuthority(this.records)).prompts.get(session);
      if (!owned?.size) return;
      const origin = yield* this.runtime.promptOrigin(session, message);
      if (!origin || owned.has(origin))
        return yield* new WorkflowError(
          "ATTENTION_AUTHORITY",
          "A diagnostic turn cannot start, resume, steer, revise scope or deliver work. Use the finite correction route for supported in-scope findings or request an explicit user action.",
        );
    },
  );
  observe = Effect.fn("Attention.observe")({ self: this }, function* (session: SessionId) {
    const assigned = yield* this.records.workerAssignment(session);
    if (!assigned || workerSessionID(assigned) !== session || paused(assigned)) return;
    const state = yield* this.runtime.session(session);
    if (!state.activity || state.activity.at < (assigned.worker_started_at ?? 0)) return;
    const activity = state.activity;
    const at = yield* Clock.currentTimeMillis;
    yield* this.records.update(assigned.issue_id, (e) => {
      if (
        paused(e) ||
        workerSessionID(e) !== session ||
        e.control_generation !== assigned.control_generation ||
        e.progress?.identity === activity.identity
      )
        return;
      return {
        ...e,
        progress: {
          schema_version: 1,
          generation: e.control_generation,
          session_id: session,
          at,
          summary: activity.summary,
          identity: activity.identity,
          source: "native",
        },
      };
    });
  });
  scan = Effect.fn("Attention.scan")({ self: this }, function* (id?: IssueId) {
    const executions = id ? [yield* this.records.execution(id)] : yield* this.records.executions;
    yield* Effect.forEach(
      executions.filter((e) => e !== undefined).filter(shouldScanAttention),
      (record) =>
        this.locks
          .with(
            attentionLock(record),
            () =>
              Effect.gen({ self: this }, function* () {
                const sid = workerSessionID(record);
                if (sid) yield* this.observe(sid).pipe(Effect.ignore);
                yield* this.records.update(record.issue_id, (current) => {
                  if (!current.attention?.some((a) => isObsoleteAttention(current, a))) return;
                  return {
                    ...current,
                    attention: current.attention.map((a) =>
                      isObsoleteAttention(current, a)
                        ? {
                            ...a,
                            status: "superseded" as const,
                            disposition:
                              "Superseded by current generation, meaningful progress or confirmed finishing postcondition",
                          }
                        : a,
                    ),
                  };
                });
                const e = (yield* this.records.execution(record.issue_id))!;
                const now = yield* Clock.currentTimeMillis;
                const detected = detectAttention(e, now, this.config);
                if (!detected || detected.kind === "suppress") return;
                const { code, key, evidence, refs, batch } = detected;
                const incident = yield* this.coordination.with(() =>
                  Effect.gen({ self: this }, function* () {
                    let current = (yield* this.records.execution(e.issue_id))!;
                    if (
                      !allowsAttention(current, code) ||
                      current.control_generation !== e.control_generation
                    )
                      return;
                    const existing = current.attention?.find(
                      (a) => a.key === key && a.generation === current.control_generation,
                    );
                    if (existing) return existing;
                    if (!((current.attention?.length ?? 0) < 256))
                      return yield* new WorkflowError(
                        "ATTENTION_LIMIT",
                        "Attention history is full",
                      );
                    const a: Attention = {
                      message_refs: refs,
                      schema_version: 1,
                      id: attentionId(e, key),
                      observed_operation: code === "operation_stall" ? e.operation?.id : undefined,
                      observed_session: code === "suspected_stall" ? workerSessionID(e) : undefined,
                      observed_prompt: code === "suspected_stall" ? e.prompt_id : undefined,
                      key,
                      generation: e.control_generation,
                      code,
                      batch,
                      evidence: evidence.slice(0, 8192),
                      created_at: now,
                      attempts: 0,
                      status: "pending",
                    };
                    current = { ...current, attention: [...(current.attention ?? []), a] };
                    yield* this.records.saveOwned(current, ["attention"]);
                    return a;
                  }),
                );
                if (incident && ["pending", "uncertain"].includes(incident.status))
                  yield* this.deliver(record.issue_id, incident.id);
              }),
            { waitSeconds: 0 },
          )
          .pipe(
            Effect.catchIf(
              (error) => error.code === "LOCKED",
              () => Effect.void,
            ),
          ),
      { concurrency: Math.max(1, Math.min(this.config.max_workers, 4)) },
    );
  });
  private dispatch = Effect.fn("Attention.dispatch")(
    { self: this },
    function* (id: IssueId, incidentID: IncidentId) {
      const record = yield* this.records.execution(id);
      if (!record) return;
      return yield* this.locks.with(attentionLock(record), () => this.deliver(id, incidentID));
    },
  );
  private deliver = Effect.fn("Attention.deliver")(
    { self: this },
    function* (id: IssueId, incidentID: IncidentId) {
      const prepared = yield* this.records.withActiveIndex(() =>
        Effect.gen({ self: this }, function* () {
          let e = (yield* this.records.execution(id))!;
          const a = e.attention!.find((item) => item.id === incidentID)!;
          if (
            !allowsAttention(e, a.code) ||
            a.generation !== e.control_generation ||
            !["pending", "uncertain"].includes(a.status)
          )
            return;
          if (a.code === "decision_pending" && !hasDecision(e, a)) {
            e = {
              ...e,
              attention: e.attention!.map((item) =>
                item.id === a.id ? { ...item, status: "superseded" as const } : item,
              ),
            };
            e = yield* this.records.saveOwned(e, ["attention"]);
            return;
          }
          const supervisor =
            a.session_id ?? e.supervisor_session_id ?? (yield* this.records.supervisor);
          const capacity = yield* readDiagnosticCapacity(this.records, e.issue_id, {
            attentionTurns: e.attention_turns,
            budget: e.effective_policy.diagnostic_turns,
            excludeIncidentId: a.id,
          });
          const plan = planAttentionDelivery(e, a, supervisor, capacity, this.config);
          if (!plan) return;
          const next: Attention = {
            ...a,
            session_id: supervisor,
            prompt_id: a.prompt_id ?? (plan.reservePrompt ? SessionMessage.ID.create() : undefined),
            attempts: a.attempts + 1,
            status: plan.status,
          };
          if (plan.status === "exhausted" && a.code === "pr_feedback") {
            const key = ObligationKey.make(`feedback-budget-${a.id}`);
            if (!e.decisions?.some((d) => d.key === key)) {
              e = {
                ...e,
                decisions: yield* tryDomainValue(
                  appendDecision,
                  e.decisions,
                  makeControllerDecision({
                    key,
                    generation: e.control_generation,
                    scope: e.workflow_policy,
                    question: "PR feedback requires inspection; diagnostic budget is exhausted",
                    openedAt: yield* Clock.currentTimeMillis,
                  }),
                ),
              };
            }
          }
          if (plan.chargeDiagnostic) e = { ...e, attention_turns: (e.attention_turns ?? 0) + 1 };
          e = {
            ...e,
            attention: e.attention!.map((item) => (item.id === incidentID ? next : item)),
          };
          e = yield* this.records.saveOwned(e, ["decisions", "attention_turns", "attention"]);
          return { e, a: next };
        }),
      );
      if (!prepared?.a.prompt_id || prepared.a.status !== "uncertain") return;
      const { e, a } = prepared;
      let promptAttempted = false;
      const result = yield* Effect.result(
        Effect.gen({ self: this }, function* () {
          const state = yield* this.runtime.session(a.session_id!);
          if (state.directory !== this.config.home)
            return yield* new WorkflowError(
              "SUPERVISOR_LOCATION",
              "Retained Supervisor is outside the central checkout",
            );
          yield* this.runtime.switchModel(
            a.session_id!,
            e.configuration_snapshot?.supervisor ?? this.config.supervisor_model,
          );
          const latest = (yield* this.records.execution(id))!;
          if (!allowsAttention(latest, a.code) || latest.control_generation !== a.generation)
            return yield* new WorkflowError(
              "ATTENTION_PAUSED",
              "Attention suppressed by a control change",
            );
          promptAttempted = true;
          yield* this.runtime.prompt(
            a.session_id!,
            `AbraCode attention for ${e.issue_id}. Incident ${a.id}, generation ${a.generation}: ${a.code}. ${a.evidence}\n${a.code === "decision_pending" ? "A worker is waiting on a retained decision. Inspect abra_work_status for its full question, key, generation and owner. Use abra_work_decision to answer a supervisor-owned question from available evidence, or collect a user-owned question through its native form. If user input is needed, bring the question to this conversation. Record handled only after routing or answering it, or user_needed with a concrete blocker. A decision answer grants no plan or merge approval." : ""}\n${a.batch ? `PR feedback batch: ${JSON.stringify(a.batch)}. Inspect abra_work_feedback_status for exact retained source text, original/assessed heads and dispositions. Classify against accepted scope with abra_work_feedback. Only already-enabled finite repair policy may authorize abra_work_correct; uncertain or scope-changing findings require decisions.` : ""}\nInspect abra_work_status/abra_work_diagnostics, then record abra_work_attention disposition. One diagnostic turn is authorized; this notice grants no repair, resume, plan, merge or deletion authority. Retain any pause and ask the user when authority is missing.`,
            a.prompt_id!,
          );
        }),
      );
      yield* this.coordination.with(() =>
        Effect.gen({ self: this }, function* () {
          let current = (yield* this.records.execution(id))!;
          const deliveredAt = yield* Clock.currentTimeMillis;
          current = {
            ...current,
            attention: current.attention!.map((item) =>
              item.id !== a.id || ["handled", "user_needed", "superseded"].includes(item.status)
                ? item
                : {
                    ...item,
                    status:
                      result._tag === "Success"
                        ? "admitted"
                        : promptAttempted && ["message_update", "message_pending"].includes(a.code)
                          ? "uncertain"
                          : "unavailable",
                    ...(result._tag === "Success"
                      ? { delivered_at: deliveredAt }
                      : { disposition: result.failure.message.slice(0, 8192) }),
                  },
            ),
          };
          yield* this.records.saveOwned(current, ["attention"]);
        }),
      );
    },
  );
  disposition = (
    id: IssueId,
    incident: IncidentId,
    generation: number,
    action: "handled" | "user_needed" | "retry",
    reason: string,
  ) =>
    Effect.gen({ self: this }, function* () {
      yield* this.coordination.with(() =>
        Effect.gen({ self: this }, function* () {
          let e = yield* this.records.execution(id);
          if (e?.control_generation !== generation)
            return yield* new WorkflowError("ATTENTION_STALE", "Attention generation changed");
          const a = e.attention?.find((a) => a.id === incident && a.generation === generation);
          if (!a) return yield* new WorkflowError("ATTENTION_MISSING", "Incident missing");
          if (!(reason.length > 0 && reason.length <= 8192))
            return yield* new WorkflowError(
              "ATTENTION_DISPOSITION",
              "Bounded disposition required",
            );
          if (action === "retry" && !(a.status === "unavailable" && !paused(e) && a.attempts < 3))
            return yield* new WorkflowError(
              "ATTENTION_RETRY",
              "Only an unavailable incident has a bounded explicit retry",
            );
          e = {
            ...e,
            attention: e.attention!.map((item) =>
              item.id === incident
                ? {
                    ...item,
                    status: action === "retry" ? "pending" : action,
                    disposition: reason,
                  }
                : item,
            ),
          };
          yield* this.records.saveOwned(e, ["attention"]);
        }),
      );
      if (action === "retry") yield* this.dispatch(id, incident);
      return (yield* this.records.execution(id))!;
    });
}
