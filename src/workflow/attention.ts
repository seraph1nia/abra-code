import { leadAccounting } from "./lead-contracts.ts";
import { pendingFindings } from "./feedback.ts";
import { messageRequests, requiresResponse, type MessageIntent } from "./message-contracts.ts";
import {
  LockKey,
  IncidentId,
  IssueId,
  MessageId,
  SessionId,
  ObligationKey,
} from "../identities.ts";

import { Clock, Effect } from "effect";
import { createHash } from "node:crypto";
import { SessionMessage } from "@opencode/schema/session-message";
import { CrewError, type Config, type Execution } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { type Records } from "../storage/store.ts";
import { type Runtime, type SessionState } from "../opencode/runtime.ts";
import { type Coordination } from "./coordination.ts";
import { type Locks } from "../storage/lock.ts";
import { type Attention } from "./attention-contracts.ts";
import { workerSessionID } from "./sessions.ts";
const hash = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 40);
const decisionKey = (generation: number, key: string) => `decision:${generation}:${hash(key)}`;
const hasDecision = (e: Execution, a: Attention) =>
  e.decisions?.some(
    (d) =>
      d.status === "open" &&
      d.generation === e.control_generation &&
      decisionKey(d.generation, d.key) === a.key,
  );
const paused = (e: Execution) =>
  e.stop_status !== undefined ||
  e.current_phase === "interrupted" ||
  e.current_phase === "completed";
type MessageReference = NonNullable<Attention["message_refs"]>[number];
const unresolvedMessage = (e: Execution, id: import("../identities.ts").RequestId) =>
  messageRequests(e.messages).some(
    (m) =>
      m.request_id === id &&
      (requiresResponse(m) ||
        (!["cancelled", "superseded"].includes(m.status) &&
          m.response_recovery?.status === "admission_uncertain")),
  );
function communicationReferences(e: Execution): MessageReference[] {
  const covered = new Set(
    e.attention?.flatMap((a) => a.message_refs?.map((r) => `${r.request_id}:${r.state}`) ?? []) ??
      [],
  );
  return (e.messages ?? [])
    .flatMap((m): MessageReference[] => {
      const state =
        m.type === "finding"
          ? "finding"
          : m.status === "answered"
            ? "answered"
            : m.status === "acknowledged" && m.response === "acknowledgement"
              ? "acknowledged"
              : undefined;
      return state && !covered.has(`${m.request_id}:${state}`)
        ? [{ request_id: m.request_id, state }]
        : [];
    })
    .sort((a, b) => a.request_id.localeCompare(b.request_id));
}
const pendingCommunicationNotice = (
  e: Execution,
  code: "message_update" | "message_pending" = "message_update",
) => e.attention?.find((a) => a.code === code && ["pending", "uncertain"].includes(a.status));
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
    function* (
      this: AttentionService,
      e: Execution,
      request: MessageIntent,
      reason: string,
      state?: SessionState,
    ) {
      const now = yield* Clock.currentTimeMillis;
      yield* this.records.update(e.issue_id, (current) => {
        const m = messageRequests(current.messages).find(
          (m) => m.request_id === request.request_id,
        );
        if (
          !m ||
          ["cancelled", "superseded"].includes(m.status) ||
          (!requiresResponse(m) && m.response_recovery?.status !== "admission_uncertain") ||
          current.stop_status ||
          m.generation !== current.control_generation ||
          m.assignment_id !== current.prompt_id
        )
          return;
        const key = `response:${m.generation}:${m.request_id}`;
        const evidence = `Worker communication requires inspection. Issue: ${current.issue_id}. Role: ${m.role}. Request: ${m.request_id}. Outstanding: ${requiresResponse(m) ? m.response : "reminder admission observation (business response already committed)"}. Original instruction: ${m.status}. Recovery: ${m.response_recovery?.status ?? "not attempted"} (maximum one). Last verified completion: ${m.response_recovery?.completed_at ?? state?.assignment?.completion?.at ?? "unavailable"}. Reason: ${reason}. Native state: ${state ? JSON.stringify({ executing: state.executing, busy: state.busy, outcome: state.outcome, completion: state.assignment?.completion }) : "unavailable"}. Inspect abra_work_messages using the original request identity; inspect the worker context and explicitly retry/resume if needed. Admission and escalation do not answer this request.`;
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
          throw new CrewError("ATTENTION_LIMIT", "Attention history is full");
        return {
          ...current,
          attention: [
            ...(current.attention ?? []),
            {
              schema_version: 1 as const,
              id: IncidentId.make(`incident-${hash(`${current.execution_id}:${key}`)}`),
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
    }.bind(this),
    domainEffect,
  );
  guard = Effect.fn("Attention.guard")(
    function* (
      this: AttentionService,
      session: SessionId,
      message: MessageId,
      diagnosticAllowed: boolean,
    ) {
      const owned = (yield* this.records.executions())
        .flatMap((e) => e.attention ?? [])
        .filter((a) => a.session_id === session && a.prompt_id);
      if (!owned.length) return;
      const origin = yield* this.runtime.promptOrigin(session, message);
      if (origin && !owned.some((a) => a.prompt_id === origin)) return;
      if (!diagnosticAllowed)
        return yield* new CrewError(
          "ATTENTION_AUTHORITY",
          "A diagnostic turn cannot start, resume, steer, revise scope or deliver work. Use the finite correction route for supported in-scope findings or request an explicit user action.",
        );
    }.bind(this),
    domainEffect,
  );
  observe = Effect.fn("Attention.observe")(
    function* (this: AttentionService, session: SessionId) {
      const assigned = (yield* this.records.executions()).find(
        (e) => workerSessionID(e) === session,
      );
      if (!assigned || paused(assigned)) return;
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
    }.bind(this),
    domainEffect,
  );
  scan = Effect.fn("Attention.scan")(
    function* (this: AttentionService, id?: IssueId) {
      const executions = id
        ? [yield* this.records.execution(id)]
        : yield* this.records.executions();
      yield* Effect.forEach(
        executions
          .filter((e) => e !== undefined)
          .filter(
            (e) =>
              !paused(e) ||
              (!e.stop_status &&
                e.current_phase === "completed" &&
                (communicationReferences(e).length > 0 || pendingCommunicationNotice(e))),
          ),
        (record) =>
          this.locks
            .with(
              LockKey.make(`attention-${hash(record.execution_id)}`),
              () =>
                domainEffect(
                  Effect.gen({ self: this }, function* () {
                    const sid = workerSessionID(record);
                    if (sid) yield* this.observe(sid).pipe(Effect.ignore);
                    yield* this.records.update(record.issue_id, (current) => {
                      const obsolete = (a: Attention) => {
                        if (["handled", "superseded"].includes(a.status)) return false;
                        if (a.generation !== current.control_generation) return true;
                        if (a.code === "decision_pending") return !hasDecision(current, a);
                        if (a.code === "message_pending")
                          return !a.message_refs?.some((r) =>
                            unresolvedMessage(current, r.request_id),
                          );
                        if (a.code === "suspected_stall")
                          return (
                            // Reaching this controller checkpoint proves that the
                            // observed worker made progress. Retain exhausted
                            // history, but do not strand an active diagnostic slot.
                            (current.current_phase === "awaiting_plan_approval" &&
                              ["pending", "uncertain", "admitted"].includes(a.status)) ||
                            (current.progress?.generation === a.generation &&
                              (!a.observed_session ||
                                current.progress.session_id === a.observed_session) &&
                              current.progress.at > a.created_at) ||
                            (!current.active_role &&
                              !current.worker_failure &&
                              !current.error_or_recovery_reason &&
                              ["awaiting_merge", "cleaning", "completed"].includes(
                                current.current_phase,
                              ) &&
                              !!current.delivered_commit)
                          );
                        if (a.code === "cleanup_blocked")
                          return (
                            current.current_phase === "cleaning" &&
                            (!current.cleanup_blocker ||
                              a.key !==
                                `cleanup:${current.control_generation}:${current.cleanup_blocker.preservation}:${current.cleanup_blocker.fingerprint}`)
                          );
                        if (a.code === "operation_stall")
                          return (
                            current.operation?.status === "completed" &&
                            current.operation.id === a.observed_operation
                          );
                        return false;
                      };
                      const stale = current.attention?.some(obsolete);
                      if (!stale) return;
                      return {
                        ...current,
                        attention: current.attention?.map((a) =>
                          obsolete(a)
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
                    const invalid = e.waits?.find(
                      (w) =>
                        w.generation === e.control_generation &&
                        (w.status === "invalid" ||
                          w.status === "expired" ||
                          (w.status === "waiting" && w.expires_at <= now)),
                    );
                    const waiting = e.waits?.some(
                      (w) =>
                        w.generation === e.control_generation &&
                        w.status === "waiting" &&
                        w.expires_at > now,
                    );
                    let code: Attention["code"] | undefined;
                    let evidence = "";
                    const messageRefs = communicationReferences(e);
                    const missingReplies = messageRefs.filter((r) => r.state === "unanswered");
                    const replies = messageRefs.filter((r) => r.state !== "unanswered");
                    const pendingNotice = pendingCommunicationNotice(e);
                    const pendingBlocker = pendingCommunicationNotice(e, "message_pending");
                    const decisions =
                      e.decisions?.filter(
                        (d) => d.status === "open" && d.generation === e.control_generation,
                      ) ?? [];
                    const decision = decisions.find(
                      (d) =>
                        !e.attention?.some(
                          (a) =>
                            a.key === decisionKey(d.generation, d.key) &&
                            !["pending", "uncertain"].includes(a.status),
                        ),
                    );
                    const feedback = pendingFindings(e.feedback);
                    if (decision) {
                      code = "decision_pending";
                      evidence = JSON.stringify({
                        key: decision.key,
                        generation: decision.generation,
                        owner: decision.owner,
                        question: decision.question,
                        scope: decision.scope,
                      }).slice(0, 8192);
                    } else if (decisions.length) return;
                    else if (
                      feedback.length &&
                      (e.current_phase === "awaiting_merge" ||
                        (e.current_phase === "blocked" && !!e.delivery_block)) &&
                      !e.session_intent &&
                      !(
                        e.operation?.action === "correct" &&
                        ["prepared", "running", "uncertain"].includes(e.operation.status)
                      ) &&
                      !e.active_role &&
                      !e.capacity_reservation &&
                      e.delivered_commit
                    ) {
                      code = "pr_feedback";
                      evidence = JSON.stringify(
                        feedback.map((f) => ({
                          id: f.id,
                          revision: f.revision,
                          kind: f.kind,
                          url: f.url,
                        })),
                      ).slice(0, 8192);
                    } else if (
                      e.cleanup_blocker?.generation === e.control_generation &&
                      !e.error_or_recovery_reason &&
                      e.current_phase === "cleaning"
                    ) {
                      code = "cleanup_blocked";
                      evidence = `Delivery preserved; cleanup requires file disposition in the owned worktree. ${JSON.stringify(e.cleanup_blocker.paths).slice(0, 6000)}${e.cleanup_blocker.truncated ? " (truncated sample)" : ""}. Inspect status for captured generated paths and next action; this is not deletion authority.`;
                    } else if (invalid) {
                      code = invalid.status === "invalid" ? "wait_invalid" : "wait_expired";
                      evidence = `${invalid.condition}; owner: ${invalid.owner}; expires: ${invalid.expires_at}`;
                    } else if (e.command_wait && now <= e.command_wait.deadline_at) return;
                    else if (
                      e.worker_failure &&
                      e.current_phase === "failed" &&
                      e.worker_failure.session_id === workerSessionID(e)
                    ) {
                      code = "worker_failure";
                      evidence = `${e.worker_failure.error.type}: ${e.worker_failure.error.message}`;
                    } else if (missingReplies.length || pendingBlocker) {
                      code = "message_pending";
                      evidence =
                        pendingBlocker?.evidence ??
                        `Required worker responses remain unanswered. Inspect abra_work_messages for these retained request identities: ${JSON.stringify(missingReplies)}. A completed native turn is not an answer. Preserve scope and existing approval gates.`;
                    } else if (replies.length || pendingNotice) {
                      code = "message_update";
                      evidence =
                        pendingNotice?.evidence ??
                        `Worker replies/findings are retained. Inspect abra_work_messages before making decisions: ${JSON.stringify(replies)}. This evidence grants no scope, approval or delivery authority.`;
                    } else if (
                      waiting ||
                      e.capacity_wait ||
                      e.delivery_wait ||
                      ["awaiting_plan_approval", "awaiting_merge"].includes(e.current_phase) ||
                      e.decisions?.some(
                        (d) =>
                          d.status === "open" &&
                          d.owner === "user" &&
                          d.generation === e.control_generation,
                      )
                    )
                      return;
                    else {
                      const role = e.active_role;
                      const last =
                        e.progress?.at ?? e.worker_started_at ?? e.operation?.started_at ?? now;
                      const limit = this.config.progress_timeout_ms[role ?? "operation"];
                      if (
                        now - last >= limit &&
                        (role ||
                          (e.operation &&
                            ["prepared", "running", "uncertain"].includes(e.operation.status)))
                      ) {
                        code = role ? "suspected_stall" : "operation_stall";
                        evidence = `No meaningful progress since ${last}; role ${role ?? "controller"}; operation ${e.operation?.action ?? "none"}; last progress ${e.progress?.summary ?? "worker admission"}`;
                      }
                    }
                    if (!code) return;
                    const refs =
                      code === "message_pending"
                        ? missingReplies
                        : code === "message_update"
                          ? replies
                          : undefined;
                    const key =
                      pendingBlocker && code === "message_pending"
                        ? pendingBlocker.key
                        : pendingNotice && code === "message_update"
                          ? pendingNotice.key
                          : refs?.length
                            ? `messages:${e.control_generation}:${code}:${hash(JSON.stringify(refs))}`
                            : decision
                              ? decisionKey(decision.generation, decision.key)
                              : code === "cleanup_blocked"
                                ? `cleanup:${e.control_generation}:${e.cleanup_blocker!.preservation}:${e.cleanup_blocker!.fingerprint}`
                                : code === "pr_feedback"
                                  ? `pr_feedback:${e.control_generation}:${e.delivered_commit}:${hash(evidence)}`
                                  : `${e.control_generation}:${e.prompt_id ?? "controller"}:${code}:${invalid?.key ?? e.worker_failure?.at ?? e.progress?.at ?? e.worker_started_at ?? e.operation?.started_at}`;
                    const incident = yield* this.coordination.with(() =>
                      domainEffect(
                        Effect.gen({ self: this }, function* () {
                          const current = (yield* this.records.execution(e.issue_id))!;
                          if (
                            (paused(current) &&
                              !(
                                current.current_phase === "completed" &&
                                code === "message_update" &&
                                !current.stop_status
                              )) ||
                            current.control_generation !== e.control_generation
                          )
                            return;
                          const existing = current.attention?.find(
                            (a) => a.key === key && a.generation === current.control_generation,
                          );
                          if (existing) return existing;
                          if (!((current.attention?.length ?? 0) < 256))
                            return yield* new CrewError(
                              "ATTENTION_LIMIT",
                              "Attention history is full",
                            );
                          const a: Attention = {
                            message_refs: refs,
                            schema_version: 1,
                            id: IncidentId.make(`incident-${hash(`${e.execution_id}:${key}`)}`),
                            observed_operation:
                              code === "operation_stall" ? e.operation?.id : undefined,
                            observed_session:
                              code === "suspected_stall" ? workerSessionID(e) : undefined,
                            observed_prompt: code === "suspected_stall" ? e.prompt_id : undefined,
                            key,
                            generation: e.control_generation,
                            code: code!,
                            batch:
                              code === "pr_feedback"
                                ? {
                                    schema_version: 1,
                                    head: e.delivered_commit!,
                                    findings: feedback.map((f) => ({
                                      id: f.id,
                                      revision: f.revision,
                                    })),
                                  }
                                : undefined,
                            evidence: evidence.slice(0, 8192),
                            created_at: now,
                            attempts: 0,
                            status: "pending",
                          };
                          current.attention = [...(current.attention ?? []), a];
                          yield* this.records.save(current);
                          return a;
                        }),
                      ),
                    );
                    if (incident && ["pending", "uncertain"].includes(incident.status))
                      yield* this.dispatch(e.issue_id, incident.id);
                  }),
                ),
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
    }.bind(this),
    domainEffect,
  );
  private dispatch = Effect.fn("Attention.dispatch")(
    function* (this: AttentionService, id: IssueId, incidentID: IncidentId) {
      const prepared = yield* this.coordination.with(() =>
        domainEffect(
          Effect.gen({ self: this }, function* () {
            const e = (yield* this.records.execution(id))!;
            const a = e.attention!.find((a) => a.id === incidentID)!;
            if (
              (paused(e) &&
                !(
                  e.current_phase === "completed" &&
                  a.code === "message_update" &&
                  !e.stop_status
                )) ||
              a.generation !== e.control_generation ||
              !["pending", "uncertain"].includes(a.status)
            )
              return;
            if (a.code === "decision_pending" && !hasDecision(e, a)) {
              e.attention = e.attention!.map((item) =>
                item.id === a.id ? { ...item, status: "superseded" as const } : item,
              );
              yield* this.records.save(e);
              return;
            }
            const supervisor =
              a.session_id ?? e.supervisor_session_id ?? (yield* this.records.supervisor());
            const admitted = (yield* this.records.executions())
              .flatMap((record) => record.attention ?? [])
              .filter(
                (item) => item.id !== a.id && ["uncertain", "admitted"].includes(item.status),
              );
            if (a.code === "decision_pending") {
              // Native queued admission serializes the explanatory turn. Mandatory forms
              // are delivered separately and never need this optional diagnostic slot.
              if (
                admitted.some(
                  (item) => item.code === "decision_pending" && item.session_id === supervisor,
                )
              )
                return;
            }
            // Posture controls new reasoning admission, never approval ownership.
            // Leave suppressed notices pending, so returning to attended mode can
            // route the same durable incident rather than minting a replacement.
            if (
              !a.prompt_id &&
              ((this.config.supervision_mode === "manual" && a.code !== "decision_pending") ||
                (this.config.supervision_mode === "unattended" &&
                  a.code === "decision_pending" &&
                  e.decisions?.some(
                    (d) =>
                      d.owner === "user" &&
                      d.status === "open" &&
                      decisionKey(d.generation, d.key) === a.key,
                  )))
            )
              return;
            const leads = yield* leadAccounting(this.records);
            const budget = Math.max(
              0,
              e.effective_policy.diagnostic_turns - leads.turns(e.issue_id),
            );
            // Routing a declared question is required even when optional diagnostics are disabled.
            const diagnostic = a.code !== "decision_pending";
            const exhausted = diagnostic && !a.prompt_id && (e.attention_turns ?? 0) >= budget;
            // Preserve the finite diagnostic budget for outstanding business responses.
            // Keep routine outcomes pending so they can be reported after recovery.
            if (
              !a.prompt_id &&
              a.code === "message_update" &&
              !exhausted &&
              messageRequests(e.messages).some(
                (m) =>
                  m.generation === e.control_generation &&
                  m.assignment_id === e.prompt_id &&
                  requiresResponse(m) &&
                  !m.response_recovery,
              )
            )
              return;
            if (
              diagnostic &&
              !exhausted &&
              admitted.length + leads.active >= this.config.attention_capacity
            )
              return;

            const next: Attention = {
              ...a,
              session_id: supervisor,
              prompt_id:
                a.prompt_id ?? (supervisor && !exhausted ? SessionMessage.ID.create() : undefined),
              attempts: a.attempts + 1,
              status: exhausted
                ? "exhausted"
                : a.attempts >= 3
                  ? "unavailable"
                  : supervisor
                    ? "uncertain"
                    : "unavailable",
            };
            if (exhausted && a.code === "pr_feedback") {
              const key = ObligationKey.make(`feedback-budget-${a.id}`);
              if (!e.decisions?.some((d) => d.key === key))
                e.decisions = [
                  ...(e.decisions ?? []),
                  {
                    schema_version: 1,
                    key,
                    generation: e.control_generation,
                    scope: e.workflow_policy,
                    question: "PR feedback requires inspection; diagnostic budget is exhausted",
                    owner: "user",
                    session_id: "controller",
                    opened_at: yield* Clock.currentTimeMillis,
                    status: "open",
                  },
                ];
            }
            if (diagnostic && !a.prompt_id && next.prompt_id)
              e.attention_turns = (e.attention_turns ?? 0) + 1;
            e.attention = e.attention!.map((a) => (a.id === incidentID ? next : a));
            yield* this.records.save(e);
            return { e, a: next };
          }),
        ),
      );
      if (!prepared?.a.prompt_id || prepared.a.status !== "uncertain") return;
      const { e, a } = prepared;
      let promptAttempted = false;
      const result = yield* Effect.result(
        domainEffect(
          Effect.gen({ self: this }, function* () {
            const state = yield* this.runtime.session(a.session_id!);
            if (!(state.directory === this.config.home))
              return yield* new CrewError(
                "SUPERVISOR_LOCATION",
                "Retained Supervisor is outside the central checkout",
              );
            yield* this.runtime.switchModel(
              a.session_id!,
              e.configuration_snapshot?.supervisor ?? this.config.supervisor_model,
            );
            const latest = (yield* this.records.execution(id))!;
            if (
              !(
                (!paused(latest) ||
                  (latest.current_phase === "completed" &&
                    a.code === "message_update" &&
                    !latest.stop_status)) &&
                latest.control_generation === a.generation
              )
            )
              return yield* new CrewError(
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
        ),
      );
      yield* this.coordination.with(() =>
        domainEffect(
          Effect.gen({ self: this }, function* () {
            const current = (yield* this.records.execution(id))!;
            const deliveredAt = yield* Clock.currentTimeMillis;
            current.attention = current.attention!.map((item) =>
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
            );
            yield* this.records.save(current);
          }),
        ),
      );
    }.bind(this),
    domainEffect,
  );
  disposition = (
    id: IssueId,
    incident: IncidentId,
    generation: number,
    action: "handled" | "user_needed" | "retry",
    reason: string,
  ) =>
    domainEffect(
      Effect.gen({ self: this }, function* () {
        yield* this.coordination.with(() =>
          domainEffect(
            Effect.gen({ self: this }, function* () {
              const e = yield* this.records.execution(id);
              if (!(e?.control_generation === generation))
                return yield* new CrewError("ATTENTION_STALE", "Attention generation changed");
              const a = e.attention?.find((a) => a.id === incident && a.generation === generation);
              if (!a) return yield* new CrewError("ATTENTION_MISSING", "Incident missing");
              if (!(reason.length > 0 && reason.length <= 8192))
                return yield* new CrewError(
                  "ATTENTION_DISPOSITION",
                  "Bounded disposition required",
                );
              if (action === "retry") {
                if (!(a.status === "unavailable" && !paused(e) && a.attempts < 3))
                  return yield* new CrewError(
                    "ATTENTION_RETRY",
                    "Only an unavailable incident has a bounded explicit retry",
                  );
              }
              e.attention = e.attention!.map((a) =>
                a.id === incident
                  ? { ...a, status: action === "retry" ? "pending" : action, disposition: reason }
                  : a,
              );
              yield* this.records.save(e);
            }),
          ),
        );
        if (action === "retry") yield* this.dispatch(id, incident);
        return (yield* this.records.execution(id))!;
      }),
    );
}
