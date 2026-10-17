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
import { synchronizationAuthority } from "./synchronization.ts";
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
  prepare = Effect.fn("Finishing.prepare")(
    function* (this: Finishing, e: Execution, p: Project): Effect.fn.Return<boolean, CrewError> {
      if (e.stop_status || externalOwns(e)) return false;
      yield* this.c.sessions.idle(e);
      let observation = yield* observePublication(this.c.git, this.c.delivery, p, e);
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
        yield* this.c.records.save(e);
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
      const observation = yield* observePreflight(this.c.git, this.c.workspaces, p, e);
      e.finishing = { ...e.finishing, schema_version: 1, preflight: observation };
      yield* this.c.records.save(e);
      if (observation.status !== "ready") {
        yield* this.residue(e, {
          paths: observation.paths,
          truncated: observation.truncated,
          fingerprint: observation.fingerprint!,
        });
        return false;
      }
      // Fresh absence resolves only residue questions. Preserve unrelated obligations.
      e.finishing = { ...e.finishing, current_question: undefined };
      e.decisions = e.decisions?.map((d) =>
        d.generation === e.control_generation &&
        d.status === "open" &&
        d.finishing_target?.kind === "residue"
          ? { ...d, status: "superseded" }
          : d,
      );
      yield* this.c.records.save(e);
      return !(yield* this.c.obligations.recheck(e));
    }.bind(this),
    domainEffect,
  );
}
