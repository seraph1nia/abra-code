import { Effect, Schema } from "effect";
import { Session, SessionMessage } from "@opencode/client/effect";
import { createHash } from "node:crypto";
import { CrewError, ensure, type Config } from "../domain.ts";
import { LockKey, RequestId, SessionId, type IssueId, timestamp } from "../identities.ts";
import { decode, decodeJSON } from "../decode.ts";
import { domainEffect } from "../effect.ts";
import { type Records } from "../storage/store.ts";
import { type Locks } from "../storage/lock.ts";
import { type Runtime } from "../opencode/runtime.ts";
import { type WorkGraph } from "../work/graph.ts";
import {
  BatchResultSchema,
  normalizeBatch,
  type BatchInput,
  type BatchResult,
} from "../work/batch.ts";
import { type Obligations } from "./obligations.ts";
import { type MessageSendSchema } from "./message-contracts.ts";
import { admitNativeRequest } from "./messages.ts";
import {
  LeadActionSchema,
  LeadControlSchema,
  LeadRecordSchema,
  leadKey,
  readLeads,
  leadAccounting,
  type LeadAction,
  type LeadControl,
  type LeadRecord,
} from "./lead-contracts.ts";
const key = (parts: readonly unknown[]) =>
  RequestId.make(`lead-${createHash("sha256").update(JSON.stringify(parts)).digest("hex")}`);
const json = (value: unknown) =>
  decodeJSON(Schema.Json, JSON.stringify(value), "Project lead result");

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
  ) {}
  private save(record: LeadRecord) {
    return decode(LeadRecordSchema, record, "Lead registration").pipe(
      Effect.flatMap((r) => this.records.store.set(leadKey(r.id), r)),
    );
  }
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
        ensure(
          (yield* this.records.supervisor()) === parent && !(yield* this.principal(parent)),
          "ABRA_REQUIRED",
          "Retained parent Abra required",
        );
        const state = yield* this.runtime.session(parent);
        ensure(
          state.agent === "abra" && state.directory === this.config.home,
          "ABRA_REQUIRED",
          "Central Abra required",
        );
      }),
    );
  }
  control = Effect.fn("Leads.control")(
    function* (this: Leads, parent: SessionId, raw: LeadControl) {
      const input = yield* decode(LeadControlSchema, raw, "Lead control");
      yield* this.root(parent);
      if (input.action === "status")
        return yield* json(
          (yield* readLeads(this.records)).filter((l) => !input.id || l.id === input.id),
        );
      return yield* this.locks.with(LockKey.make(`lead-${input.id}`), () =>
        domainEffect(
          Effect.gen({ self: this }, function* () {
            let l = (yield* readLeads(this.records)).find((r) => r.id === input.id);
            if (input.action === "register") {
              const repositories = [...input.repositories].sort();
              if (
                l &&
                l.parent_session_id === parent &&
                l.revision === input.expected_revision &&
                l.enabled === input.enabled &&
                JSON.stringify(l.repositories) === JSON.stringify(repositories) &&
                JSON.stringify(l.model) === JSON.stringify(input.model)
              ) {
                yield* this.reconcileOne(l);
                return yield* json((yield* readLeads(this.records)).find((r) => r.id === l!.id));
              }
              if (l && l.revision !== input.expected_revision) {
                // Same committed declaration is a retry, never a scope/session adoption.
                ensure(
                  l.revision === input.expected_revision + 1 &&
                    JSON.stringify(l.repositories) === JSON.stringify(repositories) &&
                    JSON.stringify(l.model) === JSON.stringify(input.model) &&
                    l.enabled === input.enabled &&
                    l.parent_session_id === parent,
                  "LEAD_REVISION",
                  "Registration changed; inspect current revision",
                );
              } else {
                ensure(
                  l ? l.parent_session_id === parent : input.expected_revision === 0,
                  "LEAD_REVISION",
                  "Current expected registration revision required",
                );
                for (const repo of repositories)
                  ensure(
                    yield* this.records.project(repo),
                    "LEAD_SCOPE",
                    "Registered repositories required",
                  );
                const changed =
                  l &&
                  (JSON.stringify(l.repositories) !== JSON.stringify(repositories) ||
                    JSON.stringify(l.model) !== JSON.stringify(input.model));
                ensure(
                  !changed || (!l!.enabled && !l!.active && !l!.stop_pending),
                  "LEAD_ACTIVE",
                  "Disable and confirm stop before changing scope or model",
                );
                ensure(
                  !l || l.retired_sessions.length < 32 || !changed,
                  "LEAD_LIMIT",
                  "Lead session revision limit reached",
                );
                ensure(
                  l || (yield* readLeads(this.records)).length < 32,
                  "LEAD_LIMIT",
                  "Registration limit reached",
                );
                const old = l;
                l = {
                  schema_version: 1,
                  id: input.id,
                  revision: (old?.revision ?? 0) + 1,
                  repositories,
                  parent_session_id: parent,
                  session_id: changed || !old ? Session.ID.create() : old.session_id,
                  retired_sessions: changed
                    ? [...old!.retired_sessions, old!.session_id]
                    : (old?.retired_sessions ?? []),
                  model: input.model,
                  enabled: input.enabled,
                  provisioned: changed ? false : (old?.provisioned ?? false),
                  active: old?.active ?? false,
                  stop_pending: !!old?.provisioned && !input.enabled,
                  requests:
                    old?.requests.map((r) => ({
                      ...r,
                      request: ["answered", "cancelled", "superseded"].includes(r.request.status)
                        ? r.request
                        : { ...r.request, status: "superseded" as const },
                    })) ?? [],
                  proposals: old?.proposals ?? [],
                };
                yield* this.records.coordinateCommit(() => this.save(l!));
              }
              yield* this.reconcileOne(l!);
              return yield* json((yield* readLeads(this.records)).find((r) => r.id === input.id));
            }
            ensure(
              l &&
                l.parent_session_id === parent &&
                l.enabled &&
                l.revision === input.revision &&
                !l.stop_pending,
              "LEAD_REVISION",
              "Current enabled lead required",
            );
            if (input.action === "message")
              return yield* json(
                yield* this.request(l, input.issue_id, input.request_id, input.body),
              );
            const p = l.proposals.find((p) => p.request_id === input.request_id);
            ensure(
              p && p.revision === l.revision,
              "LEAD_PROPOSAL",
              "Current retained proposal required",
            );
            if (!p.accepted) {
              const accepted = yield* this.createBatch(p.batch, parent).pipe(
                Effect.flatMap((r) => decode(BatchResultSchema, r, "Accepted lead proposal")),
              );
              l = { ...l, proposals: l.proposals.map((r) => (r === p ? { ...r, accepted } : r)) };
              yield* this.records.coordinateCommit(() => this.save(l!));
            }
            return yield* json(l.proposals.find((p) => p.request_id === input.request_id));
          }),
        ),
      );
    }.bind(this),
    domainEffect,
  );

  action = Effect.fn("Leads.action")(
    function* (this: Leads, session: SessionId, raw: LeadAction) {
      const a = yield* decode(LeadActionSchema, raw, "Lead action");
      // Short commits revalidate the native principal under the same controller lock
      // as disable, proposals and routine decision answers.
      const principal = yield* this.current(session, a.revision);
      return yield* this.locks.with(LockKey.make(`lead-${principal.id}`), () =>
        this.records
          .coordinateCommit(() =>
            domainEffect(
              Effect.gen({ self: this }, function* () {
                let l = yield* this.current(session, a.revision);
                if (a.action === "status") {
                  if (a.issue_id) yield* this.scoped(l, a.issue_id);
                  const tasks = (yield* this.work.list)
                    .filter(
                      (t) =>
                        l.repositories.includes(t.repository_id) &&
                        (!a.issue_id || a.issue_id === t.id),
                    )
                    .slice(0, 128);
                  const summaries = [];
                  for (const t of tasks) {
                    const e = yield* this.records.execution(t.id);
                    summaries.push({
                      id: t.id,
                      repository_id: t.repository_id,
                      title: t.title,
                      description: t.description,
                      status: t.status,
                      workflow_policy: t.workflow_policy,
                      phase: e?.current_phase,
                      decisions: e?.decisions
                        ?.filter((d) => d.status === "open")
                        .map((d) => ({
                          key: d.key,
                          generation: d.generation,
                          owner: d.owner,
                          question: d.question,
                        })),
                      findings: e?.messages?.filter((m) => m.type === "finding").slice(-20),
                      report: e?.report_receipt
                        ? { report_id: e.report_receipt.report_id, hash: e.report_receipt.hash }
                        : undefined,
                    });
                  }
                  return yield* json({
                    id: l.id,
                    revision: l.revision,
                    repositories: l.repositories,
                    tasks: summaries,
                    requests: l.requests.slice(-20),
                    proposals: l.proposals.slice(-8),
                    snapshot_at: yield* timestamp,
                  });
                }
                if (a.action === "reply") {
                  const r = l.requests.find((r) => r.request.request_id === a.request_id)?.request;
                  ensure(
                    r &&
                      r.generation === l.revision &&
                      r.recipient_session_id === session &&
                      ["admission_uncertain", "admitted", "acknowledged", "answered"].includes(
                        r.status,
                      ),
                    "MESSAGE_SENDER",
                    "Expected current correlated lead request required",
                  );
                  ensure(
                    !r.reply || r.reply.body === a.body,
                    "MESSAGE_REBIND",
                    "Request already has another answer",
                  );
                  const now = yield* timestamp;
                  l = {
                    ...l,
                    requests: l.requests.map((item) =>
                      item.request === r && !r.reply
                        ? {
                            ...item,
                            request: {
                              ...r,
                              status: "answered",
                              acknowledged_at: now,
                              reply: { body: a.body, evidence: [], at: now },
                            },
                          }
                        : item,
                    ),
                  };
                  yield* this.save(l);
                  return yield* json(l.requests.find((r) => r.request.request_id === a.request_id));
                }
                if (a.action === "propose") {
                  const batch = normalizeBatch(a.batch);
                  for (const task of batch.tasks) {
                    ensure(
                      l.repositories.includes(task.repository_id),
                      "LEAD_SCOPE",
                      "Proposed task is outside lead scope",
                    );
                    for (const d of task.dependencies ?? [])
                      if (d.type === "existing") yield* this.scoped(l, d.issue_id);
                    if (task.report_reference)
                      yield* this.scoped(l, task.report_reference.issue_id);
                  }
                  const old = l.proposals.find((p) => p.request_id === a.batch.request_id);
                  const proposed = {
                    ...batch,
                    request_id: key([l.id, l.revision, a.batch.request_id]),
                  };
                  ensure(
                    !old ||
                      (old.revision === l.revision &&
                        JSON.stringify(old.batch) === JSON.stringify(proposed)),
                    "LEAD_REBIND",
                    "Proposal identity cannot be rebound",
                  );
                  ensure(old || l.proposals.length < 32, "LEAD_LIMIT", "Proposal limit reached");
                  if (!old) {
                    l = {
                      ...l,
                      proposals: [
                        ...l.proposals,
                        {
                          request_id: a.batch.request_id,
                          revision: l.revision,
                          batch: proposed,
                          notice_id: SessionMessage.ID.create(),
                        },
                      ],
                    };
                    yield* this.save(l);
                  }
                  return yield* json(l.proposals.find((p) => p.request_id === a.batch.request_id));
                }
                yield* this.scoped(l, a.issue_id);
                if (a.action === "answer") {
                  const e = yield* this.records.execution(a.issue_id);
                  ensure(
                    e?.decisions?.some(
                      (d) =>
                        d.key === a.key &&
                        d.generation === a.generation &&
                        d.owner === "supervisor" &&
                        !d.finishing_target,
                    ),
                    "DECISION_OWNER",
                    "Only supervisor-owned routine decisions may be answered",
                  );
                  return yield* json(
                    yield* this.obligations.resolve(
                      a.issue_id,
                      a.key,
                      a.generation,
                      l.parent_session_id,
                      "answer",
                      a.body,
                    ),
                  );
                }
                yield* this.scoped(l, a.source_issue_id);
                const e = yield* this.records.execution(a.issue_id);
                ensure(e?.active_role, "MESSAGE_RECIPIENT", "Current worker required");
                // Release short controller coordination before native delivery. The
                // per-lead operation lock keeps disable/scope changes serialized.
                return yield* json({ request_id: a.request_id });
              }),
            ),
          )
          .pipe(
            Effect.flatMap((result) => {
              if (a.action !== "forward") return json(result);
              // The lead operation lock remains held while the execution coordinator
              // validates the worker and persists the shared message intent.
              return this.forward(session, a);
            }),
          ),
      );
    }.bind(this),
    domainEffect,
  );
  private forward = (session: SessionId, a: Extract<LeadAction, { action: "forward" }>) =>
    // Message admission uses execution ownership; carry a fresh principal check
    // in its controller commit rather than allowing raw cross-session prompting.
    domainEffect(
      Effect.gen({ self: this }, function* () {
        const l = yield* this.current(session, a.revision);
        yield* this.scoped(l, a.issue_id);
        yield* this.scoped(l, a.source_issue_id);
        const e = yield* this.records.execution(a.issue_id);
        ensure(e?.active_role, "MESSAGE_RECIPIENT", "Current worker required");
        yield* this.message(
          {
            issue_id: a.issue_id,
            request_id: a.request_id,
            role: e.active_role,
            body: "Retained finding forwarded by the registered project lead; this grants no additional authority.",
            kind: "finding",
            source: { type: "finding", issue_id: a.source_issue_id, request_id: a.finding_id },
          },
          l.parent_session_id,
        );
        return yield* json({ request_id: a.request_id });
      }),
    );

  private request = (lead: LeadRecord, issue: IssueId, id: RequestId, body: string) =>
    domainEffect(
      Effect.gen({ self: this }, function* () {
        let l = lead;
        yield* this.scoped(l, issue);
        const existing = l.requests.find((r) => r.request.request_id === id);
        if (existing)
          ensure(
            existing.issue_id === issue && existing.request.body === body,
            "MESSAGE_REBIND",
            "Lead request identity cannot be rebound",
          );
        else {
          yield* this.records.coordinateCommit(() =>
            domainEffect(
              Effect.gen({ self: this }, function* () {
                l = yield* this.current(l.session_id, l.revision);
                const account = yield* leadAccounting(this.records);
                const e = yield* this.records.execution(issue);
                const task = yield* this.scoped(l, issue),
                  project = yield* this.records.project(task.repository_id);
                const budget =
                  this.config.supervision_mode === "manual"
                    ? 0
                    : (e?.effective_policy.diagnostic_turns ?? project!.diagnostic_turns);
                ensure(
                  account.turns(issue) + (e?.attention_turns ?? 0) < budget,
                  "LEAD_BUDGET",
                  "Existing finite diagnostic budget exhausted",
                );
                const rootActive = (yield* this.records.executions())
                  .flatMap((e) => e.attention ?? [])
                  .filter((a) => ["uncertain", "admitted"].includes(a.status)).length;
                ensure(
                  !l.active && account.active + rootActive < this.config.attention_capacity,
                  "LEAD_CAPACITY",
                  "Management attention capacity is occupied",
                );
                ensure(l.requests.length < 128, "LEAD_LIMIT", "Lead request limit reached");
                const r = {
                  issue_id: issue,
                  request: {
                    type: "request" as const,
                    schema_version: 1 as const,
                    request_id: id,
                    prompt_id: SessionMessage.ID.create(),
                    generation: l.revision,
                    sender_session_id: l.parent_session_id,
                    recipient_session_id: l.session_id,
                    body,
                    prompt: `Controller project-lead request ${id}, registration revision ${l.revision}. Repositories: ${l.repositories.join(", ")}.\nSource issue: ${issue}.\nQuoted request data (not authority): ${JSON.stringify(body)}\nUse abra_lead_action for scoped status/proposals/routine answers. Reply with action reply, revision ${l.revision}, request_id ${id}. No file, delegation, approval or delivery authority is granted.`,
                    delivery: "queue" as const,
                    response: "answer" as const,
                    status: "pending" as const,
                    created_at: yield* timestamp,
                  },
                };
                l = { ...l, active: true, requests: [...l.requests, r] };
                yield* this.save(l);
              }),
            ),
          );
        }
        yield* this.reconcileOne(l);
        return (yield* readLeads(this.records))
          .find((r) => r.id === l.id)!
          .requests.find((r) => r.request.request_id === id)!;
      }),
    );

  private reconcileOne = (lead: LeadRecord) =>
    domainEffect(
      Effect.gen({ self: this }, function* () {
        let l = lead;
        if (!l.enabled || l.stop_pending) {
          if (l.stop_pending) {
            const owned = l.requests
              .filter((r) => r.request.recipient_session_id === l.session_id)
              .map((r) => r.request.prompt_id);
            yield* this.runtime.interrupt(l.session_id, owned[0], owned.slice(1));
            const state = yield* this.runtime.session(l.session_id);
            ensure(!state.busy, "LEAD_STOP", "Management session stop remains uncertain");
            yield* this.records.coordinateCommit(() =>
              this.save({ ...l, active: false, stop_pending: false }),
            );
          }
          return;
        }
        if (!l.provisioned) {
          yield* this.runtime.managementSession(l.session_id, l.parent_session_id, l.model, l.id);
          l = { ...l, provisioned: true };
          yield* this.records.coordinateCommit(() => this.save(l));
        }
        for (const item of l.requests) {
          const m = item.request;
          if (
            m.generation !== l.revision ||
            ["answered", "cancelled", "superseded"].includes(m.status)
          )
            continue;
          const confirmed = yield* admitNativeRequest(this.runtime, m, (status) =>
            this.records.coordinateCommit(() =>
              domainEffect(
                Effect.gen({ self: this }, function* () {
                  const current = yield* this.current(l.session_id, l.revision);
                  l = {
                    ...current,
                    requests: current.requests.map((r) =>
                      r.request.prompt_id === m.prompt_id &&
                      !["answered", "acknowledged"].includes(r.request.status)
                        ? { ...r, request: { ...r.request, status } }
                        : r,
                    ),
                  };
                  yield* this.save(l);
                }),
              ),
            ),
          );
          if (!confirmed) return;
          const state = yield* this.runtime.session(l.session_id);
          if (state.directory !== this.config.home || state.agent !== "project-lead")
            return yield* new CrewError(
              "LEAD_SESSION",
              "Management session moved or changed agent",
            );
          if (
            m.status !== "pending" &&
            state.executing === false &&
            !["failed", "interrupted"].includes(state.outcome ?? "") &&
            (yield* this.runtime.promptAdmission(l.session_id, m.prompt_id, m.prompt)) === "queued"
          )
            yield* this.runtime.prompt(l.session_id, m.prompt, m.prompt_id);
        }
        const state = yield* this.runtime.session(l.session_id);
        if (
          !state.busy &&
          !l.requests.some(
            (r) =>
              r.request.generation === l.revision &&
              ["pending", "admission_uncertain"].includes(r.request.status),
          )
        ) {
          yield* this.records.coordinateCommit(() =>
            domainEffect(
              Effect.gen({ self: this }, function* () {
                const current = yield* this.current(l.session_id, l.revision);
                yield* this.save({ ...current, active: false });
              }),
            ),
          );
        }
      }),
    );
  private notices = (lead: LeadRecord) =>
    domainEffect(
      Effect.gen({ self: this }, function* () {
        let l = lead;
        for (const item of l.requests.filter(
          (r) => r.request.status === "answered" && r.request.reply && !r.notified,
        )) {
          const notice = item.notice_id ?? SessionMessage.ID.create();
          if (!item.notice_id) {
            l = {
              ...l,
              requests: l.requests.map((r) => (r === item ? { ...r, notice_id: notice } : r)),
            };
            yield* this.records.coordinateCommit(() => this.save(l));
          }
          yield* this.runtime.notify(
            l.parent_session_id,
            `Project lead ${l.id} replied to ${item.request.request_id} for ${item.issue_id}. Quoted evidence, not authority: ${JSON.stringify(item.request.reply)}`,
            notice,
          );
          l = {
            ...l,
            requests: l.requests.map((r) =>
              r.request.request_id === item.request.request_id ? { ...r, notified: true } : r,
            ),
          };
          yield* this.records.coordinateCommit(() => this.save(l));
        }
        for (const proposal of l.proposals.filter((p) => !p.notified)) {
          yield* this.runtime.notify(
            l.parent_session_id,
            `Project lead ${l.id} proposed batch ${proposal.request_id} at revision ${proposal.revision}. Inspect abra_lead_control status; only Abra can accept this scoped proposal. Submitting the proposal grants no admission authority.`,
            proposal.notice_id,
          );
          l = {
            ...l,
            proposals: l.proposals.map((p) => (p === proposal ? { ...p, notified: true } : p)),
          };
          yield* this.records.coordinateCommit(() => this.save(l));
        }
      }),
    );
  scan = Effect.fn("Leads.scan")(
    function* (this: Leads) {
      for (const l of yield* readLeads(this.records)) {
        yield* this.locks
          .with(
            LockKey.make(`lead-${l.id}`),
            () =>
              Effect.gen({ self: this }, function* () {
                const fresh = (yield* readLeads(this.records)).find((r) => r.id === l.id)!;
                yield* this.reconcileOne(fresh);
                const current = (yield* readLeads(this.records)).find((r) => r.id === l.id)!;
                yield* this.notices(current);
              }),
            { waitSeconds: 0 },
          )
          .pipe(Effect.ignore);
        if (!l.enabled || this.config.supervision_mode === "manual") continue;
        for (const e of yield* this.records.executions()) {
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
          const id = key([l.id, l.revision, e.execution_id, e.control_generation, state]);
          if (l.requests.some((r) => r.request.request_id === id)) continue;
          yield* this.locks
            .with(
              LockKey.make(`lead-${l.id}`),
              () =>
                this.request(
                  l,
                  e.issue_id,
                  id,
                  `Work ${e.issue_id}: ${state}. ${decision?.question ?? "Inspect retained scoped status and report useful findings to Abra."}`,
                ),
              { waitSeconds: 0 },
            )
            .pipe(Effect.ignore);
        }
      }
    }.bind(this),
    domainEffect,
  );
  prompt = (
    session: SessionId,
    id: import("../identities.ts").MessageId,
    text: string,
    delivery: string,
  ) =>
    domainEffect(
      Effect.gen({ self: this }, function* () {
        const l = yield* this.principal(session);
        if (!l) return false;
        const m = l.requests.find((r) => r.request.prompt_id === id)?.request;
        ensure(
          l.enabled &&
            !l.stop_pending &&
            l.session_id === session &&
            m &&
            m.generation === l.revision &&
            m.prompt === text &&
            m.delivery === delivery &&
            ["admission_uncertain", "admitted", "acknowledged", "answered"].includes(m.status),
          "LEAD_PROMPT",
          "Project leads accept only retained controller requests",
        );
        return true;
      }),
    );
}
