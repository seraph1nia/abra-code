import { Effect } from "effect";
import { ChangeName, timestamp } from "../identities.ts";
import { CrewError, type Execution } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { type Git } from "../git/repository.ts";
import { type Records } from "../storage/store.ts";
import { sameDirectory } from "../git/retirement.ts";
import { type PublicationObservation } from "./finishing-readiness.ts";

export const activeSynchronization = (e: Execution) => {
  const attempt = e.finishing?.synchronization?.at(-1);
  return attempt && !["published", "failed"].includes(attempt.stage) ? attempt : undefined;
};
export function synchronizationAuthority(e: Execution, observation: PublicationObservation) {
  const receipt = (kind: "adopt" | "additional_attempt") =>
    e.decisions?.find((d) => {
      const t = d.finishing_target;
      return (
        d.status === "answered" &&
        d.generation === e.control_generation &&
        d.finishing_answer?.action === "authorize" &&
        !!d.form_id &&
        !!d.form_session &&
        t?.kind === kind &&
        t.fingerprint === observation.content &&
        t.head === observation.head &&
        t.published === observation.published &&
        t.plan === e.plan_fingerprint &&
        !!e.worktree_identity &&
        sameDirectory(t.worktree, e.worktree_identity)
      );
    });
  const attribution = e.finishing?.attribution;
  const attributable =
    attribution?.generation === e.control_generation &&
    attribution.head === observation.head &&
    attribution.fingerprint === observation.content;
  const adoption = receipt("adopt");
  const additional = receipt("additional_attempt");
  return {
    attributable:
      !!attributable ||
      !!adoption ||
      !!e.finishing?.inclusions?.some(
        (i) =>
          i.generation === e.control_generation &&
          i.stage === "staged" &&
          i.source_clean &&
          i.head === observation.head &&
          i.content === observation.content,
      ),
    adoption,
    additional:
      additional &&
      !e.finishing?.synchronization?.some((a) => a.additional_authorization === additional.key)
        ? additional
        : undefined,
  };
}

/** Admission processes already present content. It never admits a new Apply turn. */
export const admitSynchronization = Effect.fn("Synchronization.admit")(function* (
  git: Git,
  records: Records,
  e: Execution,
  observation: PublicationObservation,
) {
  const existing = activeSynchronization(e);
  if (
    !(
      e.operation?.generation === e.control_generation &&
      (e.plan_fingerprint || existing?.plan) &&
      !e.stop_status &&
      e.worktree_directory &&
      e.delivered_commit
    )
  )
    return yield* new CrewError(
      "SYNCHRONIZATION_OWNERSHIP",
      "Current operation, scope and publication required",
    );
  if (
    observation.state === "merged" ||
    observation.remote !== e.delivered_commit ||
    !observation.descendant
  )
    return yield* new CrewError(
      "SYNCHRONIZATION_IDENTITY",
      "Only an unchanged owned open publication can be synchronized",
    );
  if (existing && existing.stage !== "admitted")
    return existing.stage === "planning" ? ("planning" as const) : ("verifying" as const);
  const authority = synchronizationAuthority(e, observation);
  if (!existing && !authority.attributable)
    return yield* new CrewError("SYNCHRONIZATION_ADOPTION", "Exact-content adoption required");
  const ordinal = existing?.ordinal ?? (e.finishing?.synchronization?.length ?? 0) + 1;
  if (!existing && ordinal > 2 && !authority.additional)
    return yield* new CrewError(
      "SYNCHRONIZATION_ALLOWANCE",
      "Two automatic attempts consumed; authorize this exact additional revision",
    );
  if (
    !existing &&
    (observation.head !== (yield* git.head(e.worktree_directory)) ||
      observation.content !== (yield* git.fingerprint(e.worktree_directory)))
  )
    return yield* new CrewError(
      "SYNCHRONIZATION_STALE",
      "Input changed before synchronization admission",
    );
  const revision = e.workflow_policy === "full-openspec" && !!e.archive_path;
  const inputTree = yield* git.candidateTree(e.worktree_directory);
  if (
    !existing &&
    (observation.head !== (yield* git.head(e.worktree_directory)) ||
      observation.content !== (yield* git.fingerprint(e.worktree_directory)))
  )
    return yield* new CrewError("SYNCHRONIZATION_STALE", "Input changed during admission");
  if (existing && inputTree !== existing.input_tree)
    return yield* new CrewError("SYNCHRONIZATION_STALE", "Admitted input changed during recovery");
  const attempt = existing ?? {
    schema_version: 1 as const,
    generation: e.control_generation,
    operation_id: e.operation.id,
    ordinal,
    input: observation.content,
    input_tree: inputTree,
    head: observation.head,
    published: observation.published,
    plan: e.plan_fingerprint!,
    pr: e.pull_request_reference,
    attribution: authority.adoption ? ("native_adoption" as const) : ("authorized_work" as const),
    adoption_key: authority.adoption?.key,
    additional_authorization: authority.additional?.key,
    stage: "admitted" as const,
    admitted_at: yield* timestamp,
    prior_change: e.openspec_change,
    prior_archive: e.archive_path,
    prior_tree: e.archived_tree,
    prior_approvals: structuredClone(e.approval_receipts),
    worker_sessions: (["explore", "apply", "review", "research"] as const).flatMap((role) => {
      const id = e[`${role}_session_id`];
      return id ? [{ id, role }] : [];
    }),
  };
  e.finishing = {
    ...e.finishing,
    schema_version: 1,
    synchronization: existing
      ? e.finishing!.synchronization
      : [...(e.finishing?.synchronization ?? []), attempt],
    preflight: undefined,
    current_question: undefined,
  };
  // Persist the allowance and original input before staging, checks or native admission.
  yield* records.saveFinishing(e, ["synchronization", "preflight", "current_question"]);
  if (e.decisions?.some((d) => d.generation === e.control_generation && d.status === "open"))
    return yield* new CrewError(
      "FINISHING_CHANGED",
      "Resolve the current decision before staging admitted content",
    );
  yield* git.run(e.worktree_directory, ["add", "--all"]);
  const planningBase = yield* git.tree(e.worktree_directory);
  if (planningBase !== attempt.input_tree)
    return yield* new CrewError(
      "SYNCHRONIZATION_STALE",
      "Content changed during synchronization staging",
    );
  e.finishing = {
    ...e.finishing,
    schema_version: 1,
    synchronization: e.finishing.synchronization!.map((a) =>
      a.ordinal === ordinal
        ? { ...a, planning_base_tree: planningBase, stage: revision ? "planning" : "verifying" }
        : a,
    ),
  };
  yield* records.saveFinishing(e, ["synchronization"]);
  delete e.verification_receipt;
  delete e.review_receipt;
  delete e.delivery_receipt;
  delete e.delivery_wait;
  delete e.forge_observation;
  delete e.active_role;
  delete e.capacity_reservation;
  delete e.archived_tree;
  delete e.archive_path;
  // Historical sessions remain managed and cannot gain a new conversational entry point.
  delete e.review_session_id;
  e.retry_instructions = `Synchronize existing content revision ${ordinal}. Assess only the retained work already present; do not implement new fixes or widen accepted scope. Preserve all historical archives. ${revision ? "Prepare a new revision plan describing existing implemented work, with accurate completed tasks. This authorizes planning artifacts only; after approval the controller runs checks and independent Review without Apply." : "Independent Review must confirm existing edits fit the approved scope."}`;
  if (revision) {
    e.openspec_change = ChangeName.make(`${e.openspec_change}-sync${ordinal}`);
    e.planning_base_commit = observation.head;
    delete e.plan_fingerprint;
    delete e.explore_session_id;
    delete e.apply_session_id;
    e.current_phase = "planning";
  } else e.current_phase = "verifying";
  yield* records.save(e);
  return revision ? ("planning" as const) : ("verifying" as const);
}, domainEffect);
