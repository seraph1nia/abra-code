import { type PRFeedback } from "./pr-feedback.ts";
import { externalOwns } from "../validation/contracts.ts";
import { progress, completedProgress } from "../opencode/progress.ts";
import { provisionedEvidence, verifiedEvidence, deliveredEvidence } from "./evidence.ts";
import { Clock, Effect } from "effect";
import { join } from "node:path";
import { access, pathExists } from "../filesystem.ts";
import { CrewError, type Execution, type Project } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { type Git } from "../git/repository.ts";
import { type Delivery, type DeliveryAssessment } from "../git/delivery.ts";
import { type Workspaces } from "../git/workspaces.ts";
import { type OpenSpec } from "../openspec/adapter.ts";
import { type Records } from "../storage/store.ts";
import { type WorkGraph } from "../work/graph.ts";
import { type Coordination } from "./coordination.ts";
import { type WorkerSessions } from "./sessions.ts";
import { type Reports } from "./reports.ts";
import { type Obligations } from "./obligations.ts";
import { type ExecutionTransitions } from "./transitions.ts";
import { type OperationResult } from "./results.ts";
import { specVerificationPassed } from "./review-contracts.ts";
interface Dependencies {
  feedback: PRFeedback;
  git: Git;
  spec: OpenSpec;
  records: Records;
  delivery: Delivery;
  reports: Reports;
  workspaces: Workspaces;
  coordination: Coordination;
  work: WorkGraph;
  obligations: Obligations;
  sessions: WorkerSessions;
  transitions: ExecutionTransitions;
}
/** Reviewed content proceeds through archival, delivery evidence and safe retirement. */
export class Finalization {
  constructor(private c: Dependencies) {}
  archive = Effect.fn("Finalization.archive")(
    function* (this: Finalization, e: Execution, p: Project) {
      if (externalOwns(e))
        return yield* new CrewError(
          "EXTERNAL_CUSTODY",
          "External branch custody must return before publication or retirement",
        );
      const evidence = yield* verifiedEvidence(e);
      if (!(e.verification_receipt && e.review_receipt?.passed))
        return yield* new CrewError("VERIFICATION_REQUIRED", "Missing successful checks/review");
      if (
        e.workflow_policy === "full-openspec" &&
        !specVerificationPassed(e.review_receipt.spec_verification)
      )
        return yield* new CrewError(
          "SPEC_VERIFICATION_REQUIRED",
          "Full-spec archival requires independent specification verification",
        );
      if (
        yield* access(
          join(evidence.worktree_directory, "openspec/changes", e.openspec_change),
        ).pipe(Effect.match({ onSuccess: () => true, onFailure: () => false }))
      ) {
        if (
          !(
            (yield* this.c.git.fingerprint(evidence.worktree_directory)) ===
            e.verification_receipt.fingerprint
          )
        )
          return yield* new CrewError("VERIFICATION_STALE", "Content changed before archival");
      }
      if (e.workflow_policy === "lightweight-fix") {
        if (
          !(
            (yield* this.c.git.fingerprint(evidence.worktree_directory)) ===
            e.verification_receipt.fingerprint
          )
        )
          return yield* new CrewError("VERIFICATION_STALE", "Content changed before delivery");
        yield* this.c.git.run(evidence.worktree_directory, ["add", "--all"]);
        e.archived_tree = yield* this.c.git.tree(evidence.worktree_directory);
        yield* this.c.transitions.move(e, "delivering");
        return yield* this.deliver(e, p);
      }
      // Archival is idempotently reconciled from actual active/archive directories.
      e.archive_path = yield* this.c.spec.archive(e);
      yield* this.c.git.run(evidence.worktree_directory, ["add", "--all"]);
      e.archived_tree = yield* this.c.git.tree(evidence.worktree_directory);
      yield* this.c.records.save(e);
      yield* this.c.transitions.move(e, "delivering");
      return yield* this.deliver(e, p);
    }.bind(this),
    domainEffect,
  );
  deliver = Effect.fn("Finalization.deliver")(
    function* (this: Finalization, e: Execution, p: Project) {
      if (externalOwns(e))
        return yield* new CrewError(
          "EXTERNAL_CUSTODY",
          "External branch custody must return before publication or retirement",
        );
      const evidence = yield* verifiedEvidence(e);
      if (
        !(
          (e.workflow_policy === "lightweight-fix" ? e.scope : e.archive_path) &&
          e.review_receipt?.passed
        )
      )
        return yield* new CrewError("ARCHIVE_REQUIRED", "Archive/review evidence missing");
      if (
        !(
          e.archived_tree &&
          (yield* this.c.git.tree(evidence.worktree_directory)) === e.archived_tree &&
          !(yield* this.c.git.run(evidence.worktree_directory, ["diff", "--name-only"])) &&
          !(yield* this.c.git.run(evidence.worktree_directory, [
            "ls-files",
            "--others",
            "--exclude-standard",
          ]))
        )
      )
        return yield* new CrewError(
          "DELIVERY_CHANGED",
          "Archived/reviewed content changed before delivery",
        );
      if (!e.intent) {
        const issue = yield* this.c.work.show(e.issue_id);
        e.intent = { title: issue.title, description: issue.description };
        yield* this.c.records.save(e);
      }
      const result = yield* this.c.delivery.deliver(p, e);
      e.delivered_commit = result.commit;
      e.pull_request_reference = result.pr;
      yield* this.c.transitions.move(e, "awaiting_merge");
      yield* this.c.transitions.notice(
        e,
        p.delivery === "branch"
          ? "Branch preserved; finish to validate and clean up."
          : "PR ready; request merge approval with abra_work_approve.",
      );
      return p.delivery === "branch" ? yield* this.finish(e, p) : e;
    }.bind(this),
    domainEffect,
  );
  finish = Effect.fn("Finalization.finishInternal")(
    function* (this: Finalization, e: Execution, p: Project, assessment?: DeliveryAssessment) {
      if (externalOwns(e))
        return yield* new CrewError(
          "EXTERNAL_CUSTODY",
          "External branch custody must return before publication or retirement",
        );
      return yield* this.finishOperation(e, p, assessment).pipe(
        Effect.catchIf(
          (error) => error.code === "FORGE_OBSERVATION_FAILED",
          (error) =>
            this.wait(e, {
              category: "retryable",
              code: error.code,
              reason: error.message,
              owner: "forge",
            }),
        ),
      );
    }.bind(this),
    domainEffect,
  );
  wait = Effect.fn("Finalization.waitForDelivery")(
    function* (
      this: Finalization,
      e: Execution,
      result: Extract<OperationResult, { category: "waiting" | "retryable" }>,
    ) {
      if (!e.delivered_commit)
        return yield* new CrewError(
          "DELIVERY_REQUIRED",
          "Cannot wait without exact delivery identity",
        );
      const now = yield* Clock.currentTimeMillis;
      const attempts =
        e.delivery_wait?.code === result.code ? Math.min(e.delivery_wait.attempts + 1, 8) : 1;
      e.delivery_wait = {
        ...result,
        fingerprint: e.delivered_commit,
        attempts,
        observed_at: now,
        next_check_at: now + Math.min(300_000, 30_000 * 2 ** (attempts - 1)),
      };
      delete e.error_or_recovery_reason;
      return yield* this.c.records.save(e);
    }.bind(this),
    domainEffect,
  );
  private finishOperation = Effect.fn("Finalization.finishOperation")(
    function* (this: Finalization, e: Execution, p: Project, assessment?: DeliveryAssessment) {
      if (externalOwns(e))
        return yield* new CrewError(
          "EXTERNAL_CUSTODY",
          "External branch custody must return before publication or retirement",
        );
      if (e.current_phase === "completed") return e;
      const evidence = yield* deliveredEvidence(e);
      if (yield* this.c.obligations.recheck(e)) return e;
      if (!["awaiting_merge", "cleaning"].includes(e.current_phase))
        return yield* new CrewError("DELIVERY_REQUIRED", "Issue has not reached delivery/cleanup");
      yield* this.c.sessions.idle(e);
      if (e.current_phase === "awaiting_merge") {
        yield* this.c.git.validate(p, e);
        if (
          !(
            (yield* this.c.git.head(evidence.worktree_directory)) === e.delivered_commit &&
            !(yield* this.c.git.dirty(evidence.worktree_directory))
          )
        )
          return yield* new CrewError("DELIVERY_CHANGED", "Delivered worktree changed");
        if (p.delivery === "github-pr") {
          const pr = yield* this.c.delivery.inspect(p, e);
          if (pr?.state !== "MERGED") {
            if (e.merge_approval_required !== false) {
              if (
                !e.approval_receipts.some(
                  (a) =>
                    a.kind === "merge" && a.fingerprint === e.delivered_commit && a.authorized_at,
                )
              )
                return yield* new CrewError(
                  "MERGE_APPROVAL",
                  "Human authorization is required before merge",
                );
            }
            const clearance = yield* this.c.feedback.clearance(e, p, pr, assessment);
            if (clearance.blocker) return yield* this.wait(e, clearance.blocker);
            const result = yield* this.c.delivery.merge(p, e, clearance.assessment);
            if (result.category === "waiting" || result.category === "retryable")
              return yield* this.wait(e, result);
            if (
              result.category === "verification" &&
              ["CI_FAILED", "CI_CANCELLED", "REVIEW_FAILED"].includes(result.code)
            )
              e.delivery_block = result.code as "CI_FAILED" | "CI_CANCELLED" | "REVIEW_FAILED";
            if (result.category === "verification" || result.category === "recovery")
              return yield* this.c.transitions.fail(
                e,
                new CrewError(result.code, result.reason),
                result.category === "verification" ? "blocked" : "recovery_required",
              );
          }
        }
        e.delivery_receipt = yield* this.c.delivery.evidence(p, e);
        delete e.delivery_wait;
        yield* this.c.transitions.move(e, "cleaning");
      }
      return yield* this.cleanup(e, p);
    }.bind(this),
    domainEffect,
  );
  cleanup = Effect.fn("Finalization.cleanup")(
    function* (this: Finalization, e: Execution, p: Project) {
      if (externalOwns(e))
        return yield* new CrewError(
          "EXTERNAL_CUSTODY",
          "External branch custody must return before publication or retirement",
        );
      yield* progress({ stage: "cleanup", status: "started" });
      const evidence = yield* provisionedEvidence(e);
      if (!(e.workflow_policy === "research-only" ? e.report_receipt : e.delivery_receipt))
        return yield* new CrewError("DELIVERY_REQUIRED", "No verified preservation receipt");
      yield* this.c.sessions.idle(e);
      if (e.workflow_policy === "research-only") yield* this.c.reports.verify(e);
      if (
        e.workflow_policy !== "research-only" &&
        (yield* pathExists(evidence.worktree_directory))
      ) {
        e.delivery_receipt = yield* this.c.delivery.evidence(p, e);
        yield* this.c.records.save(e);
      }
      yield* this.c.workspaces.retire(p, e, () => this.c.records.save(e));
      yield* this.c.coordination.with(() =>
        domainEffect(
          Effect.gen({ self: this }, function* () {
            yield* this.c.records.save(e);
            const issue = yield* this.c.work.show(e.issue_id);
            if (issue.status !== "closed") {
              if (!(issue.assignee === e.execution_id))
                return yield* new CrewError(
                  "CLAIM_LOST",
                  "Cannot close work claimed by another execution",
                );
              yield* this.c.work.close(e.issue_id, e.execution_id);
            }
            if (!((yield* this.c.work.show(e.issue_id)).status === "closed"))
              return yield* new CrewError("CLOSE_UNKNOWN", "Issue closure did not persist");
            yield* this.c.transitions.move(e, "completed");
          }),
        ),
      );
      yield* this.c.transitions.notice(
        e,
        "Delivery confirmed, worktree retired, issue closed. Dependent work recalculated.",
      );
      return e;
    }.bind(this),
    completedProgress("cleanup"),
  );
}
