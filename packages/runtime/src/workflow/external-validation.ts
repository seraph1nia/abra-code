import { WorkflowError } from "../errors.ts";
import { tryDomainValue } from "../effect.ts";
import { OperationAction } from "@abracode/contracts/identities";
import { type Capacity } from "./capacity.ts";
import { type WorkGraph } from "../work/graph.ts";
import { type Operations } from "./operations.ts";
import { type Queries } from "./queries.ts";
import { type WorkerSessions } from "./sessions.ts";
import { randomUUID } from "node:crypto";
import { Clock, Effect, Match } from "effect";
import { ObligationKey, FormId, Fingerprint, type SessionId } from "@abracode/contracts/identities";
import { CrewError, ensure, type Execution, type Project } from "../domain.ts";
import { removeOwnedField, type Records } from "../storage/store.ts";
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
import { nextCheckAt } from "./messaging/outbox.ts";
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
      Effect.gen({ self: this }, function* () {
        const e = yield* this.admission.queries.get(input.issue_id);
        yield* this.admission.sessions.idle(e);
        const p = yield* this.admission.queries.effectiveProject(e);
        return yield* this.control(e, p, input, actor);
      }),
    );
  advance = (e: Execution, p: Project) =>
    this.prepare(e, p).pipe(
      Effect.ensuring(this.admission.capacity.releaseIfPreparing(e, "apply")),
    );
  private prepare = Effect.fn("ExternalValidation.advance")(
    { self: this },
    function* (e: Execution, p: Project) {
      if (!externalOwns(e)) {
        const reservation = yield* this.admission.capacity.reserve(e, "apply", p);
        e = reservation.execution;
        if (!reservation.admitted) return e;
      }
      const issue = yield* this.admission.work.show(e.issue_id);
      e = yield* this.drive(
        e,
        p,
        JSON.stringify({
          intent: e.intent ?? { title: issue.title, description: issue.description },
          scope: e.scope?.contract,
          plan: e.plan_fingerprint,
        }),
      );
      return e;
    },
  );
  private question = Effect.fn("ExternalValidation.question")(
    { self: this },
    function* (e: Execution, question: string) {
      const r = e.external_validation!;
      const decision = yield* openControllerDecision(this.records, e, {
        key: ObligationKey.make(
          `external-${r.nonce}-${digest(r.observation?.gate ?? r.status).slice(0, 16)}`,
        ),
        question,
        matchAnyGeneration: true,
        staleMessage: "External decision was superseded",
        limitMessage: "External decision history requires inspection",
      });
      return decision.execution;
    },
  );
  private settleQuestions = Effect.fn("ExternalValidation.settleQuestions")(
    { self: this },
    function* (e: Execution, r: ExternalRecord, at: number, form?: FormId) {
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
      return saved;
    },
  );
  private save(e: Execution, r: ExternalRecord) {
    return this.records.commitOwned(e, { external_validation: r });
  }
  private accept = Effect.fn("ExternalValidation.accept")(function* (
    e: Execution,
    r: ExternalRecord,
    doc: typeof ExternalDocument.Type,
    now: number,
  ): Effect.fn.Return<ExternalRecord, CrewError> {
    const launch = doc.launch_receipt ?? r.launch;
    if (
      e.branch !== r.branch ||
      !launch ||
      launch.launch_nonce !== r.nonce ||
      launch.validation_generation !== r.validation_generation ||
      launch.branch !== r.branch ||
      launch.submitted_head_sha !== r.submitted_head ||
      launch.intent_digest !== r.intent_digest
    )
      return yield* new WorkflowError(
        "EXTERNAL_LAUNCH",
        "Engine did not prove the reserved launch identity",
      );
    if (doc.run?.id !== launch.run_id || doc.run.branch !== r.branch)
      return yield* new WorkflowError(
        "EXTERNAL_RUN",
        "Observed run differs from the retained launch",
      );
    const terminal = ["completed", "failed", "cancelled", "ci_monitor_interrupted"].includes(
      doc.run.status,
    );
    if (doc.outcome && !terminal && doc.outcome !== "checks-passed")
      return yield* new WorkflowError("EXTERNAL_OUTCOME", "Outcome contradicts active run state");
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
  });
  drive = Effect.fn("ExternalValidation.drive")(
    { self: this },
    function* (e: Execution, p: Project, intent: string) {
      if (e.stop_status) return e;
      const now = yield* Clock.currentTimeMillis;
      let r = e.external_validation;
      if (!r || r.custody === "returned") {
        if (externalOwns(e))
          return yield* new WorkflowError(
            "EXTERNAL_CUSTODY",
            "Previous external run still owns the branch",
          );
        const head = yield* this.git.commit(
          e.worktree_directory!,
          e.issue_id,
          `Prepare external validation ${e.issue_id}`,
        );
        e = yield* this.records.commitOwned(e, { implementation_head: head });
        if (r?.status === "adopted" && r.adoption?.head === head) {
          yield* tryDomainValue(assertTransition, e, "verifying");
          return yield* this.records.commitOwned(e, { current_phase: "verifying" });
        }
        const preflight = yield* this.engine.preflight(p, e);
        const count = (e.external_history?.length ?? 0) + (r ? 1 : 0);
        if (!(count < (e.effective_policy.validation?.max_runs ?? 1)))
          return yield* new WorkflowError(
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
        yield* tryDomainValue(assertTransition, e, "validating_external");
        e = yield* this.records.commitOwned(e, {
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
        e = yield* this.save(e, {
          ...r,
          custody: "uncertain",
          error: result.failure.message.slice(0, 8192),
          next_check_at: nextCheckAt(now, 1),
        });
        return e;
      }
      r = yield* this.accept(e, r, result.success, now);
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
      e = yield* this.save(e, r);
      if (r.status === "gated")
        e = yield* this.question(
          e,
          `External validation gate ${r.observation!.gate!.step}; use abra_work_validation with gate digest ${digest(r.observation!.gate)}. Findings: ${r
            .observation!.gate!.findings.map((f) => `${f.id}: ${f.description}`)
            .join("; ")
            .slice(0, 6000)}`,
        );
      if (r.status === "terminal") {
        if (this.success(r)) return yield* this.adopt(e, false);
        e = yield* this.question(
          e,
          `External run ${r.launch!.run_id} ended with ${r.observation?.outcome ?? r.observation?.run?.status}; inspect exceptions and recover custody explicitly`,
        );
      }
      return e;
    },
  );
  private success(r: ExternalRecord) {
    return externalSucceeded(r.observation);
  }
  adopt = Effect.fn("ExternalValidation.adopt")(
    { self: this },
    function* (e: Execution, explicit: boolean) {
      let r = e.external_validation;
      if (!r?.launch)
        return yield* new WorkflowError("EXTERNAL_RUN", "No retained external run to adopt");
      if (r.custody === "returned" && r.adoption) return e;
      const doc = yield* this.engine.status(e, r.launch.run_id);
      r = yield* this.accept(e, r, doc, yield* Clock.currentTimeMillis);
      if (r.status !== "terminal")
        return yield* new WorkflowError(
          "EXTERNAL_ACTIVE",
          "Run must confirm termination before custody return",
        );
      if (!(explicit || this.success(r)))
        return yield* new WorkflowError(
          "EXTERNAL_RESULT",
          "External result needs an explicit recovery decision",
        );
      e = yield* this.save(e, { ...r, custody: "uncertain" });
      const project = yield* this.admission.queries.effectiveProject(e);
      yield* this.git.validate(project, e);
      const sync = yield* this.engine.sync(e, true, project.remote);
      if (
        !["user_owned", "custody_returned", "synchronized"].includes(sync.state) ||
        !sync.local.clean ||
        sync.local.branch !== r.branch ||
        sync.pipeline.run !== r.launch!.run_id
      )
        return yield* new WorkflowError(
          "EXTERNAL_CUSTODY",
          "Synchronization did not prove clean branch custody return",
        );
      if (sync.pipeline.submitted_head !== r.submitted_head)
        return yield* new WorkflowError(
          "EXTERNAL_IDENTITY",
          "Synchronization submitted head differs from admission",
        );
      const head = yield* this.git.head(e.worktree_directory!);
      if (
        head !== sync.local.head ||
        (sync.pipeline.current_head && head !== sync.pipeline.current_head)
      )
        return yield* new WorkflowError(
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
      e = yield* this.settleQuestions(e, r, at);
      const succeeded = this.success(r);
      const nextPhase = succeeded ? ("verifying" as const) : ("blocked" as const);
      yield* tryDomainValue(assertTransition, e, nextPhase, "adopt_external");
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
    },
  );
  private withApproval = Effect.fn("ExternalValidation.withApproval")(
    { self: this },
    function* (
      e: Execution,
      session: SessionId,
      form: FormId,
      prompt: string,
      fingerprint: Fingerprint,
      approved: Effect.Effect<Execution, CrewError>,
      rejected: Effect.Effect<Execution, CrewError> = Effect.succeed(e),
    ) {
      const decision = yield* collectApprovalForm(this.runtime, session, form, prompt, fingerprint);
      switch (decision) {
        case "pending":
          return e;
        case "approved":
          return yield* approved;
        case "rejected":
          return yield* rejected;
      }
    },
  );
  private setup = Effect.fn("ExternalValidation.setup")(
    { self: this },
    function* (e: Execution, p: Project, actor: SessionId) {
      if (externalOwns(e))
        return yield* new WorkflowError(
          "EXTERNAL_CUSTODY",
          "Setup cannot change configuration during an external run",
        );
      const settings = yield* this.engine.settings(e);
      let setup = e.validation_setup ?? {
        form_id: FormId.make(
          `frm_validation_${digest([e.execution_id, e.control_generation]).slice(0, 24)}`,
        ),
        session_id: actor,
        status: "prepared" as const,
      };
      e = yield* this.records.commitOwned(e, { validation_setup: setup });
      return yield* this.withApproval(
        e,
        setup.session_id,
        setup.form_id,
        `Initialize no-mistakes for ${p.path}. This installs repository gate metadata, hooks/remotes, may install user-level skills, and may start the configured daemon. Executable: ${settings.bin}; runtime home: ${settings.home}.`,
        Fingerprint.make(digest([p.id, settings])),
        Effect.gen({ self: this }, function* () {
          if (setup.status === "prepared") {
            e = yield* this.records.commitOwned(e, {
              validation_setup: { ...setup, status: "running" },
            });
            const result = yield* Effect.result(this.engine.setup(e));
            setup = { ...setup, status: result._tag === "Success" ? "confirmed" : "uncertain" };
            e = yield* this.records.commitOwned(e, { validation_setup: setup });
          }
          yield* this.engine.preflight(p, e);
          return e;
        }),
      );
    },
  );
  private respond = Effect.fn("ExternalValidation.respond")(
    { self: this },
    function* (
      e: Execution,
      r: ExternalRecord,
      runId: string,
      input: typeof ValidationInput.Type,
      actor: SessionId,
    ) {
      if (e.stop_status)
        return yield* new WorkflowError(
          "CONTROL_PAUSED",
          "Resume before answering an external gate",
        );
      const fresh = yield* this.engine.status(e);
      r = yield* this.accept(e, r, fresh, yield* Clock.currentTimeMillis);
      const gate = fresh.gate;
      if (!gate || digest(gate) !== input.gate_digest || !input.response)
        return yield* new WorkflowError("EXTERNAL_GATE", "External gate changed before response");
      if (
        gate.summary?.includes("(truncated,") ||
        gate.findings.some((f) => f.description.includes("(truncated,"))
      )
        return yield* new WorkflowError(
          "EXTERNAL_INCOMPLETE",
          "Gate content is truncated; inspect full engine evidence before answering",
        );
      const ids = input.finding_ids ?? [];
      if (
        !ids.every(
          (id) => /^[A-Za-z0-9._:-]{1,100}$/.test(id) && gate.findings.some((f) => f.id === id),
        )
      )
        return yield* new WorkflowError(
          "EXTERNAL_FINDING",
          "Selected gate finding is absent or ambiguous",
        );
      const id = digest([r.nonce, input.gate_digest, input.response, ids, input.instructions]);
      if (input.response === "fix")
        if (
          !(
            r.responses.filter(
              (x) =>
                x.id !== id &&
                x.step === gate.step &&
                x.action === "fix" &&
                x.status !== "rejected",
            ).length < r.preflight.fix_limits[gate.step]
          )
        )
          return yield* new WorkflowError(
            "EXTERNAL_FIX_BUDGET",
            "Snapshotted external fix budget exhausted",
          );
      const prior = r.responses.find((x) => x.id === id);
      if (prior && ["running", "uncertain", "confirmed"].includes(prior.status)) return e;
      if (r.responses.some((x) => ["running", "uncertain"].includes(x.status)))
        return yield* new WorkflowError(
          "EXTERNAL_RESPONSE_UNCERTAIN",
          "Reconcile the previous response before answering another gate",
        );
      const response = prior ?? {
        id,
        gate_digest: input.gate_digest!,
        step: gate.step,
        action: input.response,
        findings: ids,
        instructions: input.instructions ?? "",
        status: "prepared" as const,
        at: yield* Clock.currentTimeMillis,
        form_id: FormId.make(`frm_external_${id.slice(0, 24)}`),
        session_id: actor,
      };
      if (!prior) r = { ...r, responses: [...r.responses, response] };
      e = yield* this.save(e, r);
      const decisionRecord = (status: "running" | "rejected") => ({
        ...r,
        responses: r.responses.map((x) => (x.id === id ? { ...x, status } : x)),
      });
      return yield* this.withApproval(
        e,
        response.session_id,
        response.form_id,
        `External ${response.action} for run ${runId}, gate ${gate.step}: ${JSON.stringify(gate)}\nSelected findings: ${ids.join(", ")}\nInstructions: ${response.instructions}\nThis explicitly authorizes this gate response, including any displayed scope/protected-path/verification exception.`,
        Fingerprint.make(id),
        this.dispatchResponse(
          e,
          decisionRecord("running"),
          { ...response, status: "running" },
          runId,
        ),
        this.save(e, decisionRecord("rejected")),
      );
    },
  );
  private dispatchResponse = Effect.fn("ExternalValidation.dispatchResponse")(
    { self: this },
    function* (
      e: Execution,
      r: ExternalRecord,
      response: ExternalRecord["responses"][number],
      runId: string,
    ) {
      e = yield* this.save(e, r);
      e = yield* this.settleQuestions(e, r, yield* Clock.currentTimeMillis, response.form_id);
      // The form may have waited while the daemon advanced. Re-read exact current-branch gate.
      const before = yield* this.engine.status(e);
      if (before.run?.id !== runId || digest(before.gate) !== response.gate_digest)
        return yield* new WorkflowError("EXTERNAL_GATE", "Gate changed while approval was pending");
      const result = yield* Effect.result(this.engine.respond(e, response));
      if (result._tag === "Failure") {
        e = yield* this.save(e, {
          ...r,
          custody: "uncertain",
          responses: r.responses.map((x) =>
            x.id === response.id ? { ...x, status: "uncertain" } : x,
          ),
          error: result.failure.message.slice(0, 8192),
        });
        return e;
      }
      r = yield* this.accept(e, r, result.success, yield* Clock.currentTimeMillis);
      e = yield* this.save(e, {
        ...r,
        responses: r.responses.map((x) =>
          x.id === response.id
            ? {
                ...x,
                status: digest(result.success.gate) !== x.gate_digest ? "confirmed" : "uncertain",
              }
            : x,
        ),
      });
      return e;
    },
  );
  private recover = Effect.fn("ExternalValidation.recover")(
    { self: this },
    function* (
      e: Execution,
      r: ExternalRecord,
      runId: string,
      action: "abort" | "adopt",
      actor: SessionId,
    ) {
      const form = FormId.make(`frm_external_${digest([r.nonce, action]).slice(0, 24)}`);
      return yield* this.withApproval(
        e,
        actor,
        form,
        `External ${action} for exact run ${runId}, submitted head ${r.submitted_head}. Preserve all pipeline commits and return custody through the engine's offered guarded action.`,
        Fingerprint.make(digest([r.nonce, action])),
        Effect.gen({ self: this }, function* () {
          e = yield* this.settleQuestions(e, r, yield* Clock.currentTimeMillis, form);
          if (action === "abort") {
            const status = yield* this.engine.status(e, runId);
            if (
              !["completed", "failed", "cancelled", "ci_monitor_interrupted"].includes(
                status.run?.status ?? "",
              )
            ) {
              e = yield* this.save(e, { ...r, custody: "uncertain" });
              const aborted = yield* this.engine.abort(e, runId);
              if (!aborted.aborted || aborted.run !== runId)
                return yield* new WorkflowError(
                  "EXTERNAL_ABORT",
                  "External termination remains unconfirmed",
                );
            }
          }
          return yield* this.adopt(e, true);
        }),
      );
    },
  );
  control = Effect.fn("ExternalValidation.control")(
    { self: this },
    function* (e: Execution, p: Project, input: typeof ValidationInput.Type, actor: SessionId) {
      if (
        input.generation !== e.control_generation ||
        input.expected_head !==
          (e.external_validation?.submitted_head ?? (yield* this.git.head(e.worktree_directory!)))
      )
        return yield* new WorkflowError(
          "EXTERNAL_STALE",
          "External action needs the current generation/submitted head",
        );
      if (e.effective_policy.validation?.engine !== "no-mistakes")
        return yield* new WorkflowError("EXTERNAL_POLICY", "Execution did not select no-mistakes");
      if (input.action === "preflight")
        return yield* this.engine.preflight(p, e).pipe(Effect.as(e));
      if (input.action === "setup") return yield* this.setup(e, p, actor);
      const r = e.external_validation;
      if (!r?.launch) return yield* new WorkflowError("EXTERNAL_RUN", "No retained launched run");
      const { run_id } = r.launch;
      return yield* Match.value(input.action).pipe(
        Match.when("respond", () => this.respond(e, r, run_id, input, actor)),
        Match.whenOr("abort", "adopt", (action) => this.recover(e, r, run_id, action, actor)),
        Match.exhaustive,
      );
    },
  );
}
