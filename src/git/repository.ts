import {
  RelativePath,
  Executable,
  AbsolutePath,
  GitRemote,
  Commit,
  GitTree,
  Fingerprint,
  BranchName,
  ChangeName,
  IssueId,
} from "../identities.ts";

import { decode } from "../decode.ts";
import { domainEffect } from "../effect.ts";
import { CrewError, type Project, type ManagedExecution } from "../domain.ts";
import { Effect } from "effect";
import { createHash } from "node:crypto";
import { realpath, access, readdir, readFile } from "../filesystem.ts";
import { resolve, join, isAbsolute } from "node:path";

import { type Runner, type RunOptions } from "../process.ts";
export class Git {
  constructor(public runner: Runner) {}
  run(cwd: AbsolutePath, args: string[], options?: RunOptions) {
    // Status/fingerprint observers must not refresh the index while delivery writes it.
    // Required locks for add, write-tree and commit remain enabled.
    return this.runner.run(
      Executable.make("git"),
      ["-c", "diff.autoRefreshIndex=false", ...args],
      cwd,
      {
        GIT_OPTIONAL_LOCKS: "0",
      },
      options,
    );
  }
  identity = Effect.fn("Git.identity")(
    function* (this: Git, path: AbsolutePath) {
      if (!isAbsolute(path))
        return yield* new CrewError("PATH", "Repository path must be absolute");
      path = yield* realpath(path);
      const root = yield* realpath(yield* this.run(path, ["rev-parse", "--show-toplevel"]));
      if (!(path === root))
        return yield* new CrewError("PATH", "Register the checkout root, not a subdirectory");
      const common = yield* realpath(
        resolve(path, yield* this.run(path, ["rev-parse", "--git-common-dir"])),
      );
      const remote = yield* this.run(path, ["remote", "get-url", "origin"]);
      if (!(remote.length > 0 && !remote.startsWith("-")))
        return yield* new CrewError("REMOTE", "An origin remote is required");
      return { path, git_common_dir: common, remote: GitRemote.make(remote) };
    }.bind(this),
    domainEffect,
  );
  branch = Effect.fn("Git.branch")(
    function* (this: Git, path: AbsolutePath, ref: BranchName | Commit) {
      if (!(ref.length > 0 && !ref.startsWith("-")))
        return yield* new CrewError("BRANCH", "Invalid target branch");
      yield* this.run(path, ["check-ref-format", "--branch", ref]);
      return yield* this.run(path, ["rev-parse", "--verify", `${ref}^{commit}`]).pipe(
        Effect.flatMap((value) => decode(Commit, value, "Git commit")),
      );
    }.bind(this),
    domainEffect,
  );
  validate = Effect.fn("Git.validate")(
    function* (this: Git, p: Project, e?: ManagedExecution) {
      const current = yield* this.identity(p.path);
      if (!(current.git_common_dir === p.git_common_dir && current.remote === p.remote))
        return yield* new CrewError(
          "GIT_IDENTITY",
          "Registered repository identity or origin changed",
        );
      if (e?.worktree_directory) {
        yield* access(e.worktree_directory);
        const common = yield* realpath(
          resolve(
            e.worktree_directory,
            yield* this.run(e.worktree_directory, ["rev-parse", "--git-common-dir"]),
          ),
        );
        if (!(common === p.git_common_dir))
          return yield* new CrewError(
            "WORKTREE_IDENTITY",
            "Worktree belongs to another repository",
          );
        if (!((yield* this.run(e.worktree_directory, ["branch", "--show-current"])) === e.branch))
          return yield* new CrewError("WORKTREE_BRANCH", "Owned worktree branch changed");
      }
    }.bind(this),
    domainEffect,
  );
  head(path: AbsolutePath) {
    return this.run(path, ["rev-parse", "HEAD"]).pipe(
      Effect.flatMap((value) => decode(Commit, value, "Git HEAD")),
    );
  }
  tree(path: AbsolutePath) {
    return this.run(path, ["write-tree"]).pipe(
      Effect.flatMap((value) => decode(GitTree, value, "Git tree")),
    );
  }
  dirty(path: AbsolutePath) {
    return this.run(path, ["status", "--porcelain=v1", "--untracked-files=all"]);
  }
  fingerprint = Effect.fn("Git.fingerprint")(
    function* (this: Git, path: AbsolutePath, scope?: RelativePath) {
      const args = scope ? ["--", scope] : [];
      const [head, tracked, staged, untracked] = yield* Effect.all(
        [
          this.head(path),
          this.run(path, ["diff", "--binary", ...args]),
          this.run(path, ["diff", "--cached", "--binary", ...args]),
          this.run(path, ["ls-files", "--others", "--exclude-standard", "-z", ...args]),
        ],
        { concurrency: "unbounded" },
      );
      const hash = createHash("sha256")
        .update(scope ? "" : head)
        .update(tracked)
        .update(staged);
      for (const name of untracked.split("\0").filter(Boolean).sort())
        hash.update(name).update(yield* this.run(path, ["hash-object", "--", name]));
      return Fingerprint.make(hash.digest("hex"));
    }.bind(this),
    domainEffect,
  );
  planFingerprint = Effect.fn("Git.planFingerprint")(
    function* (this: Git, path: AbsolutePath, change: ChangeName) {
      // Tasks' checkboxes change during Apply; the approved requirements and design must not.
      const root = AbsolutePath.make(join(path, "openspec/changes", change));
      const hash = createHash("sha256");
      const visit = (dir: AbsolutePath): Effect.Effect<void, CrewError> =>
        domainEffect(
          Effect.gen({ self: this }, function* () {
            for (const item of (yield* readdir(dir, { withFileTypes: true })).sort((a, b) =>
              a.name.localeCompare(b.name),
            )) {
              const name = AbsolutePath.make(join(dir, item.name));
              if (item.isDirectory()) yield* visit(name);
              else {
                if (!item.isFile())
                  return yield* new CrewError(
                    "SPEC_SYMLINK",
                    "OpenSpec artifacts must be regular files",
                  );
                let content = yield* readFile(name, "utf8");
                if (item.name === "tasks.md") content = content.replace(/\[[xX ]\]/g, "[ ]");
                hash.update(name.slice(root.length)).update(content);
              }
            }
          }),
        );
      yield* visit(root);
      return Fingerprint.make(hash.digest("hex"));
    }.bind(this),
    domainEffect,
  );
  commit = Effect.fn("Git.commit")(
    function* (this: Git, path: AbsolutePath, issue: IssueId, message?: string) {
      if (yield* this.dirty(path)) {
        yield* this.run(path, ["add", "--all"]);
        yield* this.run(path, [
          "commit",
          "-m",
          message ?? `Implement ${issue} with archived OpenSpec change`,
        ]);
      }
      return yield* this.head(path);
    }.bind(this),
    domainEffect,
  );
}
