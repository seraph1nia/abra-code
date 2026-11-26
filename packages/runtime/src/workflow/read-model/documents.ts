import { WorkflowError } from "../../errors.ts";
import { readFilePrefix } from "../../storage/bounded-read.ts";
import { AbsolutePath, RelativePath } from "@abracode/contracts/identities";

import { constants } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { Effect } from "effect";
import { CrewError, type Execution } from "../../domain.ts";
import { open, readDirectoryEntries, realpath } from "../../filesystem.ts";

export function within(parent: AbsolutePath, child: AbsolutePath) {
  const path = relative(parent, child);
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}
export const documentLimit = 64 * 1024;
export function readBounded(tree: AbsolutePath, path: AbsolutePath) {
  return Effect.scoped(
    Effect.gen(function* () {
      const canonical = yield* realpath(path);
      if (!within(tree, canonical))
        return yield* new WorkflowError("DOCUMENT_PATH", "Document escapes the owned worktree");
      const file = yield* Effect.acquireRelease(
        open(canonical, constants.O_RDONLY | constants.O_NOFOLLOW),
        (file) =>
          Effect.tryPromise({ try: () => file.close(), catch: CrewError.from }).pipe(
            Effect.catch((error) => Effect.logWarning("Resource cleanup failed", error)),
          ),
      );
      const stat = yield* Effect.tryPromise({ try: () => file.stat(), catch: CrewError.from });
      if (!stat.isFile())
        return yield* new WorkflowError("DOCUMENT_PATH", "Document is not a regular file");
      return yield* Effect.tryPromise({
        try: () => readFilePrefix(file, documentLimit),
        catch: CrewError.from,
      });
    }),
  );
}
export function changeRoot(e: Execution) {
  return Effect.gen(function* () {
    if (!e.worktree_directory || e.archive_path || e.current_phase === "completed")
      return yield* new WorkflowError(
        "DOCUMENT_UNAVAILABLE",
        "Planning documents are unavailable after worktree retirement",
      );
    const tree = yield* realpath(e.worktree_directory);
    const root = yield* realpath(resolve(tree, "openspec/changes", e.openspec_change));
    if (!within(tree, root))
      return yield* new WorkflowError("SPEC_PATH", "Planning change escapes the owned worktree");
    return root;
  });
}
export function changeDocument(e: Execution, name: RelativePath, label = "Document") {
  return Effect.gen(function* () {
    const root = yield* changeRoot(e);
    const path = yield* realpath(resolve(root, name));
    if (!within(root, path))
      return yield* new WorkflowError("SPEC_PATH", "Document escapes the owned change directory");
    if (!name.endsWith(".md"))
      return yield* new WorkflowError(
        "SPEC_PATH",
        "Only Markdown planning documents are available",
      );
    const read = yield* readBounded(root, path);
    return read.buffer.toString("utf8") + (read.limited ? `\n[${label} truncated at 64 KiB]` : "");
  });
}
export function changeDocuments(e: Execution) {
  return Effect.gen(function* () {
    const root = yield* changeRoot(e);
    const paths: RelativePath[] = [];
    const visit = (directory: AbsolutePath, depth: number): Effect.Effect<void, CrewError> =>
      Effect.gen(function* () {
        if (depth > 8 || paths.length >= 100) return;
        for (const entry of (yield* readDirectoryEntries(directory)).toSorted((a, b) =>
          a.name.localeCompare(b.name),
        )) {
          if (paths.length >= 100) break;
          const path = AbsolutePath.make(resolve(directory, entry.name));
          if (entry.type === "Directory") yield* visit(path, depth + 1);
          else if (entry.type === "File" && entry.name.endsWith(".md"))
            paths.push(RelativePath.make(relative(root, path)));
        }
      });
    yield* visit(root, 0);
    return paths;
  });
}
