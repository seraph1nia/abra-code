import { pendingFindings } from "./feedback.ts";
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
import { type Runtime } from "../opencode/runtime.ts";
import { type Coordination } from "./coordination.ts";
import { type Locks } from "../storage/lock.ts";
import { type Attention } from "./attention-contracts.ts";
import { workerSessionID } from "./sessions.ts";
const hash = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 40);
const paused = (e: Execution) =>
  e.stop_status !== undefined ||
  e.current_phase === "interrupted" ||
  e.current_phase === "completed";
/** Observations never grant authority. Admission and handling are retained separately. */
export class AttentionService {
  constructor(
    private config: Config,
    private records: Records,
    private runtime: Runtime,
    private coordination: Coordination,
    private locks: Locks,
  ) {}
  guard = Effect.fn("Attention.guard")(
    function* (this: AttentionService, session: SessionId, message: MessageId, tool: string) {
      const owned = (yield* this.records.executions())
        .flatMap((e) => e.attention ?? [])
        .filter((a) => a.session_id === session && a.prompt_id);
      if (!owned.length) return;
      const origin = yield* this.runtime.promptOrigin(session, message);
      if (origin && !owned.some((a) => a.prompt_id === origin)) return;
      const diagnostic = new Set([
        "config_status",
        "project_list",
        "work_list",
        "work_ready",
        "work_status",
        "work_diagnostics",
        "work_report",
        "work_findings",
        "work_feedback_status",
        "work_feedback",
        "work_attention",
        "work_decision",
        "work_wait_disposition",
        "work_correct",
      ]);
      if (!diagnostic.has(tool))
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
        executions.filter((e) => e !== undefined).filter((e) => !paused(e)),
        (record) =>
          this.locks
            .with(
              LockKey.make(`attention-${hash(record.execution_id)}`),
              () =>
                domainEffect(
                  Effect.gen({ self: this }, function* () {
                    const sid = workerSessionID(record);
                    if (sid) yield* this.observe(sid).pipe(Effect.ignore);
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
                    const feedback = pendingFindings(e.feedback);
                    if (
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
                    const key =
                      code === "pr_feedback"
                        ? `pr_feedback:${e.control_generation}:${e.delivered_commit}:${hash(evidence)}`
                        : `${e.control_generation}:${e.prompt_id ?? "controller"}:${code}:${invalid?.key ?? e.worker_failure?.at ?? e.progress?.at ?? e.worker_started_at ?? e.operation?.started_at}`;
                    const incident = yield* this.coordination.with(() =>
                      domainEffect(
                        Effect.gen({ self: this }, function* () {
                          const current = (yield* this.records.execution(e.issue_id))!;
                          if (
                            paused(current) ||
                            current.control_generation !== e.control_generation
                          )
                            return;
                          const existing =
                            current.attention?.find((a) => a.key === key) ??
                            current.attention?.find(
                              (a) => !["handled", "user_needed", "superseded"].includes(a.status),
                            );
                          if (existing) return existing;
                          if (!((current.attention?.length ?? 0) < 256))
                            return yield* new CrewError(
                              "ATTENTION_LIMIT",
                              "Attention history is full",
                            );
                          const a: Attention = {
                            schema_version: 1,
                            id: IncidentId.make(`incident-${hash(`${e.execution_id}:${key}`)}`),
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
              paused(e) ||
              a.generation !== e.control_generation ||
              !["pending", "uncertain"].includes(a.status)
            )
              return;
            const supervisor =
              a.session_id ?? e.supervisor_session_id ?? (yield* this.records.supervisor());
            const admitted = (yield* this.records.executions())
              .flatMap((record) => record.attention ?? [])
              .filter(
                (item) => item.id !== a.id && ["uncertain", "admitted"].includes(item.status),
              );
            if (admitted.length >= this.config.attention_capacity) return;
            const budget = e.effective_policy.diagnostic_turns;
            const exhausted = !a.prompt_id && (e.attention_turns ?? 0) >= budget;
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
            if (!a.prompt_id && next.prompt_id) e.attention_turns = (e.attention_turns ?? 0) + 1;
            e.attention = e.attention!.map((a) => (a.id === incidentID ? next : a));
            yield* this.records.save(e);
            return { e, a: next };
          }),
        ),
      );
      if (!prepared?.a.prompt_id || prepared.a.status !== "uncertain") return;
      const { e, a } = prepared;
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
            if (!(!paused(latest) && latest.control_generation === a.generation))
              return yield* new CrewError(
                "ATTENTION_PAUSED",
                "Attention suppressed by a control change",
              );
            yield* this.runtime.prompt(
              a.session_id!,
              `AbraCode attention for ${e.issue_id}. Incident ${a.id}, generation ${a.generation}: ${a.code}. ${a.evidence}\n${a.batch ? `PR feedback batch: ${JSON.stringify(a.batch)}. Inspect abra_work_feedback_status for exact retained source text, original/assessed heads and dispositions. Classify against accepted scope with abra_work_feedback. Only already-enabled finite repair policy may authorize abra_work_correct; uncertain or scope-changing findings require decisions.` : ""}\nInspect abra_work_status/abra_work_diagnostics, then record abra_work_attention disposition. One diagnostic turn is authorized; this notice grants no repair, resume, plan, merge or deletion authority. Retain any pause and ask the user when authority is missing.`,
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
                    status: result._tag === "Success" ? "admitted" : "unavailable",
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
