import { GitError } from "../errors.ts";
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
} from "@abracode/contracts/identities";

import { decode } from "../decode.ts";
import { CrewError, type Project, type ManagedExecution } from "../domain.ts";
import { Effect } from "effect";
import { createHash } from "node:crypto";
import {
  realpath,
  access,
  readDirectoryEntries,
  readFile,
  readlink,
  lstat,
  copyFile,
  scopedTemporaryDirectory,
} from "../filesystem.ts";
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
  identity = Effect.fn("Git.identity")({ self: this }, function* (path: AbsolutePath) {
    if (!isAbsolute(path)) return yield* new GitError("PATH", "Repository path must be absolute");
    path = yield* realpath(path);
    const root = yield* realpath(yield* this.run(path, ["rev-parse", "--show-toplevel"]));
    if (path !== root)
      return yield* new GitError("PATH", "Register the checkout root, not a subdirectory");
    const common = yield* realpath(
      resolve(path, yield* this.run(path, ["rev-parse", "--git-common-dir"])),
    );
    const remote = yield* this.run(path, ["remote", "get-url", "origin"]);
    if (!(remote.length > 0) || remote.startsWith("-"))
      return yield* new GitError("REMOTE", "An origin remote is required");
    return { path, git_common_dir: common, remote: GitRemote.make(remote) };
  });
  branch = Effect.fn("Git.branch")(
    { self: this },
    function* (path: AbsolutePath, ref: BranchName | Commit) {
      if (!(ref.length > 0) || ref.startsWith("-"))
        return yield* new GitError("BRANCH", "Invalid target branch");
      yield* this.run(path, ["check-ref-format", "--branch", ref]);
      return yield* this.run(path, ["rev-parse", "--verify", `${ref}^{commit}`]).pipe(
        Effect.flatMap((value) => decode(Commit, value, "Git commit")),
      );
    },
  );
  validate = Effect.fn("Git.validate")(
    { self: this },
    function* (p: Project, e?: ManagedExecution) {
      const current = yield* this.identity(p.path);
      if (current.git_common_dir !== p.git_common_dir || current.remote !== p.remote)
        return yield* new GitError(
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
        if (common !== p.git_common_dir)
          return yield* new GitError("WORKTREE_IDENTITY", "Worktree belongs to another repository");
        if ((yield* this.run(e.worktree_directory, ["branch", "--show-current"])) !== e.branch)
          return yield* new GitError("WORKTREE_BRANCH", "Owned worktree branch changed");
      }
    },
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
  /** Project current deliverable content into a private index before admitting a mutation. */
  sourceTrees = Effect.fn("Git.sourceTrees")(
    { self: this },
    function* (root: AbsolutePath, include: readonly RelativePath[] = []) {
      const directory = yield* scopedTemporaryDirectory("abracode-index-");
      const index = join(directory, "index");
      const current = resolve(root, yield* this.run(root, ["rev-parse", "--git-path", "index"]));
      yield* copyFile(current, index);
      const run = (args: string[]) =>
        this.runner.run(Executable.make("git"), args, root, {
          GIT_INDEX_FILE: index,
          GIT_OPTIONAL_LOCKS: "0",
        });
      const staged = yield* decode(GitTree, yield* run(["write-tree"]), "Index Git tree");
      yield* run(["add", "--all"]);
      for (const path of include) yield* run(["--literal-pathspecs", "add", "--force", "--", path]);
      const candidate = yield* decode(GitTree, yield* run(["write-tree"]), "Candidate Git tree");
      return { index: staged, candidate };
    },
    Effect.scoped,
  );
  candidateTree(root: AbsolutePath, include: readonly RelativePath[] = []) {
    return this.sourceTrees(root, include).pipe(Effect.map((trees) => trees.candidate));
  }
  /** Retaining refs are journaled by the caller before this idempotent pin. */
  pinTree = Effect.fn("Git.pinTree")(
    { self: this },
    function* (root: AbsolutePath, ref: string, tree: GitTree) {
      yield* this.run(root, ["cat-file", "-e", `${tree}^{tree}`]);
      yield* this.run(root, ["check-ref-format", ref]);
      const prior = yield* this.run(root, ["for-each-ref", "--format=%(objectname)", "--", ref]);
      if (prior && prior !== tree)
        return yield* new GitError(
          "PLANNING_REF",
          "Retained planning ref conflicts with its journal",
        );
      if (!prior) yield* this.run(root, ["update-ref", ref, tree, "0".repeat(tree.length)]);
    },
  );
  assertPinnedTree = Effect.fn("Git.assertPinnedTree")(
    { self: this },
    function* (root: AbsolutePath, ref: string, tree: GitTree) {
      if ((yield* this.run(root, ["show-ref", "--verify", "--hash", ref])) !== tree)
        return yield* new GitError("PLANNING_REF", "Retained planning ref changed");
      yield* this.run(root, ["cat-file", "-e", `${tree}^{tree}`]);
    },
  );
  /** No rename collapsing: both endpoints, modes and index-only changes remain visible. */
  planningDelta = Effect.fn("Git.planningDelta")(
    { self: this },
    function* (root: AbsolutePath, before: GitTree | Commit, after: GitTree, change: ChangeName) {
      const names = (yield* this.run(
        root,
        ["diff", "--no-renames", "--name-only", "-z", before, after, "--"],
        { trim: false },
      ))
        .split("\0")
        .filter(Boolean);
      const prefix = `openspec/changes/${change}/`;
      if (names.some((name) => !name.startsWith(prefix)))
        return yield* new GitError(
          "EXPLORE_SOURCE_EDIT",
          "Explore modified files outside assigned OpenSpec change",
        );
      // Inspect bounded batches of literal pathspecs; deleted entries are absent.
      for (let offset = 0; offset < names.length; offset += 32) {
        const entries = yield* this.run(
          root,
          [
            "--literal-pathspecs",
            "ls-tree",
            "-z",
            after,
            "--",
            ...names.slice(offset, offset + 32),
          ],
          { trim: false },
        );
        if (entries.split("\0").some((entry) => entry && !/^100644 blob [a-f0-9]+\t/.test(entry)))
          return yield* new GitError(
            "SPEC_SYMLINK",
            "Planning artifacts must be nonexecutable regular files",
          );
      }
      const checkedDirs = new Set<string>();
      for (const name of names) {
        const parts = name.split("/");
        let current = root;
        for (const part of parts.slice(0, -1)) {
          current = AbsolutePath.make(join(current, part));
          if (checkedDirs.has(current)) continue;
          const stat = yield* lstat(current);
          if (stat.type !== "Directory")
            return yield* new GitError(
              "SPEC_SYMLINK",
              "Planning artifact ancestor is not a real directory",
            );
          checkedDirs.add(current);
        }
      }
    },
  );
  dirty(path: AbsolutePath) {
    return this.run(path, ["status", "--porcelain=v1", "--untracked-files=all"]);
  }
  fingerprint = (path: AbsolutePath, scope?: RelativePath) =>
    this.fingerprintState(path, scope).pipe(Effect.map((state) => state.fingerprint));
  fingerprintState = Effect.fn("Git.fingerprintState")(
    { self: this },
    function* (path: AbsolutePath, scope?: RelativePath) {
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
      const entries: Array<{ name: string; link?: string }> = [];
      for (const name of untracked.split("\0").filter(Boolean).sort()) {
        const file = join(path, name);
        const stat = yield* lstat(file);
        if (stat.type === "SymbolicLink") entries.push({ name, link: yield* readlink(file) });
        else if (stat.type === "File") entries.push({ name });
        else
          return yield* new GitError(
            "CONTENT_UNAVAILABLE",
            "Special untracked path prevents content observation",
          );
      }
      // Keep Git's attributes/clean filters and object format. Batch only the
      // process boundary; the persisted fingerprint byte order stays unchanged.
      const files = entries.filter((entry) => entry.link === undefined);
      const objects: string[] = [];
      for (let offset = 0; offset < files.length; offset += 64) {
        const batch = files.slice(offset, offset + 64);
        const values = (yield* this.run(path, [
          "hash-object",
          "--",
          ...batch.map((entry) => entry.name),
        ])).split("\n");
        if (
          values.length !== batch.length ||
          values.some((value) => !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(value))
        )
          return yield* new GitError("CONTENT_UNAVAILABLE", "Git object observation is incomplete");
        objects.push(...values);
      }
      let index = 0;
      for (const entry of entries)
        hash
          .update(entry.name)
          .update(entry.link === undefined ? objects[index++]! : `symlink:${entry.link}`);
      return { head, fingerprint: Fingerprint.make(hash.digest("hex")) };
    },
  );
  planFingerprint = Effect.fn("Git.planFingerprint")(
    { self: this },
    function* (path: AbsolutePath, change: ChangeName) {
      // Tasks' checkboxes change during Apply; the approved requirements and design must not.
      const root = AbsolutePath.make(join(path, "openspec/changes", change));
      const hash = createHash("sha256");
      const visit = (dir: AbsolutePath): Effect.Effect<void, CrewError> =>
        Effect.gen({ self: this }, function* () {
          for (const item of (yield* readDirectoryEntries(dir)).toSorted((a, b) =>
            a.name.localeCompare(b.name),
          )) {
            const name = AbsolutePath.make(join(dir, item.name));
            if (item.type === "Directory") yield* visit(name);
            else {
              if (item.type !== "File")
                return yield* new GitError(
                  "SPEC_SYMLINK",
                  "OpenSpec artifacts must be regular files",
                );
              let content = yield* readFile(name, "utf8");
              if (item.name === "tasks.md") content = content.replace(/\[[xX ]\]/g, "[ ]");
              hash.update(name.slice(root.length)).update(content);
            }
          }
        });
      yield* visit(root);
      return Fingerprint.make(hash.digest("hex"));
    },
  );
  assertCommitTree(path: AbsolutePath, commit: Commit, expected: GitTree) {
    return this.run(path, ["rev-parse", "--verify", `${commit}^{tree}`]).pipe(
      Effect.flatMap((tree) =>
        tree === expected
          ? Effect.void
          : Effect.fail(
              new GitError(
                "DELIVERY_CHANGED",
                "Prepared commit differs from the retained reviewed tree",
              ),
            ),
      ),
    );
  }
  commit = Effect.fn("Git.commit")(
    { self: this },
    function* (path: AbsolutePath, issue: IssueId, message?: string) {
      if (yield* this.dirty(path)) {
        yield* this.run(path, ["add", "--all"]);
        yield* this.run(path, [
          "commit",
          "-m",
          message ?? `Implement ${issue} with archived OpenSpec change`,
        ]);
      }
      return yield* this.head(path);
    },
  );
}
