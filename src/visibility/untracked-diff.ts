import { AbsolutePath, RelativePath, Commit } from "../identities.ts";
import { formatPatch, structuredPatch } from "diff";
import { Effect } from "effect";
import { resolve } from "node:path";
import { domainEffect } from "../effect.ts";
import { lstat, realpath } from "../filesystem.ts";
import { type Git } from "../git/repository.ts";
import { type WorkDiff } from "./protocol.ts";
import { documentLimit, readBounded, within } from "./documents.ts";

type DiffFile = WorkDiff["files"][number];
/** Merge untracked content into the comparison, including staged deletions recreated locally. */
export const untrackedDiff = Effect.fn("Visibility.untrackedDiff")(function* (
  git: Pick<Git, "run">,
  tree: AbsolutePath,
  base: Commit,
  tracked: DiffFile[],
  names: RelativePath[],
  limit: number,
) {
  const files = new Map(tracked.map((file) => [file.path, file]));
  const patches = new Map<RelativePath, { patch?: string; message?: string }>();
  for (const name of names) {
    const previous = files.get(name);
    if (!previous && files.size >= limit) continue;
    const file: DiffFile = {
      path: name,
      status: previous ? "modified" : "added",
      additions: 0,
      deletions: 0,
      binary: false,
      limited: true,
    };
    files.set(name, file);
    const path = AbsolutePath.make(resolve(tree, name));
    const stat = yield* lstat(path);
    if (!stat.isFile() || !within(tree, yield* realpath(path))) continue;
    const read = yield* readBounded(tree, path).pipe(Effect.result);
    if (read._tag === "Failure" || read.success.limited) continue;
    let before = "";
    if (previous) {
      const object = `${base}:${name}`;
      const size = Number(yield* git.run(tree, ["cat-file", "-s", object]));
      if (size > documentLimit) continue;
      before = yield* git.run(tree, ["cat-file", "blob", object], { trim: false });
    }
    const content = read.success.buffer.toString("utf8");
    if (read.success.buffer.includes(0) || before.includes("\0")) {
      files.set(name, { ...file, limited: false, binary: true });
      continue;
    }
    const patch = structuredPatch(
      previous ? JSON.stringify(`a/${name}`) : "/dev/null",
      JSON.stringify(`b/${name}`),
      before,
      content,
      undefined,
      undefined,
      { context: 3, timeout: 100 },
    );
    if (!patch) continue;
    if (previous && !patch.hunks.length) {
      files.delete(name);
      continue;
    }
    const lines = patch.hunks.flatMap((hunk) => hunk.lines);
    files.set(name, {
      ...file,
      additions: lines.filter((line) => line.startsWith("+")).length,
      deletions: lines.filter((line) => line.startsWith("-")).length,
      limited: false,
    });
    patches.set(
      name,
      patch.hunks.length ? { patch: formatPatch(patch) } : { message: "Empty file added." },
    );
  }
  return { files: [...files.values()], patches };
}, domainEffect);
