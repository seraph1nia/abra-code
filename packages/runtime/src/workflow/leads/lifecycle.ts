import { Effect } from "effect";
import { SessionMessage } from "@opencode/client/effect";
import { type IssueId, LockKey, type RequestId, timestamp } from "@abracode/contracts/identities";
import { requestPromptIDs, requiresResponse } from "@abracode/contracts/workflow/message-contracts";
import { type Config, CrewError } from "../../domain.ts";
import { type Runtime, type SessionState } from "../../opencode/runtime.ts";
import { type Locks } from "../../storage/lock.ts";
import { type Records } from "../../storage/store.ts";
import { readDiagnosticCapacity } from "../diagnostic-budget.ts";
import { deliverSyntheticNotice } from "../messaging/outbox.ts";
import { readLeads, type LeadRecord } from "./contracts.ts";
import { leadRequestKey, mapRequest, withRecoveryStatus } from "./control.ts";
import {
  DurableRequestChannel,
  formatNativeState,
  isUnresolvedRecovery,
  suppressReminder,
  type RecoveryStatus,
} from "../messaging/durable-request-channel.ts";
import type { LeadStore } from "./store.ts";
export class LeadLifecycle {
  constructor(
    private config: Config,
    private records: Records,
    private runtime: Runtime,
    private locks: Locks,
    private store: LeadStore,
    private request: (
      lead: LeadRecord,
      issue: IssueId,
      id: RequestId,
      text: string,
    ) => Effect.Effect<unknown, CrewError>,
  ) {}
  private assertLeadSession(
    state: SessionState,
    message = "Management recipient moved or changed agent",
  ) {
    return state.directory === this.config.home && state.agent === "project-lead"
      ? Effect.void
      : Effect.fail(new CrewError("LEAD_SESSION", message));
  }

  private escalate = (lead: LeadRecord, id: RequestId, reason: string, state?: SessionState) =>
    this.store.commit(() =>
      Effect.gen({ self: this }, function* () {
        const current = yield* this.store.current(lead.session_id, lead.revision);
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
        yield* this.store.save(next);
        return next;
      }),
    );

  /** Per-lead operation ownership; only record/budget reservations take coordination. */
  private recoverResponse = (lead: LeadRecord, id: RequestId) =>
    Effect.gen({ self: this }, function* () {
      let l = yield* this.store.current(lead.session_id, lead.revision);
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
      yield* new DurableRequestChannel(this.runtime, m).recover("lead", {
        manual: this.config.supervision_mode === "manual",
        reconcileExisting: true,
        validateState: (state) => this.assertLeadSession(state),
        escalate,
        reserve: (reminder) =>
          this.records.withActiveIndex(() =>
            Effect.gen({ self: this }, function* () {
              const current = yield* this.store.current(l.session_id, l.revision);
              const original = current.requests.find((r) => r.request.request_id === id)!;
              l = current;
              if (!requiresResponse(original.request) || original.request.response_recovery)
                return { kind: "skip" } as const;
              const task = yield* this.store.scoped(current, original.issue_id);
              const project = yield* this.records.project(task.repository_id);
              const e = yield* this.records.execution(original.issue_id);
              if (!project)
                return yield* new CrewError(
                  "PROJECT_MISSING",
                  "Lead repository is no longer registered",
                );
              const budget = e?.effective_policy.diagnostic_turns ?? project.diagnostic_turns;
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
              const attempt = yield* reminder;
              const next = {
                ...mapRequest(current, id, (r) => ({
                  ...r,
                  request: { ...r.request, response_recovery: attempt },
                })),
                active: true,
              };
              yield* this.store.save(next);
              l = next;
              return {
                kind: "reserved",
                request: next.requests.find((r) => r.request.request_id === id)!.request,
              } as const;
            }),
          ),
        transport: (request, observed) =>
          new DurableRequestChannel(this.runtime, request).reconcileReminder(
            {
              inspect: () =>
                this.runtime
                  .session(l.session_id)
                  .pipe(
                    Effect.tap((state) =>
                      this.assertLeadSession(
                        state,
                        "Management recipient moved before reminder admission",
                      ),
                    ),
                  ),
              setStatus: (status) =>
                this.store.commit(() =>
                  Effect.gen({ self: this }, function* () {
                    const current = yield* this.store.current(l.session_id, l.revision);
                    const item = current.requests.find((r) => r.request.request_id === id)!;
                    const suppressed =
                      status === "admission_uncertain" &&
                      suppressReminder(item.request, this.config.supervision_mode === "manual");
                    const finalStatus: RecoveryStatus = suppressed ? "suppressed" : status;
                    const next = withRecoveryStatus(current, id, finalStatus);
                    yield* this.store.save(next);
                    l = next;
                    return finalStatus !== "suppressed";
                  }),
                ),
              beforeWake: this.store.current(l.session_id, l.revision).pipe(Effect.asVoid),
              escalate,
              recipient: "lead",
            },
            observed,
          ),
      });
      return l;
    }).pipe(
      Effect.catch((error) =>
        this.escalate(
          lead,
          id,
          `Native recovery unavailable (${error.code}); inspect before explicit recovery`,
        ),
      ),
    );

  reconcileOne = (lead: LeadRecord): Effect.Effect<LeadRecord, CrewError> =>
    Effect.gen({ self: this }, function* () {
      let l = lead;
      if (!l.enabled || l.stop_pending) {
        if (l.stop_pending) {
          const owned = l.requests
            .filter((r) => r.request.recipient_session_id === l.session_id)
            .flatMap((r) => requestPromptIDs(r.request));
          yield* this.runtime.interrupt(l.session_id, owned[0], owned.slice(1));
          if ((yield* this.runtime.session(l.session_id)).busy)
            return yield* new CrewError("LEAD_STOP", "Management session stop remains uncertain");
          l = yield* this.store.updateLead(l.id, l, (current) =>
            current.session_id === l.session_id &&
            current.revision === l.revision &&
            current.stop_pending
              ? { ...current, active: false, stop_pending: false }
              : undefined,
          );
        }
        return l;
      }
      if (!l.provisioned) {
        yield* this.runtime.managementSession(l.session_id, l.parent_session_id, l.model, l.id);
        l = yield* this.store.updateLead(l.id, l, (current) =>
          current.session_id === l.session_id &&
          current.revision === l.revision &&
          current.enabled &&
          !current.stop_pending
            ? { ...current, provisioned: true }
            : undefined,
        );
        if (
          !l.enabled ||
          l.stop_pending ||
          l.session_id !== lead.session_id ||
          l.revision !== lead.revision
        )
          return l;
      }
      yield* this.assertLeadSession(
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
        const channel = new DurableRequestChannel(this.runtime, m);
        const admission = yield* channel.admit((status) =>
          this.store.commit(() =>
            Effect.gen({ self: this }, function* () {
              const current = yield* this.store.current(l.session_id, l.revision);
              l = mapRequest(current, m.request_id, (r) =>
                r.request.prompt_id === m.prompt_id
                  ? { ...r, request: DurableRequestChannel.reflectAdmission(r.request, status) }
                  : r,
              );
              yield* this.store.save(l);
            }),
          ),
        );
        if (admission === "absent") return l;
        const state = yield* this.runtime.session(l.session_id);
        yield* this.assertLeadSession(state, "Management session moved or changed agent");
        yield* channel.wakeQueued(
          admission,
          state,
          ["failed", "interrupted"].includes(state.outcome ?? ""),
          Effect.void,
        );
        l = yield* this.recoverResponse(l, m.request_id);
      }
      const state = yield* this.runtime.session(l.session_id);
      const hasPending = l.requests.some(
        (r) =>
          r.request.generation === l.revision &&
          (["pending", "admission_uncertain"].includes(r.request.status) ||
            ["pending", "admission_uncertain"].includes(r.request.response_recovery?.status ?? "")),
      );
      if (!state.busy && !state.completion_pending && !hasPending) {
        l = yield* this.store.commit(() =>
          Effect.gen({ self: this }, function* () {
            const current = yield* this.store.current(l.session_id, l.revision);
            if (!current.active) return current;
            const idle = { ...current, active: false };
            yield* this.store.save(idle);
            return idle;
          }),
        );
      }
      return l;
    }).pipe(
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
            this.store.updateLead(l.id, l, (current) =>
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
          l = yield* this.store.updateLead(l.id, l, (current) => {
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
            this.store.updateLead(l.id, l, (current) =>
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
            this.store.updateLead(l.id, l, (current) => ({
              ...current,
              proposals: current.proposals.map((p) =>
                p.request_id === proposal.request_id ? { ...p, notified: true } : p,
              ),
            })),
        );
      }
      return l;
    });

  scan = Effect.fn("Leads.scan")({ self: this }, function* () {
    const leads = yield* readLeads(this.records);
    const executions =
      this.config.supervision_mode === "manual" || !leads.length
        ? []
        : yield* this.records.executions;
    for (const initial of leads) {
      let l = initial;
      const lockKey = LockKey.make(`lead-${l.id}`);
      const routed = yield* this.locks
        .with(
          lockKey,
          () =>
            Effect.gen({ self: this }, function* () {
              const fresh = (yield* this.store.readById(l.id)) ?? l;
              const reconciled = yield* this.reconcileOne(fresh).pipe(
                Effect.catch(() => this.store.readById(l.id).pipe(Effect.map((r) => r ?? fresh))),
              );
              l = yield* this.notices(reconciled);
              if (!l.enabled || this.config.supervision_mode === "manual") return false;
              if (!l.routing_since) {
                const since = yield* timestamp;
                l = yield* this.store.updateLead(l.id, l, (current) =>
                  current.routing_since ? undefined : { ...current, routing_since: since },
                );
              }
              return true;
            }),
          { waitSeconds: 0 },
        )
        .pipe(
          Effect.catch((error) =>
            error.code === "LOCKED"
              ? Effect.succeed(false)
              : Effect.logWarning("Lead reconciliation failed", {
                  lead: l.id,
                  code: error.code,
                }).pipe(Effect.as(false)),
          ),
        );
      if (!routed) continue;
      for (const e of executions) {
        if (e.current_phase === "completed" && l.routing_since && e.updated_at < l.routing_since)
          continue;
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
        const id = leadRequestKey([l.id, l.revision, e.execution_id, e.control_generation, state]);
        if (l.requests.some((r) => r.request.request_id === id)) continue;
        yield* this.locks
          .with(
            lockKey,
            () =>
              Effect.gen({ self: this }, function* () {
                const current = yield* this.store.readById(l.id);
                if (
                  !current ||
                  !current.enabled ||
                  current.revision !== l.revision ||
                  !current.repositories.includes(e.repository_id)
                )
                  return;
                l = current;
                if (l.requests.some((r) => r.request.request_id === id)) return;
                yield* this.request(
                  l,
                  e.issue_id,
                  id,
                  `Work ${e.issue_id}: ${state}. ${decision?.question ?? "Inspect retained scoped status and report useful findings to Abra."}`,
                );
                l = (yield* this.store.readById(l.id)) ?? l;
              }),
            { waitSeconds: 0 },
          )
          .pipe(
            Effect.catch((error) =>
              error.code === "LOCKED"
                ? Effect.void
                : Effect.logWarning("Lead routing failed", { lead: l.id, code: error.code }),
            ),
          );
      }
    }
  });
}
