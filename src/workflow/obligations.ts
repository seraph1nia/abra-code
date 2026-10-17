import { QuestionIdentity, IssueId, ObligationKey, SessionId } from "../identities.ts";

import { Clock, Effect } from "effect";
import { Form } from "@opencode/schema/form";
import { CrewError, type Execution } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { synchronizeExecution, type Records } from "../storage/store.ts";
import { type Runtime } from "../opencode/runtime.ts";
import { type WorkGraph } from "../work/graph.ts";
import { type Coordination } from "./coordination.ts";
import { historicalWorkers, isActiveWorker, workerSessionID } from "./worker-assignment.ts";
import { decode } from "../decode.ts";
import { createHash } from "node:crypto";
import {
  type FinishingTarget,
  type FinishingAnswer,
  validFinishingAnswer,
} from "./finishing-contracts.ts";
import {
  QuestionInputSchema,
  WaitInputSchema,
  type Decision,
  type DeclaredWait,
} from "./obligation-contracts.ts";
export class Obligations {
  constructor(
    private records: Records,
    private runtime: Runtime,
    private work: WorkGraph,
    private coordination: Coordination,
  ) {}
  /** Fresh absence resolves only the residue questions inspected by the owning operation. */
  supersedeResidue = Effect.fn("Obligations.supersedeResidue")(
    function* (this: Obligations, e: Execution, keys: readonly ObligationKey[]) {
      const now = yield* Clock.currentTimeMillis;
      const saved = yield* this.records.update(e.issue_id, (current) => {
        if (
          current.control_generation !== e.control_generation ||
          current.operation?.id !== e.operation?.id
        )
          throw new CrewError("STALE_OPERATION", "Residue inspection ownership changed");
        const resolved = new Set(
          current.decisions
            ?.filter(
              (d) =>
                d.generation === e.control_generation &&
                d.status === "open" &&
                d.finishing_target?.kind === "residue" &&
                keys.includes(d.key),
            )
            .map((d) => d.key),
        );
        return {
          ...current,
          decisions: current.decisions?.map((d) =>
            resolved.has(d.key) && d.generation === e.control_generation
              ? { ...d, status: "superseded" as const, resolved_at: now }
              : d,
          ),
          finishing: current.finishing
            ? {
                ...current.finishing,
                current_question: current.decisions?.some(
                  (d) =>
                    d.key === current.finishing?.current_question &&
                    d.generation === e.control_generation &&
                    d.status === "open" &&
                    !resolved.has(d.key),
                )
                  ? current.finishing.current_question
                  : undefined,
                routing: current.finishing.routing?.map((r) =>
                  r.generation === e.control_generation && resolved.has(r.key)
                    ? { ...r, status: "superseded" as const, observed_at: now }
                    : r,
                ),
              }
            : undefined,
        };
      });
      synchronizeExecution(e, saved);
    }.bind(this),
    domainEffect,
  );
  openFinishing = Effect.fn("Obligations.openFinishing")(
    function* (this: Obligations, e: Execution, target: FinishingTarget, question: string) {
      const digest = createHash("sha256").update(JSON.stringify(target)).digest("hex").slice(0, 40);
      const key = ObligationKey.make(`finishing-${digest}`);
      const now = yield* Clock.currentTimeMillis;
      const saved = yield* this.records.update(e.issue_id, (current) => {
        if (
          current.control_generation !== e.control_generation ||
          current.operation?.id !== e.operation?.id
        )
          throw new CrewError("STALE_OPERATION", "Finishing decision ownership changed");
        if (current.decisions?.some((d) => d.key === key && d.generation === target.generation))
          return current.finishing?.current_question === key
            ? undefined
            : {
                ...current,
                finishing: { ...current.finishing, schema_version: 1, current_question: key },
              };
        if ((current.decisions?.length ?? 0) >= 256)
          throw new CrewError("DECISION_LIMIT", "Decision history is full");
        return {
          ...current,
          decisions: [
            ...(current.decisions ?? []).map((d) =>
              d.status === "open" &&
              d.generation === target.generation &&
              d.finishing_target?.kind === target.kind
                ? { ...d, status: "superseded" as const, resolved_at: now }
                : d,
            ),
            {
              schema_version: 1,
              key,
              generation: target.generation,
              scope: "Finishing existing work",
              question: question.slice(0, 8192),
              owner: "user",
              session_id: "controller",
              opened_at: now,
              status: "open",
              finishing_target: target,
            },
          ],
          finishing: {
            ...current.finishing,
            schema_version: 1,
            current_question: key,
            routing: [
              ...(current.finishing?.routing ?? []),
              {
                schema_version: 1,
                generation: target.generation,
                key,
                status: "undelivered",
                attempts: 0,
                next_check_at: now,
                observed_at: now,
              },
            ],
          },
        };
      });
      synchronizeExecution(e, saved);
      return key;
    }.bind(this),
    domainEffect,
  );
  private assigned = Effect.fn("Obligations.assigned")(
    function* (this: Obligations, session: SessionId, generation: number) {
      const e = (yield* this.records.executions()).find((e) => workerSessionID(e) === session);
      if (!e || !isActiveWorker(e, session, { generation }))
        return yield* new CrewError(
          "WORKER_ASSIGNMENT",
          "Current active worker and generation required",
        );
      return e;
    }.bind(this),
    domainEffect,
  );
  question = (session: SessionId, input: typeof QuestionInputSchema.Type) =>
    this.coordination.with(() =>
      domainEffect(
        Effect.gen({ self: this }, function* () {
          const a = yield* decode(QuestionInputSchema, input, "worker question");
          const e = yield* this.assigned(session, a.generation);
          const existing = e.decisions?.find(
            (d) => d.key === a.key && d.generation === a.generation,
          );
          if (existing) {
            if (
              !(
                existing.question === a.question &&
                existing.scope === a.scope &&
                existing.owner === a.owner &&
                existing.session_id === session
              )
            )
              return yield* new CrewError(
                "DECISION_REBIND",
                "Decision key already identifies a different question",
              );
            return existing;
          }
          if (!((e.decisions?.length ?? 0) < 256))
            return yield* new CrewError(
              "DECISION_LIMIT",
              "Decision history is full; inspect retained work",
            );
          const decision: Decision = {
            ...a,
            schema_version: 1,
            session_id: session,
            opened_at: yield* Clock.currentTimeMillis,
            status: "open",
          };
          e.decisions = [...(e.decisions ?? []), decision];
          yield* this.records.save(e);
          return decision;
        }),
      ),
    );
  progress = (session: SessionId, generation: number, summary: string) =>
    this.coordination.with(() =>
      domainEffect(
        Effect.gen({ self: this }, function* () {
          const e = yield* this.assigned(session, generation);
          if (!(summary.length > 0 && summary.length <= 8192))
            return yield* new CrewError("PROGRESS", "Progress must contain 1–8192 characters");
          e.progress = {
            schema_version: 1,
            generation,
            session_id: session,
            summary,
            source: "worker",
            at: yield* Clock.currentTimeMillis,
          };
          yield* this.records.save(e);
          return e.progress;
        }),
      ),
    );
  wait = (session: SessionId, input: typeof WaitInputSchema.Type) =>
    this.coordination.with(() =>
      domainEffect(
        Effect.gen({ self: this }, function* () {
          const a = yield* decode(WaitInputSchema, input, "worker wait");
          const e = yield* this.assigned(session, a.generation);
          const previous = e.waits?.find((w) => w.key === a.key && w.generation === a.generation);
          if (previous) {
            if (
              !(
                previous.kind === a.kind &&
                previous.reference === a.reference &&
                previous.condition === a.condition &&
                previous.owner === a.owner &&
                previous.expires_in_ms === a.expires_in_ms
              )
            )
              return yield* new CrewError(
                "WAIT_REBIND",
                "Wait key already identifies another condition",
              );
            return previous;
          }
          if (!((e.waits?.length ?? 0) < 256))
            return yield* new CrewError("WAIT_LIMIT", "Wait history is full");
          if (a.kind === "dependency") {
            if (!(a.reference !== e.issue_id))
              return yield* new CrewError("WAIT_REFERENCE", "Cannot wait on self");
            yield* this.work.show(a.reference);
          }
          if (a.kind === "user") {
            if (
              !e.decisions?.some(
                (d) =>
                  d.key === a.reference && d.generation === a.generation && d.status === "open",
              )
            )
              return yield* new CrewError("WAIT_REFERENCE", "Open matching decision required");
          }
          if (a.kind === "command") {
            if (
              !(
                e.command_wait?.operation_id === a.reference &&
                e.command_wait.deadline_at > (yield* Clock.currentTimeMillis)
              )
            )
              return yield* new CrewError(
                "WAIT_REFERENCE",
                "Live controller-owned command required",
              );
          }
          const now = yield* Clock.currentTimeMillis;
          const wait: DeclaredWait = {
            ...a,
            schema_version: 1,
            session_id: session,
            started_at: now,
            expires_at: now + a.expires_in_ms,
            next_check_at: now,
            status: "waiting",
          };
          e.waits = [...(e.waits ?? []), wait];
          yield* this.records.save(e);
          return wait;
        }),
      ),
    );
  resolve = Effect.fn("Obligations.resolve")(
    function* (
      this: Obligations,
      id: IssueId,
      key: ObligationKey,
      generation: number,
      session: SessionId,
      action: "answer" | "collect" | "cancel" | "supersede" | "reconsider",
      answer?: string,
    ) {
      let e = yield* this.records.execution(id);
      if (!e) return yield* new CrewError("EXECUTION_MISSING", "Execution missing");
      if (
        (yield* this.records.executions()).some((e) =>
          [
            e.explore_session_id,
            e.apply_session_id,
            e.review_session_id,
            e.research_session_id,
            e.session_intent?.id,
            ...historicalWorkers(e).map((worker) => worker.id),
          ].includes(session),
        )
      )
        return yield* new CrewError("WORKER_FORBIDDEN", "Workers cannot resolve decisions");
      let d = e.decisions?.find((d) => d.key === key && d.generation === generation);
      if (!(d && e.control_generation === generation))
        return yield* new CrewError("DECISION_STALE", "Decision generation is stale");
      if (action === "reconsider") {
        if (
          !d.finishing_target ||
          !["answered", "cancelled"].includes(d.status) ||
          e.finishing?.current_question !== key ||
          e.current_phase === "completed"
        )
          return yield* new CrewError(
            "DECISION_RECONSIDER",
            "Only the current resolved finishing decision can be reconsidered",
          );
        if ((d.finishing_history?.length ?? 0) >= 64)
          return yield* new CrewError("DECISION_LIMIT", "Finishing form history is full");
        const now = yield* Clock.currentTimeMillis;
        const saved = yield* this.records.update(id, (current) => {
          if (
            current.control_generation !== generation ||
            current.finishing?.current_question !== key
          )
            throw new CrewError("DECISION_STALE", "Finishing target changed");
          const previous = current.decisions!.find(
            (item) => item.key === key && item.generation === generation,
          )!;
          return {
            ...current,
            decisions: current.decisions!.map((item) =>
              item === previous
                ? {
                    ...item,
                    status: "open",
                    answer: undefined,
                    finishing_answer: undefined,
                    resolved_at: undefined,
                    form_id: undefined,
                    form_session: undefined,
                    finishing_history: [
                      ...(item.finishing_history ?? []),
                      ...(item.form_id && item.form_session
                        ? [
                            {
                              form_id: item.form_id,
                              form_session: item.form_session,
                              target: item.finishing_target!,
                              answer: item.finishing_answer,
                              resolved_at: item.resolved_at ?? now,
                            },
                          ]
                        : []),
                    ],
                  }
                : item,
            ),
            finishing: {
              ...current.finishing,
              schema_version: 1,
              routing: current.finishing.routing?.map((r) =>
                r.key === key && r.generation === generation
                  ? {
                      ...r,
                      status: "undelivered",
                      attempts: 0,
                      next_check_at: now,
                      observed_at: now,
                      form_id: undefined,
                      session_id: undefined,
                    }
                  : r,
              ),
            },
          };
        });
        return saved.decisions!.find((item) => item.key === key && item.generation === generation)!;
      }
      if (d.status !== "open") return d;
      let finishingAnswer: FinishingAnswer | undefined;
      if (action === "collect") {
        if (!(d.owner === "user"))
          return yield* new CrewError(
            "DECISION_OWNER",
            "Only user-owned decisions use native forms",
          );
        const retained = yield* this.coordination.with(() =>
          domainEffect(
            Effect.gen({ self: this }, function* () {
              const current = yield* this.records.execution(id);
              if (!(current?.control_generation === generation))
                return yield* new CrewError("DECISION_STALE", "Decision superseded");
              const decision = current.decisions!.find(
                (d) => d.key === key && d.generation === generation,
              )!;
              const next = {
                ...decision,
                form_id: decision.form_id ?? Form.ID.create(),
                form_session: decision.form_session ?? session,
              };
              current.decisions = current.decisions!.map((d) => (d === decision ? next : d));
              yield* this.records.save(current);
              return next;
            }),
          ),
        );
        const identity = QuestionIdentity.make(`${id}:${generation}:${key}`);
        if (retained.finishing_target) {
          if (!this.runtime.requestDisposition || !this.runtime.disposition)
            return yield* new CrewError(
              "FINISHING_UNAVAILABLE",
              "Runtime cannot present the required exact-action form",
            );
          yield* this.runtime.requestDisposition(
            retained.form_session!,
            retained.form_id!,
            retained.question,
            identity,
            retained.finishing_target,
          );
          const result = yield* this.runtime.disposition(
            retained.form_session!,
            retained.form_id!,
            identity,
            retained.finishing_target,
          );
          if (result.status === "pending") return retained;
          action = result.status === "answered" ? "answer" : "cancel";
          finishingAnswer = result.status === "answered" ? result.answer : undefined;
          if (finishingAnswer && !validFinishingAnswer(retained.finishing_target, finishingAnswer))
            return yield* new CrewError(
              "DECISION_ANSWER",
              "Native disposition does not match its target",
            );
          answer = finishingAnswer ? JSON.stringify(finishingAnswer) : undefined;
        } else {
          yield* this.runtime.requestQuestion(
            retained.form_session!,
            retained.form_id!,
            retained.question,
            QuestionIdentity.make(`${id}:${generation}:${key}`),
          );
          const result = yield* this.runtime.questionAnswer(
            retained.form_session!,
            retained.form_id!,
          );
          if (result.status === "pending") return retained;
          action = result.status === "answered" ? "answer" : "cancel";
          answer = result.answer;
        }
        d = retained;
      } else if (action === "answer") {
        if (!(d.owner === "supervisor"))
          return yield* new CrewError("DECISION_OWNER", "User-owned answers require a native form");
      }
      return yield* this.coordination.with(() =>
        domainEffect(
          Effect.gen({ self: this }, function* () {
            e = yield* this.records.execution(id);
            if (!(e?.control_generation === generation))
              return yield* new CrewError("DECISION_STALE", "Decision superseded");
            const current = e.decisions!.find((d) => d.key === key && d.generation === generation)!;
            if (current.status !== "open") return current;
            if (action === "answer") {
              if (!(answer && answer.length <= 8192))
                return yield* new CrewError("DECISION_ANSWER", "Bounded nonempty answer required");
            }
            const next: Decision = {
              ...current,
              status:
                action === "answer" ? "answered" : action === "cancel" ? "cancelled" : "superseded",
              answer,
              finishing_answer: finishingAnswer,
              resolved_at: yield* Clock.currentTimeMillis,
            };
            if (next.status === "answered" && !next.finishing_target)
              e.resume_after_decision = true;
            if (next.finishing_target) {
              e.finishing = {
                ...e.finishing,
                schema_version: 1,
                routing: e.finishing?.routing?.map((r) =>
                  r.key === key && r.generation === generation
                    ? {
                        ...r,
                        status:
                          finishingAnswer?.action === "defer" || next.status === "cancelled"
                            ? "deferred"
                            : next.status === "answered"
                              ? "answered"
                              : "superseded",
                        observed_at: next.resolved_at!,
                      }
                    : r,
                ),
              };
              delete e.cleanup_blocker;
            }
            e.decisions = e.decisions!.map((d) => (d === current ? next : d));
            yield* this.records.save(e);
            return next;
          }),
        ),
      );
    }.bind(this),
    domainEffect,
  );
  supersedeWait = (id: IssueId, key: ObligationKey, generation: number, evidence: string) =>
    this.coordination.with(() =>
      domainEffect(
        Effect.gen({ self: this }, function* () {
          const e = yield* this.records.execution(id);
          if (!(e?.control_generation === generation))
            return yield* new CrewError("WAIT_STALE", "Wait generation is stale");
          if (!(evidence.length > 0 && evidence.length <= 8192))
            return yield* new CrewError("WAIT_EVIDENCE", "Explicit bounded disposition required");
          if (!e.waits?.some((w) => w.key === key && w.generation === generation))
            return yield* new CrewError("WAIT_MISSING", "Wait missing");
          e.waits = e.waits!.map((w) =>
            w.key === key && w.generation === generation
              ? { ...w, status: "superseded", evidence }
              : w,
          );
          return yield* this.records.save(e);
        }),
      ),
    );
  collectPending = Effect.fn("Obligations.collectPending")(
    function* (this: Obligations, e: Execution) {
      for (const d of e.decisions ?? []) {
        const now = yield* Clock.currentTimeMillis;
        const route = e.finishing?.routing?.find(
          (r) => r.key === d.key && r.generation === d.generation,
        );
        const session =
          d.form_session ??
          (d.finishing_target
            ? (e.supervisor_session_id ?? (yield* this.records.supervisor()))
            : undefined);
        if (
          d.status === "open" &&
          d.generation === e.control_generation &&
          d.owner === "user" &&
          (d.form_session || d.finishing_target) &&
          (!route ||
            (route.next_check_at <= now && (route.status === "pending" || route.attempts < 8)))
        ) {
          const result = session
            ? yield* Effect.result(
                this.resolve(e.issue_id, d.key, d.generation, session, "collect"),
              )
            : undefined;
          if (d.finishing_target) {
            const saved = yield* this.records.update(e.issue_id, (current) => {
              if (current.control_generation !== e.control_generation) return;
              const decision = current.decisions?.find(
                (item) => item.key === d.key && item.generation === d.generation,
              );
              if (!decision || decision.status !== "open") return;
              return {
                ...current,
                finishing: {
                  ...current.finishing,
                  schema_version: 1,
                  routing: current.finishing?.routing?.map((r) =>
                    r.key === d.key && r.generation === d.generation
                      ? {
                          ...r,
                          attempts:
                            result?._tag === "Success" ? r.attempts : Math.min(r.attempts + 1, 8),
                          observed_at: now,
                          status: result?._tag === "Success" ? "pending" : "undelivered",
                          next_check_at:
                            now +
                            (result?._tag === "Success"
                              ? 0
                              : Math.min(300_000, 30_000 * 2 ** Math.min(r.attempts, 4))),
                          form_id: decision.form_id,
                          session_id: decision.form_session,
                          reason:
                            result?._tag === "Failure"
                              ? result.failure.message.slice(0, 8192)
                              : !session
                                ? "Retained Abra session unavailable"
                                : undefined,
                        }
                      : r,
                  ),
                },
              };
            });
            synchronizeExecution(e, saved);
          } else if (result?._tag === "Failure") return yield* result.failure;
        }
      }
      return (yield* this.records.execution(e.issue_id))!;
    }.bind(this),
    domainEffect,
  );
  recheck = (e: Execution) =>
    this.coordination.with(() =>
      domainEffect(
        Effect.gen({ self: this }, function* () {
          const current = yield* this.records.execution(e.issue_id);
          if (!(current && current.control_generation === e.control_generation))
            return yield* new CrewError("STALE_OPERATION", "Obligation recheck was superseded");
          // Decision history must not overwrite evidence published since this operation began.
          synchronizeExecution(e, current);
          return yield* this.recheckCurrent(e);
        }),
      ),
    );
  private recheckCurrent = Effect.fn("Obligations.recheck")(
    function* (this: Obligations, e: Execution) {
      const now = yield* Clock.currentTimeMillis;
      const decisions = (e.decisions ?? []).map((d) =>
        d.status === "open" && d.generation !== e.control_generation
          ? { ...d, status: "superseded" as const, resolved_at: now }
          : d,
      );
      if (e.decisions) e.decisions = decisions;
      const waits = [];
      for (const wait of e.waits ?? []) {
        if (wait.status !== "waiting") {
          waits.push(wait);
          continue;
        }
        let status: DeclaredWait["status"] = wait.status;
        let evidence: string | undefined;
        if (wait.generation !== e.control_generation) status = "superseded";
        else if (now >= wait.next_check_at) {
          if (wait.kind === "dependency") {
            const issue = yield* this.work.show(wait.reference);
            if (issue.status === "closed") {
              status = "cleared";
              evidence = `Dependency ${issue.id} closed`;
            }
          } else if (wait.kind === "user") {
            const d = e.decisions?.find(
              (d) => d.key === wait.reference && d.generation === wait.generation,
            );
            if (!d) status = "invalid";
            else if (d.status === "answered") {
              status = "cleared";
              evidence = d.answer;
            } else if (d.status !== "open") status = "invalid";
          } else if (e.command_wait?.operation_id !== wait.reference) {
            status = "cleared";
            evidence = "Owned command finished";
          }
          if (status === "waiting" && now >= wait.expires_at) status = "expired";
        }
        waits.push({
          ...wait,
          status,
          evidence,
          next_check_at: now >= wait.next_check_at ? now + 30000 : wait.next_check_at,
        });
      }
      if (waits.some((w, i) => w.status === "cleared" && e.waits?.[i]?.status === "waiting"))
        e.resume_after_decision = true;
      e.waits = waits;
      if (waits.length || decisions.length) yield* this.records.save(e);
      return (
        waits.some((w) => ["waiting", "expired", "invalid"].includes(w.status)) ||
        e.decisions?.some((d) => d.generation === e.control_generation && d.status === "open") ===
          true
      );
    }.bind(this),
    domainEffect,
  );
}
