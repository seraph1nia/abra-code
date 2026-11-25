import { OperationAction } from "@abracode/contracts/identities";
import { type Capacity } from "./capacity.ts";
import { type WorkGraph } from "../work/graph.ts";
import { type Operations } from "./operations.ts";
import { type Queries } from "./queries.ts";
import { type WorkerSessions } from "./sessions.ts";
import { randomUUID } from "node:crypto";
import { Clock, Effect } from "effect";
import { ObligationKey, FormId, Fingerprint, type SessionId } from "@abracode/contracts/identities";
import { ensure, type Execution, type Project } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { removeOwnedField, synchronizeExecution, type Records } from "../storage/store.ts";
import { type Git } from "../git/repository.ts";
import { type Runtime } from "../opencode/runtime.ts";
import { NoMistakes, intentDigest } from "../validation/no-mistakes.ts";
import {
  externalSucceeded,
  externalOwns,
  type ExternalRecord,
  type ExternalDocument,
  type ValidationInput,
} from "@abracode/contracts/validation/contracts";
import { digest } from "../digest.ts";
import { collectApprovalForm, openControllerDecision } from "./decision-ledger.ts";
import { nextCheckAt } from "./durable-outbox.ts";
import { assertTransition } from "./transitions.ts";

/** Owns one external writer, retained protocol admissions, and explicit custody return. */
export class ExternalValidation {
  readonly engine: NoMistakes;
  constructor(
    private records: Records,
    private git: Git,
    private runtime: Runtime,
    private admission: {
      capacity: Capacity;
      work: WorkGraph;
      operations: Operations;
      queries: Queries;
      sessions: WorkerSessions;
    },
  ) {
    this.engine = new NoMistakes(git.runner);
  }
  command = (input: typeof ValidationInput.Type, actor: SessionId) =>
    this.admission.operations.owned(input.issue_id, OperationAction.make("validation"), () =>
      domainEffect(
        Effect.gen({ self: this }, function* () {
          const e = yield* this.admission.queries.get(input.issue_id);
          yield* this.admission.sessions.idle(e);
          const p = yield* this.admission.queries.effectiveProject(e);
          return yield* this.control(e, p, input, actor);
        }),
      ),
    );
  advance = (e: Execution, p: Project) =>
    this.prepare(e, p).pipe(
      Effect.ensuring(this.admission.capacity.releaseIfPreparing(e, "apply")),
    );
  private prepare = Effect.fn("ExternalValidation.advance")(
    function* (this: ExternalValidation, e: Execution, p: Project) {
      if (!externalOwns(e) && !(yield* this.admission.capacity.reserve(e, "apply", p))) return e;
      const issue = yield* this.admission.work.show(e.issue_id);
      yield* this.drive(
        e,
        p,
        JSON.stringify({
          intent: e.intent ?? { title: issue.title, description: issue.description },
          scope: e.scope?.contract,
          plan: e.plan_fingerprint,
        }),
      );
      return e;
    }.bind(this),
    domainEffect,
  );
  private question = Effect.fn("ExternalValidation.question")(
    function* (this: ExternalValidation, e: Execution, question: string) {
      const r = e.external_validation!;
      yield* openControllerDecision(this.records, e, {
        key: ObligationKey.make(
          `external-${r.nonce}-${digest(r.observation?.gate ?? r.status).slice(0, 16)}`,
        ),
        question,
        matchAnyGeneration: true,
        staleMessage: "External decision was superseded",
        limitMessage: "External decision history requires inspection",
      });
    }.bind(this),
    domainEffect,
  );
  private settleQuestions = Effect.fn("ExternalValidation.settleQuestions")(
    function* (
      this: ExternalValidation,
      e: Execution,
      r: ExternalRecord,
      at: number,
      form?: FormId,
    ) {
      const saved = yield* this.records.update(e.issue_id, (current) => {
        ensure(
          current.control_generation === e.control_generation &&
            current.operation?.id === e.operation?.id,
          "STALE_OPERATION",
          "External decision was superseded",
        );
        return {
          ...current,
          decisions: current.decisions?.map((d) =>
            d.key.startsWith(`external-${r.nonce}-`) && d.status === "open"
              ? {
                  ...d,
                  status: form ? "answered" : "superseded",
                  answer: form
                    ? `Authorized through bound external action form ${form}`
                    : undefined,
                  resolved_at: at,
                }
              : d,
          ),
        };
      });
      synchronizeExecution(e, saved);
    }.bind(this),
    domainEffect,
  );
  private save(e: Execution, r: ExternalRecord) {
    return this.records.commitOwned(e, { external_validation: r });
  }
  private accept(
    e: Execution,
    r: ExternalRecord,
    doc: typeof ExternalDocument.Type,
    now: number,
  ): ExternalRecord {
    const launch = doc.launch_receipt ?? r.launch;
    ensure(
      e.branch === r.branch &&
        launch &&
        launch.launch_nonce === r.nonce &&
        launch.validation_generation === r.validation_generation &&
        launch.branch === r.branch &&
        launch.submitted_head_sha === r.submitted_head &&
        launch.intent_digest === r.intent_digest,
      "EXTERNAL_LAUNCH",
      "Engine did not prove the reserved launch identity",
    );
    ensure(
      doc.run?.id === launch.run_id && doc.run.branch === r.branch,
      "EXTERNAL_RUN",
      "Observed run differs from the retained launch",
    );
    const terminal = ["completed", "failed", "cancelled", "ci_monitor_interrupted"].includes(
      doc.run.status,
    );
    ensure(
      !doc.outcome || terminal || doc.outcome === "checks-passed",
      "EXTERNAL_OUTCOME",
      "Outcome contradicts active run state",
    );
    return {
      ...r,
      launch,
      observation: doc,
      status: terminal ? "terminal" : doc.gate ? "gated" : "running",
      custody: "external",
      observed_at: now,
      next_check_at: nextCheckAt(now, 1),
      error: undefined,
    };
  }
  drive = Effect.fn("ExternalValidation.drive")(
    function* (this: ExternalValidation, e: Execution, p: Project, intent: string) {
      if (e.stop_status) return e;
      const now = yield* Clock.currentTimeMillis;
      let r = e.external_validation;
      if (!r || r.custody === "returned") {
        ensure(!externalOwns(e), "EXTERNAL_CUSTODY", "Previous external run still owns the branch");
        const head = yield* this.git.commit(
          e.worktree_directory!,
          e.issue_id,
          `Prepare external validation ${e.issue_id}`,
        );
        yield* this.records.commitOwned(e, { implementation_head: head });
        if (r?.status === "adopted" && r.adoption?.head === head) {
          assertTransition(e.current_phase, "verifying");
          return yield* this.records.commitOwned(e, { current_phase: "verifying" });
        }
        const preflight = yield* this.engine.preflight(p, e);
        const count = (e.external_history?.length ?? 0) + (r ? 1 : 0);
        ensure(
          count < (e.effective_policy.validation?.max_runs ?? 1),
          "EXTERNAL_BUDGET",
          "External validation run budget exhausted",
        );
        const previous = r;
        r = {
          schema_version: 1,
          generation: e.control_generation,
          nonce: randomUUID(),
          validation_generation: `${e.execution_id}:${e.control_generation}:${count + 1}`,
          submitted_head: head,
          intent: intent.trim(),
          intent_digest: intentDigest(intent.trim()),
          branch: e.branch,
          custody: "reserved",
          status: "prepared",
          preflight,
          created_at: now,
          observed_at: now,
          next_check_at: now,
          responses: [],
        };
        assertTransition(e.current_phase, "validating_external");
        yield* this.records.commitOwned(e, {
          external_validation: r,
          current_phase: "validating_external",
          ...(previous && { external_history: [...(e.external_history ?? []), previous] }),
        });
      }
      if (r.next_check_at > now) return e;
      // Starting the same nonce is a proof-mode replay, never a fresh generic run.
      const result = yield* Effect.result(
        r.launch ? this.engine.status(e, r.launch.run_id) : this.engine.start(e, r),
      );
      if (result._tag === "Failure") {
        yield* this.save(e, {
          ...r,
          custody: "uncertain",
          error: result.failure.message.slice(0, 8192),
          next_check_at: nextCheckAt(now, 1),
        });
        return e;
      }
      r = this.accept(e, r, result.success, now);
      for (const response of r.responses.filter((x) =>
        ["running", "uncertain"].includes(x.status),
      )) {
        const changed = digest(result.success.gate) !== response.gate_digest;
        r = {
          ...r,
          responses: r.responses.map((x) =>
            x.id === response.id ? { ...x, status: changed ? "confirmed" : "uncertain" } : x,
          ),
        };
      }
      yield* this.save(e, r);
      if (r.status === "gated")
        yield* this.question(
          e,
          `External validation gate ${r.observation!.gate!.step}; use abra_work_validation with gate digest ${digest(r.observation!.gate)}. Findings: ${r
            .observation!.gate!.findings.map((f) => `${f.id}: ${f.description}`)
            .join("; ")
            .slice(0, 6000)}`,
        );
      if (r.status === "terminal") {
        if (this.success(r)) return yield* this.adopt(e, false);
        yield* this.question(
          e,
          `External run ${r.launch!.run_id} ended with ${r.observation?.outcome ?? r.observation?.run?.status}; inspect exceptions and recover custody explicitly`,
        );
      }
      return e;
    }.bind(this),
    domainEffect,
  );
  private success(r: ExternalRecord) {
    return externalSucceeded(r.observation);
  }
  adopt = Effect.fn("ExternalValidation.adopt")(
    function* (this: ExternalValidation, e: Execution, explicit: boolean) {
      let r = e.external_validation;
      ensure(r?.launch, "EXTERNAL_RUN", "No retained external run to adopt");
      if (r.custody === "returned" && r.adoption) return e;
      const doc = yield* this.engine.status(e, r.launch.run_id);
      r = this.accept(e, r, doc, yield* Clock.currentTimeMillis);
      ensure(
        r.status === "terminal",
        "EXTERNAL_ACTIVE",
        "Run must confirm termination before custody return",
      );
      ensure(
        explicit || this.success(r),
        "EXTERNAL_RESULT",
        "External result needs an explicit recovery decision",
      );
      yield* this.save(e, { ...r, custody: "uncertain" });
      const project = yield* this.admission.queries.effectiveProject(e);
      yield* this.git.validate(project, e);
      const sync = yield* this.engine.sync(e, true, project.remote);
      ensure(
        ["user_owned", "custody_returned", "synchronized"].includes(sync.state) &&
          sync.local.clean &&
          sync.local.branch === r.branch &&
          sync.pipeline.run === r.launch!.run_id,
        "EXTERNAL_CUSTODY",
        "Synchronization did not prove clean branch custody return",
      );
      ensure(
        sync.pipeline.submitted_head === r.submitted_head,
        "EXTERNAL_IDENTITY",
        "Synchronization submitted head differs from admission",
      );
      const head = yield* this.git.head(e.worktree_directory!);
      ensure(
        head === sync.local.head &&
          (!sync.pipeline.current_head || head === sync.pipeline.current_head),
        "EXTERNAL_HEAD",
        "Local head differs from preserved pipeline result",
      );
      yield* this.git.run(e.worktree_directory!, [
        "merge-base",
        "--is-ancestor",
        r.submitted_head,
        head,
      ]);
      const at = yield* Clock.currentTimeMillis;
      yield* this.settleQuestions(e, r, at);
      const succeeded = this.success(r);
      const nextPhase = succeeded ? ("verifying" as const) : ("blocked" as const);
      assertTransition(e.current_phase, nextPhase);
      return yield* this.records.commitOwned(e, {
        external_validation: {
          ...r,
          custody: "returned",
          status: succeeded ? "adopted" : "aborted",
          adoption: { head, at, sync },
          error: succeeded ? undefined : "Custody returned; external validation did not pass",
        },
        verification_receipt: removeOwnedField,
        review_receipt: removeOwnedField,
        current_phase: nextPhase,
        ...(!succeeded && { resume_phase: "applying" as const }),
      });
    }.bind(this),
    domainEffect,
  );
  control = Effect.fn("ExternalValidation.control")(
    function* (
      this: ExternalValidation,
      e: Execution,
      p: Project,
      input: typeof ValidationInput.Type,
      actor: SessionId,
    ) {
      ensure(
        input.generation === e.control_generation &&
          input.expected_head ===
            (e.external_validation?.submitted_head ??
              (yield* this.git.head(e.worktree_directory!))),
        "EXTERNAL_STALE",
        "External action needs the current generation/submitted head",
      );
      ensure(
        e.effective_policy.validation?.engine === "no-mistakes",
        "EXTERNAL_POLICY",
        "Execution did not select no-mistakes",
      );
      if (input.action === "preflight") {
        yield* this.engine.preflight(p, e);
        return e;
      }
      if (input.action === "setup") {
        ensure(
          !externalOwns(e),
          "EXTERNAL_CUSTODY",
          "Setup cannot change configuration during an external run",
        );
        let setup = e.validation_setup ?? {
          form_id: FormId.make(
            `frm_validation_${digest([e.execution_id, e.control_generation]).slice(0, 24)}`,
          ),
          session_id: actor,
          status: "prepared" as const,
        };
        yield* this.records.commitOwned(e, { validation_setup: setup });
        const setupDecision = yield* collectApprovalForm(
          this.runtime,
          setup.session_id,
          setup.form_id,
          `Initialize no-mistakes for ${p.path}. This installs repository gate metadata, hooks/remotes, may install user-level skills, and may start the configured daemon. Executable: ${this.engine.settings(e).bin}; runtime home: ${this.engine.settings(e).home}.`,
          Fingerprint.make(digest([p.id, this.engine.settings(e)])),
        );
        if (setupDecision !== "approved") return e;
        if (setup.status === "prepared") {
          yield* this.records.commitOwned(e, { validation_setup: { ...setup, status: "running" } });
          const result = yield* Effect.result(this.engine.setup(e));
          setup = { ...setup, status: result._tag === "Success" ? "confirmed" : "uncertain" };
          yield* this.records.commitOwned(e, { validation_setup: setup });
        }
        yield* this.engine.preflight(p, e);
        return e;
      }
      let r = e.external_validation;
      ensure(r?.launch, "EXTERNAL_RUN", "No retained launched run");
      if (input.action === "respond") {
        ensure(!e.stop_status, "CONTROL_PAUSED", "Resume before answering an external gate");
        const fresh = yield* this.engine.status(e);
        r = this.accept(e, r, fresh, yield* Clock.currentTimeMillis);
        const gate = fresh.gate;
        ensure(
          gate && digest(gate) === input.gate_digest && input.response,
          "EXTERNAL_GATE",
          "External gate changed before response",
        );
        ensure(
          !(
            gate.summary?.includes("(truncated,") ||
            gate.findings.some((f) => f.description.includes("(truncated,"))
          ),
          "EXTERNAL_INCOMPLETE",
          "Gate content is truncated; inspect full engine evidence before answering",
        );
        const ids = input.finding_ids ?? [];
        ensure(
          ids.every(
            (id) => /^[A-Za-z0-9._:-]{1,100}$/.test(id) && gate.findings.some((f) => f.id === id),
          ),
          "EXTERNAL_FINDING",
          "Selected gate finding is absent or ambiguous",
        );
        const id = digest([r.nonce, input.gate_digest, input.response, ids, input.instructions]);
        if (input.response === "fix")
          ensure(
            r.responses.filter(
              (x) =>
                x.id !== id &&
                x.step === gate.step &&
                x.action === "fix" &&
                x.status !== "rejected",
            ).length < r.preflight.fix_limits[gate.step],
            "EXTERNAL_FIX_BUDGET",
            "Snapshotted external fix budget exhausted",
          );
        let response = r.responses.find((x) => x.id === id);
        if (response && ["running", "uncertain", "confirmed"].includes(response.status)) return e;
        ensure(
          !r.responses.some((x) => ["running", "uncertain"].includes(x.status)),
          "EXTERNAL_RESPONSE_UNCERTAIN",
          "Reconcile the previous response before answering another gate",
        );
        response ??= {
          id,
          gate_digest: input.gate_digest!,
          step: gate.step,
          action: input.response,
          findings: ids,
          instructions: input.instructions ?? "",
          status: "prepared",
          at: yield* Clock.currentTimeMillis,
          form_id: FormId.make(`frm_external_${id.slice(0, 24)}`),
          session_id: actor,
        };
        r = { ...r, responses: [...r.responses.filter((x) => x.id !== id), response] };
        yield* this.save(e, r);
        const decision = yield* collectApprovalForm(
          this.runtime,
          response.session_id,
          response.form_id,
          `External ${response.action} for run ${r.launch!.run_id}, gate ${gate.step}: ${JSON.stringify(gate)}\nSelected findings: ${ids.join(", ")}\nInstructions: ${response.instructions}\nThis explicitly authorizes this gate response, including any displayed scope/protected-path/verification exception.`,
          Fingerprint.make(id),
        );
        if (decision === "pending") return e;
        response = { ...response, status: decision === "approved" ? "running" : "rejected" };
        r = { ...r, responses: r.responses.map((x) => (x.id === id ? response! : x)) };
        yield* this.save(e, r);
        if (decision === "rejected") return e;
        yield* this.settleQuestions(e, r, yield* Clock.currentTimeMillis, response.form_id);
        // The form may have waited while the daemon advanced. Re-read exact current-branch gate.
        const before = yield* this.engine.status(e);
        ensure(
          before.run?.id === r.launch!.run_id && digest(before.gate) === response.gate_digest,
          "EXTERNAL_GATE",
          "Gate changed while approval was pending",
        );
        const result = yield* Effect.result(this.engine.respond(e, response));
        if (result._tag === "Failure") {
          yield* this.save(e, {
            ...r,
            custody: "uncertain",
            responses: r.responses.map((x) => (x.id === id ? { ...x, status: "uncertain" } : x)),
            error: result.failure.message.slice(0, 8192),
          });
          return e;
        }
        r = this.accept(e, r, result.success, yield* Clock.currentTimeMillis);
        yield* this.save(e, {
          ...r,
          responses: r.responses.map((x) =>
            x.id === id
              ? {
                  ...x,
                  status: digest(result.success.gate) !== x.gate_digest ? "confirmed" : "uncertain",
                }
              : x,
          ),
        });
        return e;
      }
      // Abort/adoption are explicit recovery operations; a concrete human form authorizes the target run.
      const form = FormId.make(`frm_external_${digest([r.nonce, input.action]).slice(0, 24)}`);
      const recoveryDecision = yield* collectApprovalForm(
        this.runtime,
        actor,
        form,
        `External ${input.action} for exact run ${r.launch.run_id}, submitted head ${r.submitted_head}. Preserve all pipeline commits and return custody through the engine's offered guarded action.`,
        Fingerprint.make(digest([r.nonce, input.action])),
      );
      if (recoveryDecision !== "approved") return e;
      yield* this.settleQuestions(e, r, yield* Clock.currentTimeMillis, form);
      if (input.action === "abort") {
        const status = yield* this.engine.status(e, r.launch.run_id);
        if (
          !["completed", "failed", "cancelled", "ci_monitor_interrupted"].includes(
            status.run?.status ?? "",
          )
        ) {
          yield* this.save(e, { ...r, custody: "uncertain" });
          const aborted = yield* this.engine.abort(e, r.launch.run_id);
          ensure(
            aborted.aborted && aborted.run === r.launch.run_id,
            "EXTERNAL_ABORT",
            "External termination remains unconfirmed",
          );
        }
      }
      return yield* this.adopt(e, true);
    }.bind(this),
    domainEffect,
  );
}
