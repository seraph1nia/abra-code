import { WorkflowError } from "../errors.ts";
import { tryDomainValue } from "../effect.ts";
import type { ApprovalActorCheck } from "./authorization.ts";
import type { Git } from "../git/repository.ts";
import { captureEvidence, captureReference } from "./worker-evidence.ts";
import {
  CaptureInputSchema,
  type CaptureInput,
  type RetainedReference,
  type WorkerReference,
} from "@abracode/contracts/web/worker-evidence";
import type { AbsolutePath } from "@abracode/contracts/identities";
import {
  QuestionIdentity,
  IssueId,
  ObligationKey,
  SessionId,
} from "@abracode/contracts/identities";
import { Clock, Effect } from "effect";
import { Form } from "@opencode/schema/form";
import { CrewError, type Execution } from "../domain.ts";
import { type Records } from "../storage/store.ts";
import { type Runtime } from "../opencode/runtime.ts";
import { type WorkGraph } from "../work/graph.ts";
import { type Coordination } from "./coordination.ts";
import { isActiveWorker } from "./worker-assignment.ts";
import { decode } from "../decode.ts";
import { canonicalJSON } from "../presentation/identity.ts";
import {
  type FinishingTarget,
  type FinishingAnswer,
  validFinishingAnswer,
} from "./finishing/contracts.ts";
import {
  QuestionInputSchema,
  WaitInputSchema,
  type Decision,
  type DeclaredWait,
} from "./obligation-contracts.ts";
import { appendDecision } from "./decision-ledger.ts";
import {
  collectPendingDecisions,
  openFinishingDecision,
  reconsiderFinishingDecision,
  supersedeResidueDecisions,
} from "./finishing/decisions.ts";

export class Obligations {
  constructor(
    private records: Records,
    private runtime: Runtime,
    private work: WorkGraph,
    private coordination: Coordination,
    private home: AbsolutePath,
    private git: Git,
    private assertActor: ApprovalActorCheck,
  ) {}
  /** Fresh absence resolves only the residue questions inspected by the owning operation. */
  supersedeResidue = (e: Execution, keys: readonly ObligationKey[]) =>
    supersedeResidueDecisions(this.records, e, keys);
  openFinishing = (e: Execution, target: FinishingTarget, question: string) =>
    openFinishingDecision(this.records, e, target, question);
  private assigned = Effect.fn("Obligations.assigned")(
    { self: this },
    function* (session: SessionId, generation: number) {
      const e = yield* this.records.workerAssignment(session);
      if (!e || !isActiveWorker(e, session, { generation }))
        return yield* new WorkflowError(
          "WORKER_ASSIGNMENT",
          "Current active worker and generation required",
        );
      return e;
    },
  );
  question = (session: SessionId, input: typeof QuestionInputSchema.Type) =>
    this.coordination.with(() =>
      Effect.gen({ self: this }, function* () {
        const a = yield* decode(QuestionInputSchema, input, "worker question");
        let e = yield* this.assigned(session, a.generation);
        const existing = e.decisions?.find((d) => d.key === a.key && d.generation === a.generation);
        if (existing) {
          if (
            existing.question !== a.question ||
            existing.scope !== a.scope ||
            existing.owner !== a.owner ||
            existing.session_id !== session
          )
            return yield* new WorkflowError(
              "DECISION_REBIND",
              "Decision key already identifies a different question",
            );
          return existing;
        }
        const decision: Decision = {
          ...a,
          schema_version: 1,
          session_id: session,
          opened_at: yield* Clock.currentTimeMillis,
          status: "open",
        };
        e = {
          ...e,
          decisions: yield* tryDomainValue(
            appendDecision,
            e.decisions,
            decision,
            "Decision history is full; inspect retained work",
          ),
        };
        yield* this.records.saveOwned(e, ["decisions"]);
        return decision;
      }),
    );
  progress = (
    session: SessionId,
    generation: number,
    summary: string,
    capture?: CaptureInput,
    references?: readonly WorkerReference[],
  ) =>
    Effect.gen({ self: this }, function* () {
      const initial = yield* this.assigned(session, generation);
      if (!(summary.length > 0 && summary.length <= 8192))
        return yield* new WorkflowError("PROGRESS", "Progress must contain 1–8192 characters");
      const prepared = capture
        ? yield* captureEvidence(this.records.store, this.home, initial, session, capture)
        : undefined;
      const capturedRefs: RetainedReference[] = [];
      if (references?.length) {
        const items = [...(initial.worker_references ?? [])];
        for (const source of references) {
          if (
            items.some(
              (r) =>
                r.session_id === session &&
                r.generation === generation &&
                canonicalJSON(r.source) === canonicalJSON(source),
            )
          )
            continue;
          if (items.length >= 64)
            return yield* new WorkflowError("WORKER_EVIDENCE", "Reference history is full");
          const ref = yield* captureReference(this.git, initial, session, source);
          items.push(ref);
          capturedRefs.push(ref);
        }
      }
      return yield* this.coordination.with(() =>
        Effect.gen({ self: this }, function* () {
          let e = yield* this.assigned(session, generation);
          const receipt = prepared?.receipt;
          let persist: Effect.Effect<void, CrewError> = Effect.void;
          if (prepared && receipt) {
            const previous = e.worker_evidence?.find((r) => r.request_id === receipt.request_id);
            if (previous) {
              const prior = yield* decode(CaptureInputSchema, previous, "Retained evidence");
              const incoming = yield* decode(CaptureInputSchema, receipt, "Worker evidence");
              if (
                previous.session_id !== session ||
                previous.generation !== e.control_generation ||
                canonicalJSON(prior) !== canonicalJSON(incoming)
              )
                return yield* new WorkflowError(
                  "WORKER_EVIDENCE",
                  "Evidence request has different inputs or ownership",
                );
            } else {
              if ((e.worker_evidence?.length ?? 0) >= 64)
                return yield* new WorkflowError(
                  "WORKER_EVIDENCE",
                  "The task already has 64 retained evidence items",
                );
              persist = prepared.persist;
              e = { ...e, worker_evidence: [...(e.worker_evidence ?? []), receipt] };
            }
          }
          if (capturedRefs.length) {
            const items = [...(e.worker_references ?? [])];
            for (const ref of capturedRefs) {
              if (
                items.some(
                  (r) =>
                    r.session_id === session &&
                    r.generation === generation &&
                    canonicalJSON(r.source) === canonicalJSON(ref.source),
                )
              )
                continue;
              if (items.length >= 64)
                return yield* new WorkflowError("WORKER_EVIDENCE", "Reference history is full");
              items.push(ref);
            }
            e = { ...e, worker_references: items };
          }
          const progress: NonNullable<Execution["progress"]> = {
            schema_version: 1,
            generation,
            session_id: session,
            summary,
            source: "worker",
            at: yield* Clock.currentTimeMillis,
          };
          e = { ...e, progress };
          yield* persist;
          e = yield* this.records.saveOwned(e, [
            "progress",
            ...(capture ? ["worker_evidence" as const] : []),
            ...(references?.length ? ["worker_references" as const] : []),
          ]);
          return {
            ...progress,
            ...(capture && {
              capture: e.worker_evidence?.find((item) => item.request_id === capture.request_id),
            }),
          };
        }),
      );
    });
  wait = (session: SessionId, input: typeof WaitInputSchema.Type) =>
    this.coordination.with(() =>
      Effect.gen({ self: this }, function* () {
        const a = yield* decode(WaitInputSchema, input, "worker wait");
        let e = yield* this.assigned(session, a.generation);
        const previous = e.waits?.find((w) => w.key === a.key && w.generation === a.generation);
        if (previous) {
          if (
            previous.kind !== a.kind ||
            previous.reference !== a.reference ||
            previous.condition !== a.condition ||
            previous.owner !== a.owner ||
            previous.expires_in_ms !== a.expires_in_ms
          )
            return yield* new WorkflowError(
              "WAIT_REBIND",
              "Wait key already identifies another condition",
            );
          return previous;
        }
        if (!((e.waits?.length ?? 0) < 256))
          return yield* new WorkflowError("WAIT_LIMIT", "Wait history is full");
        if (a.kind === "dependency") {
          if (a.reference === e.issue_id)
            return yield* new WorkflowError("WAIT_REFERENCE", "Cannot wait on self");
          yield* this.work.show(a.reference);
        }
        if (a.kind === "user") {
          if (
            !e.decisions?.some(
              (d) => d.key === a.reference && d.generation === a.generation && d.status === "open",
            )
          )
            return yield* new WorkflowError("WAIT_REFERENCE", "Open matching decision required");
        }
        if (a.kind === "command") {
          if (
            e.command_wait?.operation_id !== a.reference ||
            !(e.command_wait.deadline_at > (yield* Clock.currentTimeMillis))
          )
            return yield* new WorkflowError(
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
        e = { ...e, waits: [...(e.waits ?? []), wait] };
        yield* this.records.saveOwned(e, ["waits"]);
        return wait;
      }),
    );
  resolve = Effect.fn("Obligations.resolve")(
    { self: this },
    function* (
      id: IssueId,
      key: ObligationKey,
      generation: number,
      session: SessionId,
      action: "answer" | "collect" | "cancel" | "supersede" | "reconsider",
      answer?: string,
    ) {
      let e = yield* this.records.execution(id);
      if (!e) return yield* new WorkflowError("EXECUTION_MISSING", "Execution missing");
      yield* this.assertActor(session).pipe(
        Effect.mapError((error) =>
          error.code === "SELF_APPROVAL"
            ? new WorkflowError("WORKER_FORBIDDEN", "Workers cannot resolve decisions")
            : error,
        ),
      );
      let d = e.decisions?.find((d) => d.key === key && d.generation === generation);
      if (!d || e.control_generation !== generation)
        return yield* new WorkflowError("DECISION_STALE", "Decision generation is stale");
      if (action === "reconsider")
        return yield* reconsiderFinishingDecision(this.records, e, d, key, generation);
      if (d.status !== "open") return d;
      let finishingAnswer: FinishingAnswer | undefined;
      if (action === "collect") {
        if (d.owner !== "user")
          return yield* new WorkflowError(
            "DECISION_OWNER",
            "Only user-owned decisions use native forms",
          );
        const retained = yield* this.coordination.with(() =>
          Effect.gen({ self: this }, function* () {
            let current = yield* this.records.execution(id);
            if (current?.control_generation !== generation)
              return yield* new WorkflowError("DECISION_STALE", "Decision superseded");
            const decision = current.decisions!.find(
              (d) => d.key === key && d.generation === generation,
            )!;
            const next = {
              ...decision,
              form_id: decision.form_id ?? Form.ID.create(),
              form_session: decision.form_session ?? session,
            };
            current = {
              ...current,
              decisions: current.decisions!.map((d) => (d === decision ? next : d)),
            };
            yield* this.records.saveOwned(current, ["decisions"]);
            return next;
          }),
        );
        const identity = QuestionIdentity.make(`${id}:${generation}:${key}`);
        if (retained.finishing_target) {
          if (!this.runtime.requestDisposition || !this.runtime.disposition)
            return yield* new WorkflowError(
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
            return yield* new WorkflowError(
              "DECISION_ANSWER",
              "Native disposition does not match its target",
            );
          answer = finishingAnswer ? JSON.stringify(finishingAnswer) : undefined;
        } else {
          yield* this.runtime.requestQuestion(
            retained.form_session!,
            retained.form_id!,
            retained.question,
            identity,
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
        if (d.owner !== "supervisor")
          return yield* new WorkflowError(
            "DECISION_OWNER",
            "User-owned answers require a native form",
          );
      }
      return yield* this.coordination.with(() =>
        Effect.gen({ self: this }, function* () {
          e = yield* this.records.execution(id);
          if (e?.control_generation !== generation)
            return yield* new WorkflowError("DECISION_STALE", "Decision superseded");
          const current = e.decisions!.find((d) => d.key === key && d.generation === generation)!;
          if (current.status !== "open") return current;
          if (action === "answer") {
            if (!(answer && answer.length <= 8192))
              return yield* new WorkflowError(
                "DECISION_ANSWER",
                "Bounded nonempty answer required",
              );
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
            e = { ...e, resume_after_decision: true };
          if (next.finishing_target) {
            e = {
              ...e,
              finishing: {
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
              },
            };
            e = { ...e, cleanup_blocker: undefined };
          }
          e = { ...e, decisions: e.decisions!.map((d) => (d === current ? next : d)) };
          yield* this.records.saveOwned(e, [
            "resume_after_decision",
            "finishing",
            "cleanup_blocker",
            "decisions",
          ]);
          return next;
        }),
      );
    },
  );
  supersedeWait = (id: IssueId, key: ObligationKey, generation: number, evidence: string) =>
    this.coordination.with(() =>
      Effect.gen({ self: this }, function* () {
        let e = yield* this.records.execution(id);
        if (e?.control_generation !== generation)
          return yield* new WorkflowError("WAIT_STALE", "Wait generation is stale");
        if (!(evidence.length > 0 && evidence.length <= 8192))
          return yield* new WorkflowError("WAIT_EVIDENCE", "Explicit bounded disposition required");
        if (!e.waits?.some((w) => w.key === key && w.generation === generation))
          return yield* new WorkflowError("WAIT_MISSING", "Wait missing");
        e = {
          ...e,
          waits: e.waits!.map((w) =>
            w.key === key && w.generation === generation
              ? { ...w, status: "superseded", evidence }
              : w,
          ),
        };
        return yield* this.records.saveOwned(e, ["waits"]);
      }),
    );
  collectPending = (e: Execution) =>
    collectPendingDecisions(
      this.records,
      (id, key, generation, session) => this.resolve(id, key, generation, session, "collect"),
      e,
    );
  recheck = (e: Execution) =>
    Effect.gen({ self: this }, function* () {
      const now = yield* Clock.currentTimeMillis;
      const observed = yield* this.records.execution(e.issue_id);
      const due = (observed?.waits ?? []).flatMap((wait) =>
        wait.kind === "dependency" &&
        wait.status === "waiting" &&
        wait.generation === e.control_generation &&
        now >= wait.next_check_at
          ? [wait.reference]
          : [],
      );
      const closed = new Map(
        yield* Effect.forEach(
          [...new Set(due)],
          (id) =>
            this.work
              .show(id)
              .pipe(Effect.map((issue) => [id, issue.status === "closed"] as const)),
          { concurrency: 4 },
        ),
      );
      return yield* this.coordination.with(() =>
        Effect.gen({ self: this }, function* () {
          const current = yield* this.records.execution(e.issue_id);
          if (!current || current.control_generation !== e.control_generation)
            return yield* new WorkflowError("STALE_OPERATION", "Obligation recheck was superseded");
          e = current;
          return yield* this.recheckCurrent(e, now, closed);
        }),
      );
    });
  private recheckCurrent = Effect.fn("Obligations.recheck")(
    { self: this },
    function* (e: Execution, now: number, closed: ReadonlyMap<IssueId, boolean>) {
      const decisions = (e.decisions ?? []).map((d) =>
        d.status === "open" && d.generation !== e.control_generation
          ? { ...d, status: "superseded" as const, resolved_at: now }
          : d,
      );
      let changed = decisions.some((d, i) => d !== e.decisions?.[i]);
      if (changed) e = { ...e, decisions: decisions };
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
            if (!closed.has(wait.reference)) {
              waits.push(wait);
              continue;
            }
            if (closed.get(wait.reference)) {
              status = "cleared";
              evidence = `Dependency ${wait.reference} closed`;
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
        if (status === wait.status && now < wait.next_check_at) {
          waits.push(wait);
          continue;
        }
        changed = true;
        waits.push({
          ...wait,
          status,
          evidence,
          next_check_at: now >= wait.next_check_at ? now + 30000 : wait.next_check_at,
        });
      }
      if (waits.some((w, i) => w.status === "cleared" && e.waits?.[i]?.status === "waiting"))
        e = { ...e, resume_after_decision: true };
      if (changed && e.waits) e = { ...e, waits: waits };
      if (changed)
        e = yield* this.records.saveOwned(e, ["decisions", "waits", "resume_after_decision"]);
      return {
        execution: e,
        blocked:
          waits.some((w) => ["waiting", "expired", "invalid"].includes(w.status)) ||
          e.decisions?.some((d) => d.generation === e.control_generation && d.status === "open") ===
            true,
      };
    },
  );
}
