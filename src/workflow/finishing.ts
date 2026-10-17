import { Effect } from "effect";
import { CrewError, type Execution, type Project } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { externalOwns } from "../validation/contracts.ts";
import { type Git } from "../git/repository.ts";
import { type Delivery } from "../git/delivery.ts";
import { type Workspaces } from "../git/workspaces.ts";
import { type Records, synchronizeExecution } from "../storage/store.ts";
import { type WorkerSessions } from "./sessions.ts";
import { type Obligations } from "./obligations.ts";
import {
  observePreflight,
  observePublication,
  finishingAction,
  type PublicationObservation,
} from "./finishing-readiness.ts";
import { activeSynchronization, synchronizationAuthority } from "./synchronization.ts";
import { applyDispositions, residueTarget } from "./finishing-disposition.ts";
import { type CleanupSample } from "../git/cleanup.ts";
import { type FinishingTarget } from "./finishing-contracts.ts";
import { timestamp } from "../identities.ts";
import { specVerificationPassed } from "./review-contracts.ts";

interface Dependencies {
  git: Git;
  delivery: Delivery;
  workspaces: Workspaces;
  records: Records;
  sessions: WorkerSessions;
  obligations: Obligations;
  synchronize: (
    e: Execution,
    p: Project,
    observation: PublicationObservation,
  ) => Effect.Effect<Execution, CrewError>;
}

/** Coordinates existing evidence owners within the caller's owned execution operation. */
export class Finishing {
  constructor(private c: Dependencies) {}
  recoverAdmission = Effect.fn("Finishing.recoverAdmission")(
    function* (this: Finishing, e: Execution, p: Project) {
      const attempt = activeSynchronization(e);
      if (
        e.current_phase !== "recovery_required" ||
        e.resume_phase !== "awaiting_merge" ||
        e.stop_status ||
        externalOwns(e) ||
        attempt?.stage !== "admitted" ||
        attempt.plan !== e.plan_fingerprint
      )
        return undefined;
      if (yield* this.c.obligations.recheck(e)) return undefined;
      yield* this.c.sessions.idle(e);
      yield* this.c.workspaces.preflight(p, e).pipe(
        Effect.catchIf(
          (error) => error.code === "DELIVERY_CHANGED",
          () => Effect.void,
        ),
      );
      if ((yield* this.c.git.candidateTree(e.worktree_directory!)) !== attempt.input_tree)
        return undefined;
      const observation = yield* observePublication(this.c.git, this.c.delivery, p, e);
      if (observation.remote !== attempt.published || observation.state === "merged")
        return undefined;
      e.current_phase = "awaiting_merge";
      delete e.error_or_recovery_reason;
      yield* this.c.records.save(e);
      return yield* this.c.synchronize(e, p, observation);
    }.bind(this),
    domainEffect,
  );
  residue = Effect.fn("Finishing.residue")(
    function* (this: Finishing, e: Execution, sample: CleanupSample) {
      const target = yield* residueTarget(this.c.git, e, sample);
      yield* this.c.obligations.openFinishing(
        e,
        target,
        `Handle retained files for ${e.issue_id}: ${JSON.stringify(sample.paths).slice(0, 6500)}${sample.truncated ? " (incomplete sample; further inspection is required)" : ""}. Select exact generated directories for disposal after preservation, include regular files in delivery, preserve items elsewhere, or defer.`,
      );
      synchronizeExecution(e, yield* this.c.obligations.collectPending(e));
      return e;
    }.bind(this),
    domainEffect,
  );
  private decision = Effect.fn("Finishing.decision")(
    function* (
      this: Finishing,
      e: Execution,
      observation: PublicationObservation,
      kind: "adopt" | "additional_attempt" | "follow_on",
      reason: string,
    ) {
      if (!(e.worktree_identity && e.plan_fingerprint))
        return yield* new CrewError(
          "OWNERSHIP",
          "Finishing question requires retained scope and worktree identity",
        );
      const target: FinishingTarget = {
        schema_version: 1,
        generation: e.control_generation,
        kind,
        fingerprint: observation.content,
        head: observation.head,
        published: observation.published,
        worktree: e.worktree_identity,
        plan: e.plan_fingerprint,
      };
      yield* this.c.obligations.openFinishing(e, target, reason);
      synchronizeExecution(e, yield* this.c.obligations.collectPending(e));
      return false;
    }.bind(this),
    domainEffect,
  );
  followOn = Effect.fn("Finishing.followOn")(
    function* (this: Finishing, e: Execution, p: Project) {
      if (
        (yield* this.c.git.head(e.worktree_directory!)) === e.delivered_commit &&
        !(yield* this.c.git.run(e.worktree_directory!, ["diff", "--name-only", "HEAD"]))
      )
        return false;
      const observation = yield* observePublication(this.c.git, this.c.delivery, p, e);
      if (observation.head === observation.published && !observation.dirty) return false;
      // Untracked/ignored notes use the ordinary preservation/disposal form. Tracked
      // edits or new commits cannot be folded into an already preserved delivery.
      if (
        observation.head === observation.published &&
        !(yield* this.c.git.run(e.worktree_directory!, ["diff", "--name-only", "HEAD"]))
      )
        return false;
      yield* this.decision(
        e,
        observation,
        "follow_on",
        "Preserved delivery has additional unpublished work. Preserve these exact edits and arrange a separately authorized follow-on before retirement.",
      );
      return true;
    }.bind(this),
    domainEffect,
  );
  prepare = Effect.fn("Finishing.prepare")(
    function* (this: Finishing, e: Execution, p: Project): Effect.fn.Return<boolean, CrewError> {
      if (e.stop_status || externalOwns(e)) return false;
      yield* this.c.sessions.idle(e);
      let observation = yield* observePublication(this.c.git, this.c.delivery, p, e);
      if (observation.state === "merged")
        yield* this.c.workspaces.preflight(p, e).pipe(
          Effect.catchIf(
            (error) => error.code === "DELIVERY_CHANGED",
            () => Effect.void,
          ),
        );
      if (yield* this.c.obligations.recheck(e)) {
        const pending =
          e.decisions?.filter(
            (d) => d.generation === e.control_generation && d.status === "open",
          ) ?? [];
        const waits = e.waits?.some(
          (w) =>
            w.generation === e.control_generation &&
            ["waiting", "invalid", "expired"].includes(w.status),
        );
        if (
          !waits &&
          pending.length &&
          pending.every((d) => d.finishing_target?.kind === "residue") &&
          !observation.dirty &&
          observation.head === observation.published &&
          observation.state !== "merged"
        )
          return yield* this.preflight(e, p);
        return false;
      }
      if (observation.state !== "merged") {
        const disposition = yield* applyDispositions(this.c.git, this.c.records, e);
        if (disposition.included)
          observation = yield* observePublication(this.c.git, this.c.delivery, p, e);
      }
      if (activeSynchronization(e)?.stage === "admitted") {
        yield* this.c.synchronize(e, p, observation);
        return false;
      }
      const authority = synchronizationAuthority(e, observation);
      const action = finishingAction(e, {
        quiescent: true,
        publication: observation,
        attributable: authority.attributable,
        additional_authorized: !!authority.additional,
      });
      if (action.kind === "unsafe") return yield* new CrewError("FINISHING_UNSAFE", action.reason);
      if (action.kind === "wait") return false;
      if (action.kind === "decision") {
        return yield* this.decision(
          e,
          observation,
          action.reason === "adoption"
            ? "adopt"
            : action.reason === "allowance"
              ? "additional_attempt"
              : "follow_on",
          action.reason === "adoption"
            ? `Assess and revalidate exact existing content ${observation.content} at ${observation.head} within the accepted scope before updating this PR? This authorizes no new coding.`
            : action.reason === "allowance"
              ? `Two automatic synchronization attempts have been consumed. Authorize one additional assessment of exact content ${observation.content}?`
              : action.reason === "remote_drift"
                ? "The remote branch changed independently. Preserve local work and reconcile ownership before continuing; this form grants no push or merge authority."
                : "This PR is already merged and additional unpublished work remains. Preserve it and arrange a separately authorized follow-on; do not push into the merged PR.",
        );
      }
      if (action.kind === "synchronize") {
        yield* this.c.synchronize(e, p, observation);
        return false;
      }
      if (observation.state === "merged") return true;
      const checked = e.verification_receipt;
      const reviewed = e.review_receipt;
      if (
        !(
          checked &&
          reviewed?.passed &&
          checked.fingerprint === reviewed.fingerprint &&
          e.archived_tree &&
          (e.workflow_policy !== "full-openspec" ||
            specVerificationPassed(reviewed.spec_verification))
        )
      )
        return yield* new CrewError(
          "VERIFICATION_REQUIRED",
          "Current publication lacks its verification and independent Review evidence",
        );
      if ((yield* this.c.git.tree(e.worktree_directory!)) !== e.archived_tree)
        return yield* new CrewError(
          "DELIVERY_CHANGED",
          "Publication tree differs from retained reviewed archival output",
        );
      if (!e.finishing?.publication) {
        e.finishing = {
          ...e.finishing,
          schema_version: 1,
          publication: {
            schema_version: 1,
            generation: e.control_generation,
            operation_id: e.operation!.id,
            verification: checked.fingerprint,
            review: reviewed.fingerprint,
            review_session: reviewed.session_id,
            archived_tree: e.archived_tree,
            commit: observation.head,
            pr: e.pull_request_reference,
            at: yield* timestamp,
          },
        };
        yield* this.c.records.saveFinishing(e, ["publication"]);
      } else if (
        e.finishing.publication.commit !== observation.head ||
        e.finishing.publication.archived_tree !== e.archived_tree ||
        e.finishing.publication.verification !== checked.fingerprint ||
        e.finishing.publication.review !== reviewed.fingerprint
      )
        return yield* new CrewError(
          "DELIVERY_CHANGED",
          "Publication binding no longer matches current content evidence",
        );
      return yield* this.preflight(e, p);
    }.bind(this),
    domainEffect,
  );
  preflight = Effect.fn("Finishing.preflight")(
    function* (this: Finishing, e: Execution, p: Project) {
      const inspected =
        e.decisions
          ?.filter(
            (d) =>
              d.generation === e.control_generation &&
              d.status === "open" &&
              d.finishing_target?.kind === "residue",
          )
          .map((d) => d.key) ?? [];
      const observation = yield* observePreflight(this.c.git, this.c.workspaces, p, e);
      const saved = yield* this.c.records.update(e.issue_id, (current) => {
        if (
          current.control_generation !== observation.generation ||
          current.operation?.id !== observation.operation_id
        )
          throw new CrewError("STALE_OPERATION", "Preflight ownership changed");
        if (
          (current.finishing?.authorizations?.at(-1)?.revision ?? 0) !==
          observation.authorization_revision
        )
          throw new CrewError(
            "FINISHING_CHANGED",
            "Cleanup authorization changed during inspection",
          );
        return {
          ...current,
          finishing: { ...current.finishing, schema_version: 1, preflight: observation },
        };
      });
      synchronizeExecution(e, saved);
      if (observation.status !== "ready") {
        yield* this.residue(e, {
          paths: observation.paths,
          truncated: observation.truncated,
          fingerprint: observation.fingerprint!,
        });
        return false;
      }
      // Fresh absence resolves only residue questions. Preserve unrelated obligations.
      yield* this.c.obligations.supersedeResidue(e, inspected);
      return !(yield* this.c.obligations.recheck(e));
    }.bind(this),
    domainEffect,
  );
}
