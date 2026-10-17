import { AbsolutePath, RelativePath } from "../identities.ts";
import { DirectoryIdentitySchema, RetirementSchema } from "./retirement-contracts.ts";
export { DirectoryIdentitySchema, RetirementSchema } from "./retirement-contracts.ts";
import { Effect } from "effect";
import { isAbsolute, join, relative, resolve } from "node:path";
import { CrewError, type ManagedExecution } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { identityStat, lstat, pathExists, readdir, readlink, realpath, rm } from "../filesystem.ts";
import { GeneratedPathsSchema } from "../config/paths.ts";
import { decode } from "../decode.ts";
import { type Git } from "./repository.ts";
export const directoryIdentity = Effect.fn("directoryIdentity")(function* (path: AbsolutePath) {
  const stat = yield* identityStat(path);
  if (!(stat.isDirectory() && !stat.isSymbolicLink()))
    return yield* new CrewError("CLEANUP_IDENTITY", "Owned path must be a real directory");
  return {
    path: yield* realpath(path),
    device: String(stat.dev),
    inode: String(stat.ino),
    birth: String(stat.birthtimeNs),
  };
}, domainEffect);
export const sameDirectory = (
  a: typeof DirectoryIdentitySchema.Type,
  b: typeof DirectoryIdentitySchema.Type,
) => a.path === b.path && a.device === b.device && a.inode === b.inode && a.birth === b.birth;
const inside = (root: AbsolutePath, path: AbsolutePath) => {
  const part = relative(root, path);
  return part === "" || (part !== ".." && !part.startsWith("../") && !isAbsolute(part));
};
/** Validate without following directory symlinks. Contained dependency symlinks are unlinked by rm. */
export const inspectGenerated = Effect.fn("inspectGenerated")(function* (
  root: AbsolutePath,
  path: RelativePath,
) {
  let entries = 0;
  const walk = (dir: AbsolutePath, depth: number): Effect.Effect<void, CrewError> =>
    domainEffect(
      Effect.gen(function* () {
        if (!(depth <= 128))
          return yield* new CrewError(
            "CLEANUP_BOUND",
            "Generated directory exceeds inspection depth",
          );
        const items = yield* readdir(dir, { withFileTypes: true });
        const names = new Set(items.map((item) => item.name));
        if (
          !(!names.has(".git") && !(names.has("HEAD") && names.has("objects") && names.has("refs")))
        )
          return yield* new CrewError(
            "CLEANUP_REPOSITORY",
            "Nested repository prevents generated-directory cleanup",
          );
        for (const item of items) {
          if (!(++entries <= 200000))
            return yield* new CrewError(
              "CLEANUP_BOUND",
              "Generated directory exceeds inspection limit",
            );
          const child = AbsolutePath.make(join(dir, item.name));
          if (item.isDirectory()) yield* walk(child, depth + 1);
          else if (item.isSymbolicLink()) {
            const target = AbsolutePath.make(resolve(dir, yield* readlink(child)));
            if (!inside(root, target))
              return yield* new CrewError("CLEANUP_SYMLINK", "Generated link escapes the worktree");
            // Resolve all existing ancestors to catch indirect escapes and allow contained broken links.
            let ancestor = target;
            while (!(yield* pathExists(ancestor)))
              ancestor = AbsolutePath.make(resolve(ancestor, ".."));
            if (!inside(root, yield* realpath(ancestor)))
              return yield* new CrewError(
                "CLEANUP_SYMLINK",
                "Generated link resolves outside the worktree",
              );
          } else {
            if (!item.isFile())
              return yield* new CrewError(
                "CLEANUP_SPECIAL",
                "Special file prevents generated-directory cleanup",
              );
          }
        }
      }),
    );
  let cursor = root;
  for (const part of path.split("/")) {
    cursor = AbsolutePath.make(join(cursor, part));
    const stat = yield* lstat(cursor);
    if (!(stat.isDirectory() && !stat.isSymbolicLink()))
      return yield* new CrewError(
        "CLEANUP_SYMLINK",
        "Generated path traverses a link or non-directory",
      );
  }
  yield* walk(cursor, 0);
  return yield* directoryIdentity(cursor);
}, domainEffect);
export const removeGenerated = Effect.fn("removeGenerated")(function* (
  git: Git,
  e: ManagedExecution,
  save: () => Effect.Effect<unknown, CrewError>,
) {
  const root = e.worktree_directory!;
  const paths = yield* decode(
    GeneratedPathsSchema,
    e.effective_policy.generated_paths,
    "retained generated paths",
  );
  e.retirement ??= { generated: [], native: "not_started" };
  for (const path of paths) {
    let entry: (typeof RetirementSchema.Type)["generated"][number] | undefined =
      e.retirement.generated.find((item) => item.path === path);
    if (!(yield* pathExists(join(root, path)))) {
      if (entry && entry.state !== "removed") {
        e.retirement = {
          ...e.retirement,
          generated: e.retirement.generated.map((item) =>
            item.path === path ? { ...item, state: "removed" } : item,
          ),
        };
        yield* save();
      }
      continue;
    }
    if (!(entry?.state !== "removed"))
      return yield* new CrewError(
        "CLEANUP_REPLACEMENT",
        "Previously removed generated directory was replaced",
      );
    const identity = yield* inspectGenerated(root, path);
    if (!(!entry || sameDirectory(entry.identity, identity)))
      return yield* new CrewError("CLEANUP_REPLACEMENT", "Generated directory identity changed");
    const args = ["--", `:(literal)${path}`];
    if (
      !(
        !(yield* git.run(root, ["ls-files", "-z", ...args], { trim: false })) &&
        !(yield* git.run(
          root,
          ["--literal-pathspecs", "ls-tree", "-r", "--name-only", "-z", "HEAD", "--", path],
          { trim: false },
        ))
      )
    )
      return yield* new CrewError(
        "CLEANUP_TRACKED",
        "Tracked descendants prevent generated-directory cleanup",
      );
    if (!entry) {
      entry = { path, identity, state: "authorized" };
      e.retirement = { ...e.retirement, generated: [...e.retirement.generated, entry] };
      yield* save();
    }
    e.retirement = {
      ...e.retirement,
      generated: e.retirement.generated.map((item) =>
        item.path === path ? { ...item, state: "removing" } : item,
      ),
    };
    yield* save();
    const current = yield* inspectGenerated(root, path);
    if (!sameDirectory(identity, current))
      return yield* new CrewError(
        "CLEANUP_REPLACEMENT",
        "Generated directory changed before deletion",
      );
    yield* rm(join(root, path), { recursive: true });
    e.retirement = {
      ...e.retirement,
      generated: e.retirement.generated.map((item) =>
        item.path === path ? { ...item, state: "removed" } : item,
      ),
    };
    yield* save();
  }
}, domainEffect);
