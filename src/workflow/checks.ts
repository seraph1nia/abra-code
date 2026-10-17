import { progress } from "../opencode/progress.ts";
import { approvedEvidence } from "./evidence.ts";
import { Executable, ActivityId, timestamp, IssueId, SessionId } from "../identities.ts";

import { fullPlanFingerprint } from "./planning.ts";
import { scopeIdentity } from "./scopes.ts";
import { Clock, Effect } from "effect";
import { CrewError, type Execution, type Project } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { type Records } from "../storage/store.ts";
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
  ) {}
  private launch = (e: Execution, role: "review") => this.sessions.launch(e, role);
  private get = (id: IssueId) => this.queries.get(id);
  assertPlan = Effect.fn("CodingChecks.assertPlan")(
    function* (this: CodingChecks, e: Execution, _p: Project) {
      const fp =
        e.workflow_policy === "full-openspec"
          ? yield* fullPlanFingerprint(this.git, e)
          : e.scope && scopeIdentity(e.scope.revision, e.scope.contract);
      if (!(fp === e.plan_fingerprint))
        return yield* new CrewError(
          "PLAN_CHANGED",
          "Approved planning artifacts changed; prepare a new approval",
        );
      if (e.plan_approval_required !== false) {
        if (
          !e.approval_receipts.some(
            (a) => a.kind === "plan" && a.fingerprint === fp && a.authorized_at,
          )
        )
          return yield* new CrewError("APPROVAL_REQUIRED", "Plan approval is missing or stale");
      }
      return yield* approvedEvidence(e);
    }.bind(this),
    domainEffect,
  );
  verify = Effect.fn("CodingChecks.verify")(
    function* (this: CodingChecks, e: Execution, p: Project) {
      if (e.workflow_policy === "full-openspec") yield* this.spec.implemented(e);
      const approved = yield* this.assertPlan(e, p);
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
        e.command_wait = {
          operation_id: e.operation.id,
          command: JSON.stringify([file, ...args]),
          started_at: started,
          deadline_at: started + options.deadline_ms,
        };
        yield* this.records.save(e);
        let lastOutput = started - 1000;
        const result = yield* Effect.result(
          this.git.runner.run(Executable.make(file), args, approved.worktree_directory, env, {
            ...options,
            onProgress: (output) => {
              if (output.at - lastOutput < 1000) return Effect.void;
              lastOutput = output.at;
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
                        current.command_wait?.operation_id !== e.command_wait?.operation_id
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
            },
          }),
        );
        delete e.command_wait;
        yield* this.records.save(e);
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
      if (synchronization)
        e.finishing = {
          ...e.finishing,
          schema_version: 1,
          synchronization: e.finishing!.synchronization!.map((attempt) =>
            attempt.ordinal === synchronization.ordinal
              ? { ...attempt, stage: "reviewing" }
              : attempt,
          ),
        };
      if (synchronization) yield* this.records.saveFinishing(e, ["synchronization"]);
      e.verification_receipt = {
        fingerprint: before,
        commands: p.verification,
        at: yield* timestamp,
      };
      delete e.review_receipt;
      yield* this.records.save(e);
      yield* this.launch(e, "review");
      return e;
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
    ) {
      const assigned = (yield* this.records.executions()).find(
        (e) => e.review_session_id === session,
      );
      if (!assigned?.worktree_directory)
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
              { passed, findings, scope_status, spec_verification },
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
            e.review_receipt = {
              ...report,
              scope_status: reviewScope(report),
              session_id: session,
              fingerprint,
            };
            return yield* this.records.save(e);
          }),
        ),
      );
    }.bind(this),
    domainEffect,
  );
}
