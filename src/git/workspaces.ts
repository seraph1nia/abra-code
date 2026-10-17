import { AbsolutePath } from "../identities.ts";
import {
  directoryIdentity,
  sameDirectory,
  removeGenerated,
  generatedPaths,
  inspectGeneratedPath,
} from "./retirement.ts";
import { domainEffect } from "../effect.ts";
import { CrewError, type ManagedExecution, type Project } from "../domain.ts";
import { Effect } from "effect";
import { pathExists, readdir } from "../filesystem.ts";
import { basename, join } from "node:path";

import { type Runtime } from "../opencode/runtime.ts";
import { Git } from "./repository.ts";
import { RepositorySources } from "./source.ts";
import { inspectCleanup } from "./cleanup.ts";
export class Workspaces {
  constructor(
    private git: Git,
    private sources: RepositorySources,
    private runtime: Runtime,
    private root: AbsolutePath,
  ) {}
  /** No staging, journaling, directory disposal or native removal is allowed here. */
  preflight = Effect.fn("Workspaces.preflight")(
    function* (this: Workspaces, p: Project, e: ManagedExecution) {
      if (!(e.worktree_directory && p.project_id && e.worktree_identity))
        return yield* new CrewError(
          "OWNERSHIP",
          "Cleanup preflight requires retained worktree identity",
        );
      yield* this.git.validate(p, e);
      if (!(yield* this.runtime.inventory(p.project_id)).includes(e.worktree_directory))
        return yield* new CrewError("OWNERSHIP", "Worktree missing from native inventory");
      if (!sameDirectory(e.worktree_identity, yield* directoryIdentity(e.worktree_directory)))
        return yield* new CrewError("CLEANUP_REPLACEMENT", "Owned worktree directory was replaced");
      const paths = yield* generatedPaths(e);
      for (const path of paths)
        if (yield* pathExists(join(e.worktree_directory, path)))
          yield* inspectGeneratedPath(this.git, e, path);
      return yield* inspectCleanup(this.git, e.worktree_directory, paths);
    }.bind(this),
    domainEffect,
  );
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
        if (e.retirement?.native === "requested" || e.retirement?.native === "confirmed")
          return yield* new CrewError(
            "CLEANUP_UNKNOWN",
            "Native removal was submitted but absence is unconfirmed; reconcile the original request before recovery",
          );
        yield* removeGenerated(this.git, e, save);
        const blocker = yield* inspectCleanup(this.git, e.worktree_directory);
        if (blocker) return blocker;
        if (e.cleanup_blocker) {
          delete e.cleanup_blocker;
          e.attention = e.attention?.map((a) =>
            a.code === "cleanup_blocked" ? { ...a, status: "superseded" as const } : a,
          );
          yield* save();
        }
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
