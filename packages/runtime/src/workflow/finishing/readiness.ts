import { WorkflowError } from "../../errors.ts";
import { Clock, Effect } from "effect";
import { type Commit, type Fingerprint } from "@abracode/contracts/identities";
import { Commit as CommitSchema } from "@abracode/contracts/identities";
import { type ManagedExecution, type Project } from "../../domain.ts";
import { type Git } from "../../git/repository.ts";
import { type Delivery } from "../../git/delivery.ts";
import { type Workspaces } from "../../git/workspaces.ts";
import { decode } from "../../decode.ts";
import { externalOwns } from "@abracode/contracts/validation/contracts";
import { type CleanupPreflightSchema } from "./contracts.ts";

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
      reason: "adoption" | "allowance" | "follow_on" | "remote_drift";
    }
  | { kind: "synchronize"; observation: PublicationObservation }
  | { kind: "preflight" }
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
  return { kind: "preflight" };
}

/** Reads only. In particular, never fetch, stage, commit, push or adopt unknown remote work. */
export const observePublication = Effect.fn("Finishing.observePublication")(function* (
  git: Git,
  delivery: Delivery,
  p: Project,
  e: ManagedExecution,
) {
  if (!(e.worktree_directory && e.delivered_commit))
    return yield* new WorkflowError("DELIVERY_REQUIRED", "Missing retained publication identity");
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
    return yield* new WorkflowError("PR_IDENTITY", "Owned PR identity or state changed");
  if (pr?.state === "MERGED" && pr.headRefOid !== e.delivered_commit)
    return yield* new WorkflowError(
      "PR_HEAD",
      "Merged source head differs from retained publication",
    );
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
  if (rows.length !== 1 || rows[0].split("\t")[1] !== `refs/heads/${e.branch}`)
    return yield* new WorkflowError(
      "PUBLICATION_UNAVAILABLE",
      "Exact published remote branch unavailable",
    );
  const remote = yield* decode(CommitSchema, rows[0].split("\t")[0], "Published remote commit");
  if (pr && pr.headRefOid !== remote)
    return yield* new WorkflowError(
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
    return yield* new WorkflowError(
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
});

/** Reusable evidence owner; callers own the execution lock and persist the returned observation. */
export const observePreflight = Effect.fn("Finishing.observePreflight")(function* (
  git: Git,
  workspaces: Workspaces,
  p: Project,
  e: ManagedExecution,
) {
  if (
    !e.operation ||
    e.operation.generation !== e.control_generation ||
    !e.worktree_directory ||
    !e.worktree_identity ||
    !e.delivered_commit
  )
    return yield* new WorkflowError(
      "OWNERSHIP",
      "Preflight requires current owned operation and publication",
    );
  const head = yield* git.head(e.worktree_directory);
  const content = yield* git.fingerprint(e.worktree_directory);
  if (head !== e.delivered_commit || (yield* git.dirty(e.worktree_directory)))
    return yield* new WorkflowError(
      "DELIVERY_CHANGED",
      "Synchronize deliverable content before cleanup preflight",
    );
  const residue = yield* workspaces.preflight(p, e);
  if (
    head !== (yield* git.head(e.worktree_directory)) ||
    content !== (yield* git.fingerprint(e.worktree_directory))
  )
    return yield* new WorkflowError("DELIVERY_CHANGED", "Content changed during cleanup preflight");
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
});
