import { WorkflowError } from "../../errors.ts";
import { tryDomainValue } from "../../effect.ts";
import type { CodingChecks } from "../checks.ts";
import type { OpenSpec } from "../../openspec/adapter.ts";
import { Effect } from "effect";
import { CrewError, type Execution, type Project } from "../../domain.ts";
import { externalOwns } from "@abracode/contracts/validation/contracts";
import { type Git } from "../../git/repository.ts";
import { type Delivery } from "../../git/delivery.ts";
import { type Workspaces } from "../../git/workspaces.ts";
import { type Records, removeOwnedField } from "../../storage/store.ts";
import { type WorkerSessions } from "../sessions.ts";
import { type Obligations } from "../obligations.ts";
import {
  observePreflight,
  observePublication,
  finishingAction,
  type PublicationObservation,
} from "./readiness.ts";
import {
  admitSynchronization,
  activeSynchronization,
  synchronizationAuthority,
} from "./synchronization.ts";
import { applyDispositions, residueTarget } from "./residue.ts";
import { type CleanupSample } from "../../git/cleanup.ts";
import { type FinishingTarget } from "./contracts.ts";
import { timestamp } from "@abracode/contracts/identities";
import { specVerificationPassed } from "@abracode/contracts/workflow/review-contracts";
import { assertTransition } from "../transitions.ts";

interface Dependencies {
  git: Git;
  delivery: Delivery;
  workspaces: Workspaces;
  records: Records;
  sessions: WorkerSessions;
  obligations: Obligations;
  checks: CodingChecks;
  spec: OpenSpec;
}

/** Coordinates existing evidence owners within the caller's owned execution operation. */
function publicationDecision(
  reason: "adoption" | "allowance" | "remote_drift" | "follow_on",
  observation: PublicationObservation,
) {
  switch (reason) {
    case "adoption":
      return {
        kind: "adopt",
        reason: `Assess and revalidate exact existing content ${observation.content} at ${observation.head} within the accepted scope before updating this PR? This authorizes no new coding.`,
      } as const;
    case "allowance":
      return {
        kind: "additional_attempt",
        reason: `Two automatic synchronization attempts have been consumed. Authorize one additional assessment of exact content ${observation.content}?`,
      } as const;
    case "remote_drift":
      return {
        kind: "follow_on",
        reason:
          "The remote branch changed independently. Preserve local work and reconcile ownership before continuing; this form grants no push or merge authority.",
      } as const;
    case "follow_on":
      return {
        kind: "follow_on",
        reason:
          "This PR is already merged and additional unpublished work remains. Preserve it and arrange a separately authorized follow-on; do not push into the merged PR.",
      } as const;
  }
}

export class Finishing {
  constructor(private c: Dependencies) {}
  private synchronize = (e: Execution, p: Project, observation: PublicationObservation) =>
    Effect.gen({ self: this }, function* () {
      const next = yield* admitSynchronization(this.c.git, this.c.records, e, observation);
      e = next.execution;
      if (next.stage === "planning") {
        yield* this.c.spec.create(e);
        e = yield* this.c.sessions.launch(e, "explore");
      } else e = yield* this.c.checks.verify(e, p);
      return e;
    });
  recoverAdmission = Effect.fn("Finishing.recoverAdmission")(
    { self: this },
    function* (e: Execution, p: Project) {
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
      const obligations = yield* this.c.obligations.recheck(e);
      e = obligations.execution;
      if (obligations.blocked) return undefined;
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
      yield* tryDomainValue(assertTransition, e, "awaiting_merge");
      const resumed = yield* this.c.records.commitOwned(e, {
        current_phase: "awaiting_merge",
        error_or_recovery_reason: removeOwnedField,
      });
      return yield* this.synchronize(resumed, p, observation);
    },
  );
  residue = Effect.fn("Finishing.residue")(
    { self: this },
    function* (e: Execution, sample: CleanupSample) {
      const target = yield* residueTarget(this.c.git, e, sample);
      const opened = yield* this.c.obligations.openFinishing(
        e,
        target,
        `Handle retained files for ${e.issue_id}: ${JSON.stringify(sample.paths).slice(0, 6500)}${sample.truncated ? " (incomplete sample; further inspection is required)" : ""}. Select exact generated directories for disposal after preservation, include regular files in delivery, preserve items elsewhere, or defer.`,
      );
      e = yield* this.c.obligations.collectPending(opened.execution);
      return e;
    },
  );
  private decision = Effect.fn("Finishing.decision")(
    { self: this },
    function* (
      e: Execution,
      observation: PublicationObservation,
      kind: "adopt" | "additional_attempt" | "follow_on",
      reason: string,
    ) {
      if (!(e.worktree_identity && e.plan_fingerprint))
        return yield* new WorkflowError(
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
      const opened = yield* this.c.obligations.openFinishing(e, target, reason);
      e = yield* this.c.obligations.collectPending(opened.execution);
      return e;
    },
  );
  followOn = Effect.fn("Finishing.followOn")({ self: this }, function* (e: Execution, p: Project) {
    if (
      (yield* this.c.git.head(e.worktree_directory!)) === e.delivered_commit &&
      !(yield* this.c.git.run(e.worktree_directory!, ["diff", "--name-only", "HEAD"]))
    )
      return { execution: e, required: false };
    const observation = yield* observePublication(this.c.git, this.c.delivery, p, e);
    if (observation.head === observation.published && !observation.dirty)
      return { execution: e, required: false };
    // Untracked/ignored notes use the ordinary preservation/disposal form. Tracked
    // edits or new commits cannot be folded into an already preserved delivery.
    if (
      observation.head === observation.published &&
      !(yield* this.c.git.run(e.worktree_directory!, ["diff", "--name-only", "HEAD"]))
    )
      return { execution: e, required: false };
    e = yield* this.decision(
      e,
      observation,
      "follow_on",
      "Preserved delivery has additional unpublished work. Preserve these exact edits and arrange a separately authorized follow-on before retirement.",
    );
    return { execution: e, required: true };
  });
  prepare = Effect.fn("Finishing.prepare")(
    { self: this },
    function* (
      e: Execution,
      p: Project,
    ): Effect.fn.Return<{ execution: Execution; ready: boolean }, CrewError> {
      if (e.stop_status || externalOwns(e)) return { execution: e, ready: false };
      yield* this.c.sessions.idle(e);
      let observation = yield* observePublication(this.c.git, this.c.delivery, p, e);
      if (observation.state === "merged")
        yield* this.c.workspaces.preflight(p, e).pipe(
          Effect.catchIf(
            (error) => error.code === "DELIVERY_CHANGED",
            () => Effect.void,
          ),
        );
      const obligations = yield* this.c.obligations.recheck(e);
      e = obligations.execution;
      if (obligations.blocked) {
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
        return { execution: e, ready: false };
      }
      if (observation.state !== "merged") {
        const disposition = yield* applyDispositions(this.c.git, this.c.records, e);
        e = disposition.execution;
        if (disposition.included)
          observation = yield* observePublication(this.c.git, this.c.delivery, p, e);
      }
      if (activeSynchronization(e)?.stage === "admitted") {
        e = yield* this.synchronize(e, p, observation);
        return { execution: e, ready: false };
      }
      const authority = synchronizationAuthority(e, observation);
      const action = finishingAction(e, {
        quiescent: true,
        publication: observation,
        attributable: authority.attributable,
        additional_authorized: !!authority.additional,
      });
      switch (action.kind) {
        case "unsafe":
          return yield* new WorkflowError("FINISHING_UNSAFE", action.reason);
        case "wait":
          return { execution: e, ready: false };
        case "decision": {
          const decision = publicationDecision(action.reason, observation);
          const execution = yield* this.decision(e, observation, decision.kind, decision.reason);
          return { execution, ready: false };
        }
        case "synchronize":
          return { execution: yield* this.synchronize(e, p, action.observation), ready: false };
        case "finalize":
          return { execution: e, ready: true };
        case "preflight":
          return yield* this.bindAndPreflight(e, p, observation);
      }
    },
  );
  private bindAndPreflight = Effect.fn("Finishing.bindAndPreflight")(
    { self: this },
    function* (e: Execution, p: Project, observation: PublicationObservation) {
      const checked = e.verification_receipt;
      const reviewed = e.review_receipt;
      if (
        !checked ||
        !reviewed?.passed ||
        checked.fingerprint !== reviewed.fingerprint ||
        !e.archived_tree ||
        (e.workflow_policy === "full-openspec" &&
          !specVerificationPassed(reviewed.spec_verification))
      )
        return yield* new WorkflowError(
          "VERIFICATION_REQUIRED",
          "Current publication lacks its verification and independent Review evidence",
        );
      if (
        !e.worktree_directory ||
        (yield* this.c.git.tree(e.worktree_directory)) !== e.archived_tree
      )
        return yield* new WorkflowError(
          "DELIVERY_CHANGED",
          "Publication tree differs from retained reviewed archival output",
        );
      if (!e.finishing?.publication) {
        if (!e.operation)
          return yield* new WorkflowError(
            "STALE_OPERATION",
            "Publication binding requires an owned operation",
          );
        e = {
          ...e,
          finishing: {
            ...e.finishing,
            schema_version: 1,
            publication: {
              schema_version: 1,
              generation: e.control_generation,
              operation_id: e.operation.id,
              verification: checked.fingerprint,
              review: reviewed.fingerprint,
              review_session: reviewed.session_id,
              archived_tree: e.archived_tree,
              commit: observation.head,
              pr: e.pull_request_reference,
              at: yield* timestamp,
            },
          },
        };
        e = yield* this.c.records.saveFinishing(e, ["publication"]);
      } else if (
        e.finishing.publication.commit !== observation.head ||
        e.finishing.publication.archived_tree !== e.archived_tree ||
        e.finishing.publication.verification !== checked.fingerprint ||
        e.finishing.publication.review !== reviewed.fingerprint
      )
        return yield* new WorkflowError(
          "DELIVERY_CHANGED",
          "Publication binding no longer matches current content evidence",
        );
      return yield* this.preflight(e, p);
    },
  );
  preflight = Effect.fn("Finishing.preflight")(
    { self: this },
    function* (e: Execution, p: Project) {
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
          throw new WorkflowError("STALE_OPERATION", "Preflight ownership changed");
        if (
          (current.finishing?.authorizations?.at(-1)?.revision ?? 0) !==
          observation.authorization_revision
        )
          throw new WorkflowError(
            "FINISHING_CHANGED",
            "Cleanup authorization changed during inspection",
          );
        return {
          ...current,
          finishing: { ...current.finishing, schema_version: 1, preflight: observation },
        };
      });
      e = saved;
      if (observation.status !== "ready") {
        e = yield* this.residue(e, {
          paths: observation.paths,
          truncated: observation.truncated,
          fingerprint: observation.fingerprint!,
        });
        return { execution: e, ready: false };
      }
      // Fresh absence resolves only residue questions. Preserve unrelated obligations.
      e = yield* this.c.obligations.supersedeResidue(e, inspected);
      const obligations = yield* this.c.obligations.recheck(e);
      return { execution: obligations.execution, ready: !obligations.blocked };
    },
  );
}
