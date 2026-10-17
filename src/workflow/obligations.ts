import { QuestionIdentity, IssueId, ObligationKey, SessionId } from "../identities.ts";

import { Clock, Effect } from "effect";
import { Form } from "@opencode/schema/form";
import { CrewError, type Execution } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { type Records } from "../storage/store.ts";
import { type Runtime } from "../opencode/runtime.ts";
import { type WorkGraph } from "../work/graph.ts";
import { type Coordination } from "./coordination.ts";
import { workerSessionID } from "./sessions.ts";
import { decode } from "../decode.ts";
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
  private assigned = Effect.fn("Obligations.assigned")(
    function* (this: Obligations, session: SessionId, generation: number) {
      const e = (yield* this.records.executions()).find((e) => workerSessionID(e) === session);
      if (
        !(
          e &&
          e.control_generation === generation &&
          !e.stop_status &&
          ["exploring", "planning", "applying", "verifying", "researching"].includes(
            e.current_phase,
          )
        )
      )
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
      action: "answer" | "collect" | "cancel" | "supersede",
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
          ].includes(session),
        )
      )
        return yield* new CrewError("WORKER_FORBIDDEN", "Workers cannot resolve decisions");
      let d = e.decisions?.find((d) => d.key === key && d.generation === generation);
      if (!(d && e.control_generation === generation))
        return yield* new CrewError("DECISION_STALE", "Decision generation is stale");
      if (d.status !== "open") return d;
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
              resolved_at: yield* Clock.currentTimeMillis,
            };
            if (next.status === "answered") e.resume_after_decision = true;
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
      for (const d of e.decisions ?? [])
        if (
          d.status === "open" &&
          d.generation === e.control_generation &&
          d.owner === "user" &&
          d.form_session
        )
          yield* this.resolve(e.issue_id, d.key, d.generation, d.form_session, "collect");
      return (yield* this.records.execution(e.issue_id))!;
    }.bind(this),
    domainEffect,
  );
  recheck = Effect.fn("Obligations.recheck")(
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
