import { AbsolutePath } from "../identities.ts";
import { directoryIdentity, sameDirectory, removeGenerated } from "./retirement.ts";
import { domainEffect } from "../effect.ts";
import { CrewError, type ManagedExecution, type Project } from "../domain.ts";
import { Effect } from "effect";
import { pathExists, readdir } from "../filesystem.ts";
import { basename } from "node:path";

import { type Runtime } from "../opencode/runtime.ts";
import { Git } from "./repository.ts";
import { RepositorySources } from "./source.ts";
export class Workspaces {
  constructor(
    private git: Git,
    private sources: RepositorySources,
    private runtime: Runtime,
    private root: AbsolutePath,
  ) {}
  provision = Effect.fn("Workspaces.provision")(
    function* (
      this: Workspaces,
      p: Project,
      e: ManagedExecution,
      save: () => Effect.Effect<unknown, CrewError>,
    ) {
      yield* this.git.validate(p);
      if (!p.project_id)
        return yield* new CrewError("PROJECT_ID", "Repository not discovered by OpenCode");
      if (!e.worktree_directory) {
        const matches = (yield* this.runtime.inventory(p.project_id)).filter(
          (d) => basename(d) === e.execution_id,
        );
        if (!(matches.length <= 1))
          return yield* new CrewError("WORKTREE_AMBIGUOUS", "Multiple worktrees match execution");
        if (matches.length) {
          if (!e.base_commit)
            return yield* new CrewError(
              "BASE_AMBIGUOUS",
              "Native worktree exists without a recorded base",
            );
          e.worktree_directory = matches[0];
        } else {
          const orphans = (yield* readdir(this.root).pipe(
            Effect.catch(() =>
              domainEffect(
                Effect.sync(() => {
                  return [];
                }),
              ),
            ),
          )).filter((n) => n.startsWith(e.execution_id));
          if (orphans.length)
            return yield* new CrewError(
              "WORKTREE_AMBIGUOUS",
              "Possible partially provisioned native worktree; refresh native inventory before recovery",
            );
          if (!e.base_commit) {
            const base = yield* this.sources.base(p, e.execution_id);
            e.base_commit = base.commit;
            e.target_branch = base.target_branch;
            yield* save();
          }
          if (!e.setup && e.workflow_policy === "full-openspec") {
            const inspection = yield* this.sources.inspect(p.path, e.base_commit);
            if (!(inspection.openspec_config !== null))
              return yield* new CrewError(
                "OPENSPEC_SETUP",
                "Fetched base has no OpenSpec configuration; use abra_project_setup",
              );
            if (!p.verification.length)
              return yield* new CrewError(
                "CHECKS_REQUIRED",
                "Select verification commands before starting work",
              );
          }
          e.worktree_directory = yield* this.runtime.createWorktree(p, e, this.root);
        }
        yield* save();
      }
      const actual = yield* this.git.run(e.worktree_directory, ["branch", "--show-current"]);
      if (actual !== e.branch) {
        if (
          !(!e.explore_session_id && (yield* this.git.head(e.worktree_directory)) === e.base_commit)
        )
          return yield* new CrewError(
            "BRANCH_AMBIGUOUS",
            "Unexpected branch/commits during provisioning",
          );
        if (!(actual === ""))
          return yield* new CrewError(
            "BRANCH_AMBIGUOUS",
            "Native provisioning unexpectedly selected a branch",
          );
        yield* this.git.run(e.worktree_directory, ["switch", "-c", e.branch]);
      }
      yield* this.git.validate(p, e);
      const identity = yield* directoryIdentity(e.worktree_directory!);
      if (!(!e.worktree_identity || sameDirectory(e.worktree_identity, identity)))
        return yield* new CrewError("CLEANUP_REPLACEMENT", "Owned worktree directory was replaced");
      if (!e.worktree_identity) {
        e.worktree_identity = identity;
        yield* save();
      }
      return e;
    }.bind(this),
    domainEffect,
  );
  retire = Effect.fn("Workspaces.retire")(
    function* (
      this: Workspaces,
      p: Project,
      e: ManagedExecution,
      save: () => Effect.Effect<unknown, CrewError>,
    ) {
      if (!(e.workflow_policy === "research-only" ? e.report_receipt : e.delivery_receipt))
        return yield* new CrewError("DELIVERY_REQUIRED", "No verified preservation receipt");
      if (!(e.worktree_directory && p.project_id))
        return yield* new CrewError("OWNERSHIP", "Missing owned worktree/project");
      yield* this.git.validate(p);
      const present = yield* pathExists(e.worktree_directory);
      if (present) {
        yield* this.git.validate(p, e);
        if (
          !(
            (yield* this.git.head(e.worktree_directory)) ===
            (e.workflow_policy === "research-only" ? e.base_commit : e.delivered_commit)
          )
        )
          return yield* new CrewError("DELIVERY_CHANGED", "Delivered worktree changed");
        if (!(yield* this.runtime.inventory(p.project_id)).includes(e.worktree_directory))
          return yield* new CrewError("OWNERSHIP", "Worktree missing from native inventory");
        const identity = yield* directoryIdentity(e.worktree_directory);
        if (!(!e.worktree_identity || sameDirectory(e.worktree_identity, identity)))
          return yield* new CrewError(
            "CLEANUP_REPLACEMENT",
            "Owned worktree directory was replaced",
          );
        if (!e.worktree_identity) {
          e.worktree_identity = identity;
          yield* save();
        }
        yield* removeGenerated(this.git, e, save);
        if (yield* this.git.dirty(e.worktree_directory))
          return yield* new CrewError(
            "DIRTY_WORKTREE",
            "Uncommitted/untracked work prevents cleanup",
          );
        if (
          yield* this.git.run(e.worktree_directory, [
            "ls-files",
            "--others",
            "--ignored",
            "--exclude-standard",
          ])
        )
          return yield* new CrewError("IGNORED_WORK", "Unapproved ignored files prevent cleanup");
        if (!sameDirectory(e.worktree_identity, yield* directoryIdentity(e.worktree_directory)))
          return yield* new CrewError(
            "CLEANUP_REPLACEMENT",
            "Owned worktree changed before native removal",
          );
        e.retirement = { generated: e.retirement?.generated ?? [], native: "requested" };
        yield* save();
        yield* this.runtime.removeWorktree(p, e);
      }
      if (yield* pathExists(e.worktree_directory))
        return yield* new CrewError("CLEANUP_PENDING", "Native removal did not retire directory");
      if ((yield* this.runtime.inventory(p.project_id)).includes(e.worktree_directory))
        return yield* new CrewError(
          "CLEANUP_PENDING",
          "Native inventory still retains the directory",
        );
      e.retirement = { generated: e.retirement?.generated ?? [], native: "confirmed" };
      yield* save();
    }.bind(this),
    domainEffect,
  );
}
