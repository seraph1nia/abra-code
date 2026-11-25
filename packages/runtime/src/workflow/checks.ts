import { readReviewChanges } from "../git/review-changes.ts";
import { progress } from "../opencode/progress.ts";
import {
  Executable,
  ActivityId,
  timestamp,
  IssueId,
  SessionId,
  RelativePath,
} from "@abracode/contracts/identities";

import type { CheckpointEvidence } from "./authorization.ts";
import { Clock, Effect } from "effect";
import { CrewError, type Execution, type Project } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { removeOwnedField, type Records } from "../storage/store.ts";
import { type Git } from "../git/repository.ts";
import { type OpenSpec } from "../openspec/adapter.ts";
import { verificationCommand } from "../config/contracts.ts";
import { type Coordination } from "./coordination.ts";
import { type WorkerSessions } from "./sessions.ts";
import { type Queries } from "./queries.ts";
import { decode } from "../decode.ts";
import { isActiveWorker } from "./worker-assignment.ts";
import { activeSynchronization } from "./synchronization.ts";
import {
  ReviewReportSchema,
  type PatchAssessment,
  reviewScope,
  specVerificationPassed,
  type SpecVerification,
} from "./review-contracts.ts";
/** Owns planning fingerprints, successful check receipts and independent Review reports. */
export class CodingChecks {
  constructor(
    private records: Records,
    private git: Git,
    private spec: OpenSpec,
    private sessions: WorkerSessions,
    private coordination: Coordination,
    private queries: Queries,
    private checkpoints: CheckpointEvidence,
    private ocr: Executable,
  ) {}
  private launch = (e: Execution, role: "review") => this.sessions.launch(e, role);
  private get = (id: IssueId) => this.queries.get(id);
  assertPlan = Effect.fn("CodingChecks.assertPlan")(
    function* (this: CodingChecks, e: Execution) {
      if (e.workflow_policy === "full-openspec") yield* this.spec.assertSchema(e);
      return yield* this.checkpoints.assertPlan(e);
    }.bind(this),
    domainEffect,
  );
  verify = Effect.fn("CodingChecks.verify")(
    function* (this: CodingChecks, e: Execution, p: Project) {
      if (e.workflow_policy === "full-openspec") yield* this.spec.implemented(e);
      const approved = yield* this.assertPlan(e);
      if (!(p.verification.length > 0))
        return yield* new CrewError(
          "CHECKS_MISSING",
          "Configure at least one explicit verification command",
        );
      const before = yield* this.git.fingerprint(approved.worktree_directory);
      let completed = 0;
      yield* progress({
        stage: "verify",
        status: "started",
        completed,
        total: p.verification.length,
      });
      for (const command of p.verification) {
        const {
          argv: [file, ...args],
          env,
          ...options
        } = verificationCommand(command);
        const started = yield* Clock.currentTimeMillis;
        if (!e.operation)
          return yield* new CrewError(
            "OPERATION_MISSING",
            "Verification requires owned operation identity",
          );
        const operationId = e.operation.id;
        e.command_wait = {
          operation_id: operationId,
          command: JSON.stringify([file, ...args]),
          started_at: started,
          deadline_at: started + options.deadline_ms,
        };
        yield* this.records.saveOwned(e, ["command_wait"]);
        let lastOutput: bigint | undefined;
        let cleared = false;
        const result = yield* Effect.gen({ self: this }, function* () {
          const outcome = yield* Effect.result(
            this.git.runner.run(Executable.make(file), args, approved.worktree_directory, env, {
              ...options,
              onProgress: (output) =>
                Clock.monotonicTimeNanos.pipe(
                  Effect.flatMap((now) => {
                    if (lastOutput !== undefined && now - lastOutput < 1_000_000_000n)
                      return Effect.void;
                    lastOutput = now;
                    return progress({
                      stage: "verify",
                      status: "running",
                      completed,
                      total: p.verification.length,
                      stdout_bytes: output.stdout_bytes,
                      stderr_bytes: output.stderr_bytes,
                    }).pipe(
                      Effect.andThen(
                        this.records
                          .update(e.issue_id, (current) => {
                            if (
                              current.control_generation !== e.control_generation ||
                              current.command_wait?.operation_id !== operationId
                            )
                              return;
                            return {
                              ...current,
                              progress: {
                                schema_version: 1,
                                generation: e.control_generation,
                                session_id: e.apply_session_id ?? e.execution_id,
                                at: output.at,
                                source: "command",
                                summary: `${file}: ${output.stdout_bytes} stdout / ${output.stderr_bytes} stderr bytes`,
                                identity: ActivityId.make(
                                  `command:${output.stdout_bytes}:${output.stderr_bytes}`,
                                ),
                              },
                            };
                          })
                          .pipe(Effect.asVoid),
                      ),
                    );
                  }),
                ),
            }),
          );
          delete e.command_wait;
          yield* this.records.saveOwned(e, ["command_wait"]);
          cleared = true;
          return outcome;
        }).pipe(
          Effect.ensuring(
            Effect.suspend(() => {
              if (cleared) return Effect.void;
              cleared = true;
              delete e.command_wait;
              return this.records
                .update(e.issue_id, (current) => {
                  if (current.command_wait?.operation_id !== operationId) return;
                  const next = { ...current };
                  delete next.command_wait;
                  return next;
                })
                .pipe(Effect.ignore);
            }),
          ),
        );
        if (result._tag === "Failure")
          return yield* new CrewError(
            "VERIFICATION_FAILED",
            `Verification ${file}: ${result.failure.message}`,
          );
        yield* progress({
          stage: "verify",
          status: "running",
          completed: ++completed,
          total: p.verification.length,
        });
      }
      yield* progress({
        stage: "verify",
        status: "completed",
        completed,
        total: p.verification.length,
      });
      if (!(before === (yield* this.git.fingerprint(approved.worktree_directory))))
        return yield* new CrewError(
          "CHECKS_MUTATED",
          "Checks modified tracked/untracked content; preserve or ignore generated output and retry",
        );
      const synchronization = activeSynchronization(e);
      const at = yield* timestamp;
      const check = {
        fingerprint: before,
        at,
        commands: p.verification.map((command) => verificationCommand(command).argv.join(" ")),
      };
      yield* this.records.commitOwned(e, (current) => ({
        ...(synchronization &&
          current.finishing?.synchronization && {
            finishing: {
              ...current.finishing,
              schema_version: 1,
              synchronization: current.finishing.synchronization.map((attempt) =>
                attempt.ordinal === synchronization.ordinal
                  ? { ...attempt, stage: "reviewing" as const }
                  : attempt,
              ),
            },
          }),
        check_history: [
          ...(current.check_history ?? []).filter((item) => item.fingerprint !== before),
          check,
        ].slice(-16),
        verification_receipt: {
          fingerprint: before,
          commands: p.verification,
          at,
        },
        review_receipt: removeOwnedField,
        review_coverage: removeOwnedField,
      }));
      yield* this.launch(e, "review");
      return e;
    }.bind(this),
    domainEffect,
  );
  reviewChanges = Effect.fn("CodingChecks.reviewChanges")(
    function* (this: CodingChecks, session: SessionId, offset = 0, selected?: RelativePath) {
      const e = yield* this.records.workerAssignment(session);
      if (
        !e?.worktree_directory ||
        !e.base_commit ||
        !e.worker_context_id ||
        !e.verification_receipt ||
        !isActiveWorker(e, session, { role: "review" })
      )
        return yield* new CrewError("REVIEW_ROLE", "Assigned Review of verified content required");
      const prompt = e.worker_context_id;
      const fingerprint = e.verification_receipt.fingerprint;
      yield* this.git.validate(yield* this.queries.effectiveProject(e), e);
      if (fingerprint !== (yield* this.git.fingerprint(e.worktree_directory)))
        return yield* new CrewError("REVIEW_STALE", "Verified content changed before review");
      const page = yield* readReviewChanges(
        this.git,
        this.ocr,
        e.worktree_directory,
        e.base_commit,
        offset,
        selected,
      );
      if (fingerprint !== (yield* this.git.fingerprint(e.worktree_directory)))
        return yield* new CrewError("REVIEW_STALE", "Verified content changed during review");
      yield* this.coordination.with(() =>
        Effect.gen({ self: this }, function* () {
          const current = yield* this.get(e.issue_id);
          if (
            !isActiveWorker(current, session, {
              role: "review",
              generation: e.control_generation,
            }) ||
            current.worker_context_id !== prompt ||
            current.verification_receipt?.fingerprint !== fingerprint
          )
            return yield* new CrewError(
              "REVIEW_STALE",
              "Review assignment changed during the diff read",
            );

          const prior = current.review_coverage;
          const same =
            prior?.session_id === session &&
            prior.generation === e.control_generation &&
            prior.prompt_id === prompt &&
            prior.fingerprint === fingerprint;
          const through = same ? prior.through : 0;
          if (offset > through)
            return yield* new CrewError("REVIEW_OFFSET", "Read the preceding review page first");
          const end = selected ? through : offset + page.changes.length;
          current.review_coverage = {
            session_id: session,
            generation: e.control_generation,
            fingerprint,
            prompt_id: prompt,
            unavailable: [
              ...new Set([
                ...(same ? prior.unavailable : []),
                ...page.changes.filter((f) => f.unavailable).map((f) => f.path),
              ]),
            ],
            through: Math.max(end, through),
            complete: (same && prior.complete) || (!selected && page.next_offset === undefined),
            limited: (same && prior.limited) || page.inventory_limited,
          };
          yield* this.records.saveOwned(current, ["review_coverage"]);
        }),
      );
      return page;
    }.bind(this),
    domainEffect,
  );
  reviewReport = Effect.fn("CodingChecks.reviewReport")(
    function* (
      this: CodingChecks,
      session: SessionId,
      passed: boolean,
      findings: string,
      scope_status?: typeof import("./correction-contracts.ts").ScopeDispositionSchema.Type,
      spec_verification?: SpecVerification,
      patch_assessments?: typeof PatchAssessment.Type,
    ) {
      const assigned = yield* this.records.workerAssignment(session);
      if (!assigned?.worktree_directory || assigned.review_session_id !== session)
        return yield* new CrewError("REVIEW_ROLE", "Assigned Review session required");
      const fingerprint = yield* this.git.fingerprint(assigned.worktree_directory);
      return yield* this.coordination.with(() =>
        domainEffect(
          Effect.gen({ self: this }, function* () {
            const e = yield* this.get(assigned.issue_id);
            if (
              !(
                isActiveWorker(e, session, {
                  role: "review",
                  generation: assigned.control_generation,
                }) && e.verification_receipt?.fingerprint === fingerprint
              )
            )
              return yield* new CrewError(
                "REVIEW_ROLE",
                "Only the current assigned Review session may report matching verified content",
              );
            const report = yield* decode(
              ReviewReportSchema,
              { passed, findings, scope_status, spec_verification, patch_assessments },
              "Review report",
            );
            if (e.workflow_policy === "full-openspec" && !report.spec_verification)
              return yield* new CrewError(
                "SPEC_VERIFICATION_REQUIRED",
                "Full-spec Review requires completeness, correctness, coherence and conflict evidence",
              );
            if (
              report.passed &&
              ((report.spec_verification && !specVerificationPassed(report.spec_verification)) ||
                (report.scope_status && report.scope_status !== "in_scope"))
            )
              return yield* new CrewError(
                "REVIEW_CONTRADICTION",
                "A passing Review cannot contain failed/unverified assessments or unresolved scope conflicts",
              );
            if (report.passed && e.worker_context_id) {
              const context = yield* this.queries.capturedWorkerPrompt(e);
              if (
                context.environment.tools.some((group) =>
                  group.any_of.some((name) => name === "abra_review_changes"),
                )
              ) {
                const coverage = e.review_coverage;
                if (
                  !coverage?.complete ||
                  coverage.limited ||
                  coverage.prompt_id !== e.worker_context_id ||
                  coverage.unavailable.some(
                    (path) => !report.patch_assessments?.some((a) => a.path === path),
                  ) ||
                  coverage.fingerprint !== fingerprint ||
                  coverage.session_id !== session ||
                  coverage.generation !== e.control_generation
                )
                  return yield* new CrewError(
                    "REVIEW_COVERAGE",
                    "Read all verified review pages and resolve missing patch evidence before passing Review",
                  );
              }
            }
            e.review_receipt = {
              ...report,
              scope_status: reviewScope(report),
              session_id: session,
              fingerprint,
            };
            return yield* this.records.saveOwned(e, ["review_receipt"]);
          }),
        ),
      );
    }.bind(this),
    domainEffect,
  );
}
