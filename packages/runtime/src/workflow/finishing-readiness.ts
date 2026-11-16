import { Clock, Effect } from "effect";
import { type Commit, type Fingerprint } from "../identities.ts";
import { Commit as CommitSchema } from "../identities.ts";
import { type ManagedExecution, type Project, CrewError } from "../domain.ts";
import { type Git } from "../git/repository.ts";
import { type Delivery } from "../git/delivery.ts";
import { type Workspaces } from "../git/workspaces.ts";
import { domainEffect } from "../effect.ts";
import { decode } from "../decode.ts";
import { externalOwns } from "../validation/contracts.ts";
import { sameDirectory } from "../git/retirement.ts";
import { type CleanupPreflightSchema } from "./finishing-contracts.ts";

export type PublicationObservation = {
  head: Commit;
  content: Fingerprint;
  dirty: boolean;
  published: Commit;
  remote: Commit;
  state: "open" | "merged" | "branch";
  descendant: boolean;
};
export type FinishingAction =
  | { kind: "wait"; reason: string }
  | {
      kind: "decision";
      reason: "adoption" | "allowance" | "follow_on" | "remote_drift" | "residue";
    }
  | { kind: "synchronize"; observation: PublicationObservation }
  | { kind: "preflight" }
  | { kind: "await_approval" }
  | { kind: "finalize" }
  | { kind: "unsafe"; reason: string };

/** Pure policy selection. Observations never become mutation authority by being displayed. */
export function finishingAction(
  e: ManagedExecution,
  input: {
    quiescent: boolean;
    publication?: PublicationObservation;
    attributable?: boolean;
    additional_authorized?: boolean;
    preflight_current?: boolean;
  },
): FinishingAction {
  if (e.current_phase === "completed") return { kind: "wait", reason: "Already completed" };
  if (e.stop_status || e.current_phase === "interrupted") return { kind: "wait", reason: "Paused" };
  if (externalOwns(e)) return { kind: "wait", reason: "External branch custody" };
  if (!input.quiescent) return { kind: "wait", reason: "Active or queued writer" };
  if (e.decisions?.some((d) => d.generation === e.control_generation && d.status === "open"))
    return { kind: "wait", reason: "Current decision" };
  if (e.current_phase === "cleaning") return { kind: "finalize" };
  if (e.workflow_policy === "research-only")
    return { kind: "wait", reason: "Report preservation required" };
  const p = input.publication;
  if (!p) return { kind: "unsafe", reason: "Publication inspection unavailable" };
  if (p.remote !== p.published) return { kind: "decision", reason: "remote_drift" };
  const changed = p.head !== p.published || p.dirty;
  if (p.state === "merged")
    return changed ? { kind: "decision", reason: "follow_on" } : { kind: "finalize" };
  if (changed) {
    if (!p.descendant)
      return { kind: "unsafe", reason: "Local history no longer descends from publication" };
    if (!input.attributable) return { kind: "decision", reason: "adoption" };
    if ((e.finishing?.synchronization?.length ?? 0) >= 2 && !input.additional_authorized)
      return { kind: "decision", reason: "allowance" };
    return { kind: "synchronize", observation: p };
  }
  if (!input.preflight_current) return { kind: "preflight" };
  if (e.finishing?.preflight?.status !== "ready") return { kind: "decision", reason: "residue" };
  if (
    p.state !== "branch" &&
    e.merge_approval_required &&
    !e.approval_receipts.some(
      (a) =>
        a.kind === "merge" && a.fingerprint === p.published && a.authorized_at && !a.rejected_at,
    )
  )
    return { kind: "await_approval" };
  return { kind: "finalize" };
}

/** Reads only. In particular, never fetch, stage, commit, push or adopt unknown remote work. */
export const observePublication = Effect.fn("Finishing.observePublication")(function* (
  git: Git,
  delivery: Delivery,
  p: Project,
  e: ManagedExecution,
) {
  if (!(e.worktree_directory && e.delivered_commit))
    return yield* new CrewError("DELIVERY_REQUIRED", "Missing retained publication identity");
  yield* git.validate(p, e);
  // Inspect merged state before selecting a synchronization path.
  const pr = p.delivery === "github-pr" ? yield* delivery.inspect(p, e) : undefined;
  if (
    p.delivery === "github-pr" &&
    !(
      pr &&
      pr.url === e.pull_request_reference &&
      pr.baseRefName === e.target_branch &&
      pr.state !== "CLOSED"
    )
  )
    return yield* new CrewError("PR_IDENTITY", "Owned PR identity or state changed");
  if (pr?.state === "MERGED" && pr.headRefOid !== e.delivered_commit)
    return yield* new CrewError("PR_HEAD", "Merged source head differs from retained publication");
  const raw =
    pr?.state === "MERGED"
      ? `${pr.headRefOid}\trefs/heads/${e.branch}`
      : yield* git.run(e.worktree_directory, [
          "ls-remote",
          "--heads",
          "origin",
          `refs/heads/${e.branch}`,
        ]);
  const rows = raw.split("\n").filter(Boolean);
  if (!(rows.length === 1 && rows[0].split("\t")[1] === `refs/heads/${e.branch}`))
    return yield* new CrewError(
      "PUBLICATION_UNAVAILABLE",
      "Exact published remote branch unavailable",
    );
  const remote = yield* decode(CommitSchema, rows[0].split("\t")[0], "Published remote commit");
  if (pr && pr.headRefOid !== remote)
    return yield* new CrewError(
      "PUBLICATION_UNAVAILABLE",
      "Remote branch and PR observations disagree",
    );
  const head = yield* git.head(e.worktree_directory);
  const content = yield* git.fingerprint(e.worktree_directory);
  const dirty = !!(yield* git.dirty(e.worktree_directory));
  const base = yield* git.run(e.worktree_directory, ["merge-base", e.delivered_commit, head]);
  if (
    head !== (yield* git.head(e.worktree_directory)) ||
    content !== (yield* git.fingerprint(e.worktree_directory))
  )
    return yield* new CrewError(
      "PUBLICATION_UNAVAILABLE",
      "Local content changed during observation",
    );
  return {
    head,
    content,
    dirty,
    published: e.delivered_commit,
    remote,
    state: pr?.state === "MERGED" ? "merged" : pr ? "open" : "branch",
    descendant: base === e.delivered_commit,
  } satisfies PublicationObservation;
}, domainEffect);

/** Reusable evidence owner; callers own the execution lock and persist the returned observation. */
export const observePreflight = Effect.fn("Finishing.observePreflight")(function* (
  git: Git,
  workspaces: Workspaces,
  p: Project,
  e: ManagedExecution,
) {
  if (
    !(
      e.operation &&
      e.operation.generation === e.control_generation &&
      e.worktree_directory &&
      e.worktree_identity &&
      e.delivered_commit
    )
  )
    return yield* new CrewError(
      "OWNERSHIP",
      "Preflight requires current owned operation and publication",
    );
  const head = yield* git.head(e.worktree_directory);
  const content = yield* git.fingerprint(e.worktree_directory);
  if (head !== e.delivered_commit || (yield* git.dirty(e.worktree_directory)))
    return yield* new CrewError(
      "DELIVERY_CHANGED",
      "Synchronize deliverable content before cleanup preflight",
    );
  const residue = yield* workspaces.preflight(p, e);
  if (
    head !== (yield* git.head(e.worktree_directory)) ||
    content !== (yield* git.fingerprint(e.worktree_directory))
  )
    return yield* new CrewError("DELIVERY_CHANGED", "Content changed during cleanup preflight");
  return {
    schema_version: 1,
    generation: e.control_generation,
    operation_id: e.operation.id,
    worktree: e.worktree_identity,
    head,
    content,
    published: e.delivered_commit,
    authorization_revision: e.finishing?.authorizations?.at(-1)?.revision ?? 0,
    observed_at: yield* Clock.currentTimeMillis,
    status: residue ? "blocked" : "ready",
    paths: residue?.paths ?? [],
    truncated: residue?.truncated ?? false,
    fingerprint: residue?.fingerprint,
  } satisfies typeof CleanupPreflightSchema.Type;
}, domainEffect);

/** Binding comparison requires a fresh safety/inventory scan; a cached snapshot is insufficient. */
export function preflightMatches(
  e: ManagedExecution,
  publication: PublicationObservation,
  fresh: typeof CleanupPreflightSchema.Type,
) {
  const f = e.finishing?.preflight;
  return !!(
    f &&
    e.worktree_identity &&
    f.generation === e.control_generation &&
    sameDirectory(f.worktree, e.worktree_identity) &&
    fresh.generation === f.generation &&
    sameDirectory(fresh.worktree, f.worktree) &&
    fresh.status === f.status &&
    fresh.fingerprint === f.fingerprint &&
    fresh.truncated === f.truncated &&
    fresh.head === f.head &&
    fresh.published === f.published &&
    fresh.content === f.content &&
    fresh.authorization_revision === f.authorization_revision &&
    f.head === publication.head &&
    f.published === publication.published &&
    f.content === publication.content &&
    f.authorization_revision === (e.finishing?.authorizations?.at(-1)?.revision ?? 0) &&
    !e.decisions?.some((d) => d.generation === e.control_generation && d.status === "open")
  );
}
