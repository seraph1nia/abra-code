import { WorkflowError } from "../../errors.ts";
import { removeOwnedField } from "../../storage/store.ts";
import { type PRFeedback } from "../pr/supervision.ts";
import { externalOwns } from "@abracode/contracts/validation/contracts";
import { progress } from "../../opencode/progress.ts";
import { provisionedEvidence, verifiedEvidence, deliveredEvidence } from "../evidence.ts";
import { Clock, Effect } from "effect";
import { join } from "node:path";
import { access, pathExists } from "../../filesystem.ts";
import { type Execution, type Project } from "../../domain.ts";
import { type Git } from "../../git/repository.ts";
import { type Delivery, type DeliveryAssessment } from "../../git/delivery.ts";
import { type Workspaces } from "../../git/workspaces.ts";
import { type OpenSpec } from "../../openspec/adapter.ts";
import { type Records } from "../../storage/store.ts";
import { type WorkGraph } from "../../work/graph.ts";
import { type Coordination } from "../coordination.ts";
import { type WorkerSessions } from "../sessions.ts";
import { type Reports } from "../../reporting/reports.ts";
import { type Obligations } from "../obligations.ts";
import { type ExecutionTransitions } from "../transitions.ts";
import { type OperationResult } from "../../git/operation-result.ts";
import { specVerificationPassed } from "@abracode/contracts/workflow/review-contracts";
import { type CleanupSample } from "../../git/cleanup.ts";
import { type Finishing } from "./preparation.ts";
import { publicationDestination } from "./contracts.ts";
import { activeSynchronization } from "./synchronization.ts";
import { timestamp } from "@abracode/contracts/identities";
import { SessionMessage } from "@opencode/schema/session-message";
import { applyDispositions } from "./residue.ts";
import { MAX_OUTBOX_ATTEMPTS, nextAttemptCount, nextCheckAt } from "../messaging/outbox.ts";
interface Dependencies {
  finishing: Finishing;
  feedback: PRFeedback;
  operations: import("../operations.ts").Operations;
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
  recoverFinalization = Effect.fn("Finalization.recoverFinalization")(
    { self: this },
    function* (e: Execution, p: Project) {
      if (e.current_phase !== "recovery_required" || e.stop_status || externalOwns(e))
        return undefined;
      const issue = yield* this.c.work.show(e.issue_id);
      if (
        issue.status !== "closed" &&
        (issue.status !== "in_progress" || issue.assignee !== e.execution_id)
      )
        return undefined;
      if (
        e.resume_phase === "awaiting_merge" &&
        e.finishing?.publication?.commit === e.delivered_commit &&
        p.delivery === "github-pr"
      ) {
        const pr = yield* this.c.delivery.inspect(p, e);
        if (
          pr?.state !== "MERGED" ||
          pr.url !== e.pull_request_reference ||
          pr.headRefOid !== e.delivered_commit ||
          pr.baseRefName !== e.target_branch
        )
          return undefined;
        yield* this.c.sessions.idle(e);
        const committed = yield* this.c.transitions.move(e, "awaiting_merge");
        return yield* this.finish(committed, p);
      }
      if (
        e.resume_phase !== "cleaning" ||
        !e.worktree_directory ||
        !(e.workflow_policy === "research-only" ? e.report_receipt : e.delivery_receipt)
      )
        return undefined;
      const native = e.retirement?.native;
      const removing = e.retirement?.generated.filter((entry) => entry.state === "removing") ?? [];
      if (native === "requested" || native === "confirmed") {
        if (yield* pathExists(e.worktree_directory)) return undefined;
      } else if (removing.length) {
        for (const entry of removing)
          if (yield* pathExists(join(e.worktree_directory, entry.path))) return undefined;
      } else return undefined;
      const committed = yield* this.c.transitions.move(e, "cleaning");
      return yield* this.cleanup(committed, p);
    },
  );
  /** Adopt an observed exact push postcondition; never replay an uncertain push. */
  recoverPublication = Effect.fn("Finalization.recoverPublication")(
    { self: this },
    function* (e: Execution, p: Project) {
      const attempt = activeSynchronization(e);
      const binding = e.finishing?.publication;
      if (
        e.current_phase !== "recovery_required" ||
        e.resume_phase !== "delivering" ||
        e.stop_status ||
        externalOwns(e) ||
        (attempt ? attempt.stage !== "publishing" : !binding) ||
        !e.worktree_directory ||
        !e.archived_tree ||
        !e.review_receipt?.passed
      )
        return undefined;
      const issue = yield* this.c.work.show(e.issue_id);
      if (issue.status !== "in_progress" || issue.assignee !== e.execution_id) return undefined;
      yield* this.c.sessions.idle(e);
      yield* this.c.git.validate(p, e);
      // Includes native inventory and directory identity, without disposing of residue.
      yield* this.c.workspaces.preflight(p, e);
      if (attempt && !attempt.intended_commit) {
        // The commit intent predates the native Git call; no push was admitted.
        if (
          attempt.publication_tree !== e.archived_tree ||
          (yield* this.c.git.dirty(e.worktree_directory)) ||
          (yield* this.c.git.tree(e.worktree_directory)) !== e.archived_tree
        )
          return undefined;
        yield* this.c.git.run(e.worktree_directory, [
          "merge-base",
          "--is-ancestor",
          attempt.published,
          "HEAD",
        ]);
        const committed = yield* this.c.transitions.move(e, "delivering");
        return yield* this.deliver(committed, p);
      }
      if (
        !binding ||
        (attempt && binding.commit !== attempt.intended_commit) ||
        binding.generation !== e.control_generation ||
        binding.review_session !== e.review_receipt.session_id ||
        binding.archived_tree !== e.archived_tree ||
        binding.verification !== e.verification_receipt?.fingerprint ||
        binding.review !== e.review_receipt.fingerprint
      )
        return undefined;
      const remote = yield* this.c.git.run(e.worktree_directory, [
        "ls-remote",
        "--heads",
        "origin",
        `refs/heads/${e.branch}`,
      ]);
      if (remote !== `${binding.commit}\trefs/heads/${e.branch}`) return undefined;
      if (p.delivery === "github-pr") {
        const pr = yield* this.c.delivery.inspect(p, e);
        const expected = attempt?.pr ?? binding.pr ?? e.pull_request_reference;
        if (
          (expected && pr?.url !== expected) ||
          (pr &&
            (pr.state === "CLOSED" ||
              pr.headRefOid !== binding.commit ||
              pr.baseRefName !== (e.target_branch ?? p.target_branch)))
        )
          return undefined;
      }
      const committed = yield* this.c.transitions.move(e, "delivering");
      return yield* this.deliver(committed, p);
    },
  );
  notifyCompletion = Effect.fn("Finalization.notifyCompletion")(
    { self: this },
    function* (e: Execution) {
      if (e.current_phase !== "completed") return e;
      const now = yield* Clock.currentTimeMillis;
      const old = e.finishing?.completion_notice;
      if (
        old?.status === "delivered" ||
        (old && (old.next_check_at > now || old.attempts >= MAX_OUTBOX_ATTEMPTS))
      )
        return e;
      const notice = old ?? {
        message_id: SessionMessage.ID.create(),
        session_id: e.supervisor_session_id,
        status: "pending" as const,
        attempts: 0,
        next_check_at: now,
      };
      e = {
        ...e,
        finishing: {
          ...e.finishing,
          schema_version: 1,
          current_question: undefined,
          completion_notice: notice,
        },
      };
      e = yield* this.c.records.saveFinishing(e, ["completion_notice", "current_question"]);
      const result = notice.session_id
        ? yield* Effect.result(
            this.c.sessions.notifyCompletion(notice.session_id, notice.message_id, e.issue_id),
          )
        : undefined;
      e = {
        ...e,
        finishing: {
          ...e.finishing,
          schema_version: 1,
          completion_notice: {
            ...notice,
            status: result?._tag === "Success" ? "delivered" : "pending",
            attempts: nextAttemptCount(notice.attempts),
            next_check_at: nextCheckAt(now, notice.attempts + 1),
            reason:
              result?._tag === "Failure"
                ? result.failure.message.slice(0, 8192)
                : !notice.session_id
                  ? "Retained Abra session unavailable"
                  : undefined,
          },
        },
      };
      return yield* this.c.records.saveFinishing(e, ["completion_notice"]);
    },
  );
  archive = Effect.fn("Finalization.archive")({ self: this }, function* (e: Execution, p: Project) {
    if (externalOwns(e))
      return yield* new WorkflowError(
        "EXTERNAL_CUSTODY",
        "External branch custody must return before publication or retirement",
      );
    const evidence = yield* verifiedEvidence(e);
    if (!(e.verification_receipt && e.review_receipt?.passed))
      return yield* new WorkflowError("VERIFICATION_REQUIRED", "Missing successful checks/review");
    if (
      e.workflow_policy === "full-openspec" &&
      !specVerificationPassed(e.review_receipt.spec_verification)
    )
      return yield* new WorkflowError(
        "SPEC_VERIFICATION_REQUIRED",
        "Full-spec archival requires independent specification verification",
      );
    if (
      yield* access(join(evidence.worktree_directory, "openspec/changes", e.openspec_change)).pipe(
        Effect.isSuccess,
      )
    ) {
      if (
        (yield* this.c.git.fingerprint(evidence.worktree_directory)) !==
        e.verification_receipt.fingerprint
      )
        return yield* new WorkflowError("VERIFICATION_STALE", "Content changed before archival");
    }
    if (e.workflow_policy === "lightweight-fix") {
      if (
        (yield* this.c.git.fingerprint(evidence.worktree_directory)) !==
        e.verification_receipt.fingerprint
      )
        return yield* new WorkflowError("VERIFICATION_STALE", "Content changed before delivery");
      yield* this.c.git.run(evidence.worktree_directory, ["add", "--all"]);
      const committed = yield* this.c.transitions.move(e, "delivering", {
        archived_tree: yield* this.c.git.tree(evidence.worktree_directory),
      });
      return yield* this.deliver(committed, p);
    }
    // Archival is idempotently reconciled from actual active/archive directories.
    const archive_path = yield* this.c.spec.archive(e);
    yield* this.c.git.run(evidence.worktree_directory, ["add", "--all"]);
    const archived_tree = yield* this.c.git.tree(evidence.worktree_directory);
    const committed = yield* this.c.transitions.move(e, "delivering", {
      archive_path,
      archived_tree,
    });
    return yield* this.deliver(committed, p);
  });
  deliver = Effect.fn("Finalization.deliver")({ self: this }, function* (e: Execution, p: Project) {
    if (externalOwns(e))
      return yield* new WorkflowError(
        "EXTERNAL_CUSTODY",
        "External branch custody must return before publication or retirement",
      );
    const evidence = yield* verifiedEvidence(e);
    if (
      !(e.workflow_policy === "lightweight-fix" ? e.scope : e.archive_path) ||
      !e.review_receipt?.passed
    )
      return yield* new WorkflowError("ARCHIVE_REQUIRED", "Archive/review evidence missing");
    const prior = e.finishing?.publication;
    const bound =
      prior &&
      prior.generation === e.control_generation &&
      prior.archived_tree === e.archived_tree &&
      prior.verification === e.verification_receipt!.fingerprint &&
      prior.review === e.review_receipt!.fingerprint &&
      prior.review_session === e.review_receipt.session_id
        ? prior
        : undefined;
    if (
      !bound &&
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
      return yield* new WorkflowError(
        "DELIVERY_CHANGED",
        "Archived/reviewed content changed before delivery",
      );
    if (!e.intent) {
      const issue = yield* this.c.work.show(e.issue_id);
      e = { ...e, intent: { title: issue.title, description: issue.description } };
      e = yield* this.c.records.saveOwned(e, ["intent"]);
    }
    const synchronization = activeSynchronization(e);
    if (synchronization && synchronization.stage !== "publishing") {
      e = {
        ...e,
        finishing: {
          ...e.finishing,
          schema_version: 1,
          synchronization: e.finishing!.synchronization!.map((a) =>
            a.ordinal === synchronization.ordinal
              ? { ...a, stage: "publishing", publication_tree: e.archived_tree! }
              : a,
          ),
        },
      };
      e = yield* this.c.records.saveFinishing(e, ["synchronization"]);
    }
    const commit =
      bound?.commit ?? (yield* this.c.git.commit(evidence.worktree_directory, e.issue_id));
    yield* this.c.git.assertCommitTree(evidence.worktree_directory, commit, e.archived_tree!);
    const destination = bound?.destination ?? publicationDestination(e);
    e = {
      ...e,
      finishing: {
        ...e.finishing,
        schema_version: 1,
        preflight: undefined,
        publication: bound
          ? { ...bound, destination }
          : {
              destination,
              schema_version: 1,
              generation: e.control_generation,
              operation_id: e.operation!.id,
              verification: e.verification_receipt!.fingerprint,
              review: e.review_receipt!.fingerprint,
              review_session: e.review_receipt!.session_id,
              archived_tree: e.archived_tree!,
              commit,
              at: yield* timestamp,
            },
        synchronization: e.finishing?.synchronization?.map((a) =>
          a.ordinal === synchronization?.ordinal
            ? { ...a, stage: "publishing", intended_commit: commit }
            : a,
        ),
      },
    };
    e = yield* this.c.records.saveFinishing(e, ["publication", "preflight", "synchronization"]);
    const result = yield* this.c.delivery.deliver(p, e, {
      commit,
      destination: bound?.pr ? { ...destination, pr: bound.pr } : destination,
    });
    if (result.commit !== commit)
      return yield* new WorkflowError(
        "DELIVERY_CHANGED",
        "Published commit differs from retained reviewed publication binding",
      );
    e = yield* this.c.transitions.move(e, "awaiting_merge", (current) => ({
      finishing: {
        ...current.finishing,
        schema_version: 1,
        publication: {
          ...(current.finishing?.publication ?? e.finishing!.publication!),
          pr: result.pr,
        },
        ...(current.finishing?.synchronization && {
          synchronization: current.finishing.synchronization.map((a) =>
            a.ordinal === synchronization?.ordinal ? { ...a, stage: "published" as const } : a,
          ),
        }),
      },
      delivered_commit: result.commit,
      pull_request_reference: result.pr ?? removeOwnedField,
    }));
    yield* this.c.transitions.notice(
      e,
      p.delivery === "branch"
        ? "Branch preserved; finish to validate and clean up."
        : "PR ready; request merge approval with abra_work_approve.",
    );
    return p.delivery === "branch" ? yield* this.finish(e, p) : e;
  });
  finish = Effect.fn("Finalization.finishInternal")(
    { self: this },
    function* (e: Execution, p: Project, assessment?: DeliveryAssessment) {
      if (externalOwns(e))
        return yield* new WorkflowError(
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
        Effect.catchIf(
          (error) =>
            ["FINISHING_CHANGED", "DELIVERY_CHANGED"].includes(error.code) &&
            e.current_phase === "awaiting_merge",
          () =>
            Effect.gen({ self: this }, function* () {
              // The failed guard submitted nothing. Re-evaluate the new revision next poll.
              e = { ...e, delivery_wait: undefined };
              return yield* this.c.records.saveOwned(e, ["delivery_wait"]);
            }),
        ),
      );
    },
  );
  wait = Effect.fn("Finalization.waitForDelivery")(
    { self: this },
    function* (
      e: Execution,
      result: Extract<OperationResult, { category: "waiting" | "retryable" }>,
    ) {
      if (!e.delivered_commit)
        return yield* new WorkflowError(
          "DELIVERY_REQUIRED",
          "Cannot wait without exact delivery identity",
        );
      const now = yield* Clock.currentTimeMillis;
      const attempts =
        e.delivery_wait?.code === result.code ? nextAttemptCount(e.delivery_wait.attempts) : 1;
      e = {
        ...e,
        delivery_wait: {
          ...result,
          fingerprint: e.delivered_commit,
          attempts,
          observed_at: now,
          next_check_at: nextCheckAt(now, attempts),
        },
      };
      e = { ...e, error_or_recovery_reason: undefined };
      return yield* this.c.records.saveOwned(e, ["delivery_wait", "error_or_recovery_reason"]);
    },
  );
  private finishOperation = Effect.fn("Finalization.finishOperation")(
    { self: this },
    function* (e: Execution, p: Project, assessment?: DeliveryAssessment) {
      if (externalOwns(e))
        return yield* new WorkflowError(
          "EXTERNAL_CUSTODY",
          "External branch custody must return before publication or retirement",
        );
      if (e.current_phase === "completed") return e;
      const evidence = yield* deliveredEvidence(e);
      if (!["awaiting_merge", "cleaning"].includes(e.current_phase))
        return yield* new WorkflowError(
          "DELIVERY_REQUIRED",
          "Issue has not reached delivery/cleanup",
        );
      yield* this.c.sessions.idle(e);
      if (e.current_phase === "awaiting_merge") {
        const finishing = yield* this.c.finishing.prepare(e, p);
        e = finishing.execution;
        if (!finishing.ready) return e;
        yield* this.c.git.validate(p, e);
        if (
          (yield* this.c.git.head(evidence.worktree_directory)) !== e.delivered_commit ||
          (yield* this.c.git.dirty(evidence.worktree_directory))
        )
          return yield* new WorkflowError("DELIVERY_CHANGED", "Delivered worktree changed");
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
                return yield* new WorkflowError(
                  "MERGE_APPROVAL",
                  "Human authorization is required before merge",
                );
            }
            const clearance = yield* this.c.feedback.clearance(e, p, pr, assessment);
            e = clearance.execution;
            if (clearance.blocker) return yield* this.wait(e, clearance.blocker);
            const guard = () =>
              Effect.gen({ self: this }, function* () {
                yield* this.c.sessions.idle(e);
                if (e.stop_status || externalOwns(e))
                  return yield* new WorkflowError(
                    "FINISHING_CHANGED",
                    "Finishing ownership changed",
                  );
                const preflight = yield* this.c.finishing.preflight(e, p);
                e = preflight.execution;
                if (!preflight.ready)
                  return yield* new WorkflowError(
                    "FINISHING_CHANGED",
                    "Cleanup readiness changed before merge",
                  );
                const binding = e.finishing?.publication;
                if (
                  !binding ||
                  binding.commit !== e.delivered_commit ||
                  binding.archived_tree !== (yield* this.c.git.tree(e.worktree_directory!))
                )
                  return yield* new WorkflowError(
                    "FINISHING_CHANGED",
                    "Current publication binding is unavailable or changed",
                  );
              });
            yield* guard();
            const result = yield* this.c.delivery.merge(p, e, clearance.assessment, guard);
            if (result.category === "waiting" || result.category === "retryable")
              return yield* this.wait(e, result);
            if (
              result.category === "verification" &&
              ["CI_FAILED", "CI_CANCELLED", "REVIEW_FAILED"].includes(result.code)
            ) {
              e = {
                ...e,
                delivery_block: result.code as "CI_FAILED" | "CI_CANCELLED" | "REVIEW_FAILED",
              };
              e = yield* this.c.records.saveOwned(e, ["delivery_block"]);
            }
            if (result.category === "verification" || result.category === "recovery")
              return yield* this.c.transitions.fail(
                e,
                new WorkflowError(result.code, result.reason),
                result.category === "verification" ? "blocked" : "recovery_required",
              );
          }
        }
        e = yield* this.c.transitions.move(e, "cleaning", {
          delivery_receipt: yield* this.c.delivery.evidence(p, e),
          delivery_wait: removeOwnedField,
        });
      }
      return yield* this.cleanup(e, p);
    },
  );
  private blockCleanup = Effect.fn("Finalization.blockCleanup")(
    { self: this },
    function* (e: Execution, blocker: CleanupSample) {
      const now = yield* Clock.currentTimeMillis;
      const preservation =
        e.workflow_policy === "research-only" ? e.report_receipt!.hash : e.delivered_commit!;
      const previous = e.cleanup_blocker;
      const same =
        previous?.fingerprint === blocker.fingerprint &&
        previous.generation === e.control_generation &&
        previous.preservation === preservation;
      const attempts = same ? nextAttemptCount(previous.attempts) : 1;
      e = {
        ...e,
        cleanup_blocker: {
          ...blocker,
          generation: e.control_generation,
          preservation,
          observed_at: now,
          attempts,
          next_check_at: nextCheckAt(now, attempts),
        },
      };
      e = {
        ...e,
        attention: e.attention?.map((a) =>
          a.code === "cleanup_blocked" &&
          a.key !== `cleanup:${e.control_generation}:${preservation}:${blocker.fingerprint}`
            ? { ...a, status: "superseded" as const }
            : a,
        ),
      };
      e = { ...e, error_or_recovery_reason: undefined };
      e = yield* this.c.records.saveOwned(e, [
        "cleanup_blocker",
        "attention",
        "error_or_recovery_reason",
      ]);
      return yield* this.c.finishing.residue(e, blocker);
    },
  );
  cleanup = Effect.fn("Finalization.cleanup")({ self: this }, function* (e: Execution, p: Project) {
    if (externalOwns(e))
      return yield* new WorkflowError(
        "EXTERNAL_CUSTODY",
        "External branch custody must return before publication or retirement",
      );
    yield* progress({ stage: "cleanup", status: "started" });
    const evidence = yield* provisionedEvidence(e);
    if (!(e.workflow_policy === "research-only" ? e.report_receipt : e.delivery_receipt))
      return yield* new WorkflowError("DELIVERY_REQUIRED", "No verified preservation receipt");
    yield* this.c.sessions.idle(e);
    if (yield* pathExists(evidence.worktree_directory)) {
      if (e.workflow_policy !== "research-only") {
        const observation = yield* this.c.finishing.followOn(e, p);
        e = observation.execution;
        if (observation.required) return e;
      }
      e = (yield* applyDispositions(this.c.git, this.c.records, e)).execution;
      if (
        e.decisions?.some(
          (d) =>
            d.generation === e.control_generation &&
            d.status === "open" &&
            d.finishing_target?.kind === "residue",
        )
      ) {
        const inspected = e.decisions
          .filter(
            (d) =>
              d.generation === e.control_generation &&
              d.status === "open" &&
              d.finishing_target?.kind === "residue",
          )
          .map((d) => d.key);
        const residue = yield* this.c.workspaces.preflight(p, e);
        if (residue) return yield* this.blockCleanup(e, residue);
        if (!residue) {
          e = yield* this.c.obligations.supersedeResidue(e, inspected);
        }
      }
    }
    const obligations = yield* this.c.obligations.recheck(e);
    e = obligations.execution;
    if (obligations.blocked) return e;
    if (e.workflow_policy === "research-only") e = yield* this.c.reports.verify(e);
    if (e.workflow_policy !== "research-only" && (yield* pathExists(evidence.worktree_directory))) {
      e = { ...e, delivery_receipt: yield* this.c.delivery.evidence(p, e) };
      e = yield* this.c.records.saveOwned(e, ["delivery_receipt"]);
    }
    const retirement = yield* this.c.workspaces.retire(p, e, (candidate, fields) =>
      this.c.records.saveOwned(candidate, fields),
    );
    e = retirement.execution;
    if (retirement.blocker) return yield* this.blockCleanup(e, retirement.blocker);
    yield* this.c.coordination.with(() =>
      Effect.gen({ self: this }, function* () {
        e = yield* this.c.records.commitOwned(e, { pending_issue_status: "closed" });
        e = yield* this.c.operations.reflectIssue(e);
      }),
    );
    e = yield* this.notifyCompletion(e);
    yield* progress({ stage: "cleanup", status: "completed" });
    return e;
  });
}
