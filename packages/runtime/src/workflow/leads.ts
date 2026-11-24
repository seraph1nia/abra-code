import { Effect } from "effect";
import { SessionMessage } from "@opencode/client/effect";
import {
  type IssueId,
  type LeadId,
  LockKey,
  type MessageId,
  type RequestId,
  type SessionId,
  timestamp,
} from "@abracode/contracts/identities";
import {
  requestHistoryError,
  requestPromptIDs,
  requiresResponse,
  type MessageSendSchema,
} from "@abracode/contracts/workflow/message-contracts";
import { decode } from "../decode.ts";
import { ensure, type Config, type CrewError } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { type Runtime, type SessionState } from "../opencode/runtime.ts";
import { type Locks } from "../storage/lock.ts";
import { type Records } from "../storage/store.ts";
import { type BatchInput, type BatchResult } from "../work/batch.ts";
import { type WorkGraph } from "../work/graph.ts";
import { readDiagnosticCapacity } from "./diagnostic-budget.ts";
import { deliverSyntheticNotice } from "./durable-outbox.ts";
import {
  LeadRecordSchema,
  leadKey,
  readLeads,
  type LeadAction,
  type LeadControl,
  type LeadRecord,
} from "./lead-contracts.ts";
import {
  controlLead,
  createLeadRequest,
  executeLeadAction,
  leadRequestKey,
  mapRequest,
  verifyLeadPrompt,
  withRecoveryStatus,
  type LeadControlDeps,
} from "./leads-control.ts";
import { type Obligations } from "./obligations.ts";
import {
  admitNativeRequest,
  formatNativeState,
  isUnresolvedRecovery,
  reconcileReminderTransport,
  renderReminderPrompt,
  reserveReminder,
  runResponseRecovery,
  suppressReminder,
  type RecoveryStatus,
} from "./response-recovery.ts";

/** Management principals are separate from phase workers. Native sessions own context;
 * this bounded ledger owns only scope, routing and proposals, under controller locks. */
export class Leads {
  constructor(
    private config: Config,
    private records: Records,
    private work: WorkGraph,
    private runtime: Runtime,
    private locks: Locks,
    private obligations: Obligations,
    private createBatch: (
      input: BatchInput,
      parent: SessionId,
    ) => Effect.Effect<BatchResult, CrewError>,
    private message: (
      input: typeof MessageSendSchema.Type,
      parent: SessionId,
    ) => Effect.Effect<unknown, CrewError>,
    private memory?: import("../memory/service.ts").AgentMemory,
  ) {}

  private controlDeps(): LeadControlDeps {
    return {
      config: this.config,
      records: this.records,
      work: this.work,
      runtime: this.runtime,
      locks: this.locks,
      obligations: this.obligations,
      createBatch: this.createBatch,
      message: this.message,
      memory: this.memory,
      commit: (fn) => this.commit(fn),
      save: (record) => this.save(record),
      principal: this.principal,
      current: (session, revision) => this.current(session, revision),
      scoped: (lead, issue) => this.scoped(lead, issue),
      root: (parent) => this.root(parent),
      reconcileOne: this.reconcileOne,
    };
  }

  private commit<A>(fn: () => Effect.Effect<A, CrewError>) {
    return this.records.coordinateCommit(() => domainEffect(fn()));
  }

  private save(record: LeadRecord) {
    return domainEffect(
      Effect.gen({ self: this }, function* () {
        const r = yield* decode(LeadRecordSchema, record, "Lead registration");
        const prior = yield* this.records.store.get(leadKey(r.id));
        if (prior !== undefined) {
          const old = yield* decode(LeadRecordSchema, prior, "Retained lead registration");
          const byId = new Map(r.requests.map((item) => [item.request.request_id, item.request]));
          for (const item of old.requests) {
            const current = byId.get(item.request.request_id);
            ensure(current, "MESSAGE_HISTORY", "Retained lead request cannot be removed");
            const error = requestHistoryError(item.request, current);
            ensure(!error, "MESSAGE_HISTORY", error ?? "Invalid lead request history");
          }
        }
        yield* this.records.store.set(leadKey(r.id), r);
      }),
    );
  }

  private readById = (id: LeadId) =>
    this.records.store
      .get(leadKey(id))
      .pipe(
        Effect.flatMap((raw) =>
          raw === undefined
            ? Effect.undefined
            : decode(LeadRecordSchema, raw, "Retained lead registration"),
        ),
      );

  private updateLead = (
    id: LeadId,
    fallback: LeadRecord,
    transform: (current: LeadRecord) => LeadRecord | undefined,
  ) =>
    this.commit(() =>
      Effect.gen({ self: this }, function* () {
        const current = yield* this.readById(id);
        if (!current) return fallback;
        const next = transform(current);
        if (!next) return current;
        yield* this.save(next);
        return next;
      }),
    );

  principal = (session: SessionId) =>
    readLeads(this.records).pipe(
      Effect.map((ls) =>
        ls.find((l) => l.session_id === session || l.retired_sessions.includes(session)),
      ),
    );

  private current(session: SessionId, revision: number) {
    return domainEffect(
      Effect.gen({ self: this }, function* () {
        const l = yield* this.principal(session);
        ensure(
          l &&
            l.session_id === session &&
            l.revision === revision &&
            l.enabled &&
            l.provisioned &&
            !l.stop_pending,
          "LEAD_STALE",
          "Enabled current project-lead principal required",
        );
        return l;
      }),
    );
  }

  private scoped(l: LeadRecord, issue: IssueId) {
    return domainEffect(
      Effect.gen({ self: this }, function* () {
        const task = yield* this.work.show(issue);
        ensure(
          l.repositories.includes(task.repository_id),
          "LEAD_SCOPE",
          "Issue is outside the registered project scope",
        );
        return task;
      }),
    );
  }

  private root(parent: SessionId) {
    return domainEffect(
      Effect.gen({ self: this }, function* () {
        const supervisor = yield* this.records.supervisor();
        const leads = yield* readLeads(this.records);
        ensure(
          supervisor === parent &&
            !leads.some((l) => l.session_id === parent || l.retired_sessions.includes(parent)),
          "ABRA_REQUIRED",
          "Retained parent Abra required",
        );
        const state = yield* this.runtime.session(parent);
        ensure(
          state.agent === "abra" && state.directory === this.config.home,
          "ABRA_REQUIRED",
          "Central Abra required",
        );
        return leads;
      }),
    );
  }

  private assertLeadSession(
    state: SessionState,
    message = "Management recipient moved or changed agent",
  ) {
    ensure(
      state.directory === this.config.home && state.agent === "project-lead",
      "LEAD_SESSION",
      message,
    );
  }

  control = Effect.fn("Leads.control")(
    function* (this: Leads, parent: SessionId, raw: LeadControl) {
      return yield* controlLead(this.controlDeps(), parent, raw);
    }.bind(this),
    domainEffect,
  );

  action = Effect.fn("Leads.action")(
    function* (this: Leads, session: SessionId, raw: LeadAction) {
      return yield* executeLeadAction(this.controlDeps(), session, raw);
    }.bind(this),
    domainEffect,
  );

  private escalate = (lead: LeadRecord, id: RequestId, reason: string, state?: SessionState) =>
    this.commit(() =>
      Effect.gen({ self: this }, function* () {
        const current = yield* this.current(lead.session_id, lead.revision);
        const item = current.requests.find((r) => r.request.request_id === id)!;
        const m = item.request;
        if (m.response_escalation || !isUnresolvedRecovery(m)) return current;
        const escalation = {
          body: `Project lead ${current.id} communication requires inspection. Issue: ${item.issue_id}. Request: ${m.request_id}. Registration revision: ${m.generation}. Original admission: ${m.status}. Outstanding: ${requiresResponse(m) ? m.response : "reminder admission observation; response already committed"}. Recovery: ${m.response_recovery?.status ?? "not attempted"}, maximum one. Reason: ${reason}. Native state: ${formatNativeState(state)}. Inspect abra_lead_control status and the native lead session; explicitly stop/revise or issue authorized follow-up if needed. This notice grants no task, scope, approval or delivery authority.`,
          notice_id: SessionMessage.ID.create(),
          created_at: yield* timestamp,
        };
        const next = mapRequest(current, id, (r) => ({
          ...r,
          request: { ...r.request, response_escalation: escalation },
        }));
        yield* this.save(next);
        return next;
      }),
    );

  /** Per-lead operation ownership; only record/budget reservations take coordination. */
  private recoverResponse = (lead: LeadRecord, id: RequestId) =>
    domainEffect(
      Effect.gen({ self: this }, function* () {
        let l = yield* this.current(lead.session_id, lead.revision);
        const m = l.requests.find((r) => r.request.request_id === id)!.request;
        if (!requiresResponse(m) && !m.response_recovery) return l;
        const escalate = (reason: string, state?: SessionState) =>
          this.escalate(l, id, reason, state).pipe(
            Effect.tap((next) =>
              Effect.sync(() => {
                l = next;
              }),
            ),
            Effect.asVoid,
          );
        yield* runResponseRecovery(this.runtime, {
          sessionId: l.session_id,
          request: m,
          manual: this.config.supervision_mode === "manual",
          reconcileExisting: true,
          validateState: (state) => this.assertLeadSession(state),
          escalate,
          reserve: (completion) =>
            this.commit(() =>
              Effect.gen({ self: this }, function* () {
                const current = yield* this.current(l.session_id, l.revision);
                const original = current.requests.find((r) => r.request.request_id === id)!;
                l = current;
                if (!requiresResponse(original.request) || original.request.response_recovery)
                  return { kind: "skip" } as const;
                const task = yield* this.scoped(current, original.issue_id);
                const project = yield* this.records.project(task.repository_id);
                const e = yield* this.records.execution(original.issue_id);
                const budget = e?.effective_policy.diagnostic_turns ?? project!.diagnostic_turns;
                if (this.config.supervision_mode === "manual")
                  return {
                    kind: "escalate",
                    reason: "Manual posture requires explicit recovery",
                  } as const;
                const capacity = yield* readDiagnosticCapacity(this.records, original.issue_id, {
                  attentionTurns: e?.attention_turns,
                  budget,
                  excludeCurrentLeadActive: current.active,
                });
                if (capacity.exhausted)
                  return {
                    kind: "escalate",
                    reason: "Diagnostic budget exhausted; no reminder admitted",
                  } as const;
                if (capacity.totalActive >= this.config.attention_capacity)
                  return {
                    kind: "escalate",
                    reason: "Management capacity unavailable; no reminder admitted",
                  } as const;
                const attempt = yield* reserveReminder(
                  completion,
                  renderReminderPrompt("lead", { requestId: id, generation: l.revision }),
                );
                const next = {
                  ...mapRequest(current, id, (r) => ({
                    ...r,
                    request: { ...r.request, response_recovery: attempt },
                  })),
                  active: true,
                };
                yield* this.save(next);
                l = next;
                return {
                  kind: "reserved",
                  request: next.requests.find((r) => r.request.request_id === id)!.request,
                } as const;
              }),
            ),
          transport: (request, observed) =>
            reconcileReminderTransport(this.runtime, {
              sessionId: l.session_id,
              request,
              observedState: observed?.state,
              observedAdmission: observed?.admission,
              readState: () => this.runtime.session(l.session_id),
              validateState: (state) =>
                this.assertLeadSession(
                  state,
                  "Management recipient moved before reminder admission",
                ),
              setStatus: (status) =>
                this.commit(() =>
                  Effect.gen({ self: this }, function* () {
                    const current = yield* this.current(l.session_id, l.revision);
                    const item = current.requests.find((r) => r.request.request_id === id)!;
                    const suppressed =
                      status === "admission_uncertain" &&
                      suppressReminder(item.request, this.config.supervision_mode === "manual");
                    const finalStatus: RecoveryStatus = suppressed ? "suppressed" : status;
                    const next = withRecoveryStatus(current, id, finalStatus);
                    yield* this.save(next);
                    l = next;
                    return finalStatus !== "suppressed";
                  }),
                ),
              beforeWake: this.current(l.session_id, l.revision).pipe(Effect.asVoid),
              escalate,
              absentReason: "Recovery admission uncertain; preserve the original native identity",
              pendingStoppedReason: "Reminder suppressed before native admission",
              concurrentSuppressReason: "Reminder suppressed before native admission",
              queuedStoppedReason: "Lead stopped with the reminder still queued",
            }),
        });
        return l;
      }),
    ).pipe(
      Effect.catch((error) =>
        this.escalate(
          lead,
          id,
          `Native recovery unavailable (${error.code}); inspect before explicit recovery`,
        ),
      ),
    );

  private reconcileOne = (lead: LeadRecord): Effect.Effect<LeadRecord, CrewError> =>
    domainEffect(
      Effect.gen({ self: this }, function* () {
        let l = lead;
        if (!l.enabled || l.stop_pending) {
          if (l.stop_pending) {
            const owned = l.requests
              .filter((r) => r.request.recipient_session_id === l.session_id)
              .flatMap((r) => requestPromptIDs(r.request));
            yield* this.runtime.interrupt(l.session_id, owned[0], owned.slice(1));
            ensure(
              !(yield* this.runtime.session(l.session_id)).busy,
              "LEAD_STOP",
              "Management session stop remains uncertain",
            );
            l = { ...l, active: false, stop_pending: false };
            yield* this.commit(() => this.save(l));
          }
          return l;
        }
        if (!l.provisioned) {
          yield* this.runtime.managementSession(l.session_id, l.parent_session_id, l.model, l.id);
          l = { ...l, provisioned: true };
          yield* this.commit(() => this.save(l));
        }
        this.assertLeadSession(
          yield* this.runtime.session(l.session_id),
          "Management session moved or changed agent before admission",
        );
        for (const item of l.requests) {
          const m = item.request;
          if (
            m.generation !== l.revision ||
            ["cancelled", "superseded"].includes(m.status) ||
            (m.status === "answered" &&
              (!m.response_recovery || m.response_recovery.status === "suppressed"))
          )
            continue;
          const confirmed = yield* admitNativeRequest(this.runtime, m, (status) =>
            this.commit(() =>
              Effect.gen({ self: this }, function* () {
                const current = yield* this.current(l.session_id, l.revision);
                l = mapRequest(current, m.request_id, (r) =>
                  r.request.prompt_id === m.prompt_id &&
                  !["answered", "acknowledged"].includes(r.request.status)
                    ? { ...r, request: { ...r.request, status } }
                    : r,
                );
                yield* this.save(l);
              }),
            ),
          );
          if (!confirmed) return l;
          const state = yield* this.runtime.session(l.session_id);
          this.assertLeadSession(state, "Management session moved or changed agent");
          if (
            m.status !== "pending" &&
            state.executing === false &&
            !["failed", "interrupted"].includes(state.outcome ?? "") &&
            (yield* this.runtime.promptAdmission(l.session_id, m.prompt_id, m.prompt)) === "queued"
          )
            yield* this.runtime.prompt(l.session_id, m.prompt, m.prompt_id);
          l = yield* this.recoverResponse(l, m.request_id);
        }
        const state = yield* this.runtime.session(l.session_id);
        const hasPending = l.requests.some(
          (r) =>
            r.request.generation === l.revision &&
            (["pending", "admission_uncertain"].includes(r.request.status) ||
              ["pending", "admission_uncertain"].includes(
                r.request.response_recovery?.status ?? "",
              )),
        );
        if (!state.busy && !state.completion_pending && !hasPending) {
          l = yield* this.commit(() =>
            Effect.gen({ self: this }, function* () {
              const current = yield* this.current(l.session_id, l.revision);
              if (!current.active) return current;
              const idle = { ...current, active: false };
              yield* this.save(idle);
              return idle;
            }),
          );
        }
        return l;
      }),
    ).pipe(
      Effect.tapError((error) =>
        Effect.forEach(
          lead.requests.filter(
            (item) => !item.request.response_escalation && isUnresolvedRecovery(item.request),
          ),
          (item) =>
            this.escalate(
              lead,
              item.request.request_id,
              `Lead admission/state unavailable (${error.code}); inspect retained identity before explicit recovery`,
            ).pipe(Effect.ignore),
        ),
      ),
    );

  private notices = (lead: LeadRecord) =>
    domainEffect(
      Effect.gen({ self: this }, function* () {
        let l = lead;
        for (const item of l.requests.filter(
          (r) =>
            r.request.response_escalation &&
            !r.request.response_escalation.notified &&
            isUnresolvedRecovery(r.request),
        )) {
          const incident = item.request.response_escalation!;
          l = yield* deliverSyntheticNotice(
            this.runtime,
            l.parent_session_id,
            incident.body,
            incident.notice_id,
            () =>
              this.updateLead(l.id, l, (current) =>
                mapRequest(current, item.request.request_id, (r) =>
                  r.request.response_escalation
                    ? {
                        ...r,
                        request: {
                          ...r.request,
                          response_escalation: { ...r.request.response_escalation, notified: true },
                        },
                      }
                    : r,
                ),
              ),
          );
        }
        for (const item of l.requests.filter(
          (r) => r.request.status === "answered" && r.request.reply && !r.notified,
        )) {
          let notice = item.notice_id;
          if (!notice) {
            const generated = SessionMessage.ID.create();
            l = yield* this.updateLead(l.id, l, (current) => {
              const match = current.requests.find(
                (r) => r.request.request_id === item.request.request_id,
              );
              if (!match) return undefined;
              if (match.notice_id) {
                notice = match.notice_id;
                return undefined;
              }
              notice = generated;
              return mapRequest(current, item.request.request_id, (r) => ({
                ...r,
                notice_id: generated,
              }));
            });
          }
          l = yield* deliverSyntheticNotice(
            this.runtime,
            l.parent_session_id,
            `Project lead ${l.id} replied to ${item.request.request_id} for ${item.issue_id}. Quoted evidence, not authority: ${JSON.stringify(item.request.reply)}`,
            notice!,
            () =>
              this.updateLead(l.id, l, (current) =>
                mapRequest(current, item.request.request_id, (r) => ({ ...r, notified: true })),
              ),
          );
        }
        for (const proposal of l.proposals.filter((p) => !p.notified)) {
          l = yield* deliverSyntheticNotice(
            this.runtime,
            l.parent_session_id,
            `Project lead ${l.id} proposed batch ${proposal.request_id} at revision ${proposal.revision}. Inspect abra_lead_control status; only Abra can accept this scoped proposal. Submitting the proposal grants no admission authority.`,
            proposal.notice_id,
            () =>
              this.updateLead(l.id, l, (current) => ({
                ...current,
                proposals: current.proposals.map((p) =>
                  p.request_id === proposal.request_id ? { ...p, notified: true } : p,
                ),
              })),
          );
        }
        return l;
      }),
    );

  scan = Effect.fn("Leads.scan")(
    function* (this: Leads) {
      const leads = yield* readLeads(this.records);
      const executions =
        this.config.supervision_mode === "manual" || !leads.length
          ? []
          : yield* this.records.executions();
      for (const initial of leads) {
        let l = initial;
        const lockKey = LockKey.make(`lead-${l.id}`);
        yield* this.locks
          .with(
            lockKey,
            () =>
              Effect.gen({ self: this }, function* () {
                const fresh = (yield* this.readById(l.id)) ?? l;
                const reconciled = yield* this.reconcileOne(fresh).pipe(
                  Effect.catch(() => this.readById(l.id).pipe(Effect.map((r) => r ?? fresh))),
                );
                l = yield* this.notices(reconciled);
              }),
            { waitSeconds: 0 },
          )
          .pipe(Effect.ignore);
        if (!l.enabled || this.config.supervision_mode === "manual") continue;
        for (const e of executions) {
          if (!l.repositories.includes(e.repository_id)) continue;
          const decision = e.decisions?.find(
            (d) =>
              d.owner === "supervisor" &&
              d.status === "open" &&
              d.generation === e.control_generation &&
              !d.finishing_target,
          );
          const state = decision
            ? `decision:${decision.generation}:${decision.key}`
            : ["completed", "failed", "recovery_required"].includes(e.current_phase)
              ? e.current_phase
              : undefined;
          if (!state) continue;
          const id = leadRequestKey([
            l.id,
            l.revision,
            e.execution_id,
            e.control_generation,
            state,
          ]);
          if (l.requests.some((r) => r.request.request_id === id)) continue;
          yield* this.locks
            .with(
              lockKey,
              () =>
                Effect.gen({ self: this }, function* () {
                  const current = yield* this.readById(l.id);
                  if (!current || !current.enabled) return;
                  l = current;
                  if (l.requests.some((r) => r.request.request_id === id)) return;
                  yield* createLeadRequest(
                    this.controlDeps(),
                    l,
                    e.issue_id,
                    id,
                    `Work ${e.issue_id}: ${state}. ${decision?.question ?? "Inspect retained scoped status and report useful findings to Abra."}`,
                  );
                  l = (yield* this.readById(l.id)) ?? l;
                }),
              { waitSeconds: 0 },
            )
            .pipe(Effect.ignore);
        }
      }
    }.bind(this),
    domainEffect,
  );

  prompt = (session: SessionId, id: MessageId, text: string, delivery: string) =>
    verifyLeadPrompt(this.controlDeps(), session, id, text, delivery);
}
