import { AbsolutePath, RelativePath } from "../identities.ts";

import { constants } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { Effect } from "effect";
import { CrewError, type Execution } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { open, readdir, realpath } from "../filesystem.ts";

export function within(parent: AbsolutePath, child: AbsolutePath) {
  const path = relative(parent, child);
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}
export const documentLimit = 64 * 1024;
export function readBounded(tree: AbsolutePath, path: AbsolutePath) {
  return Effect.scoped(
    domainEffect(
      Effect.gen(function* () {
        const canonical = yield* realpath(path);
        if (!within(tree, canonical))
          return yield* new CrewError("DOCUMENT_PATH", "Document escapes the owned worktree");
        const file = yield* Effect.acquireRelease(
          open(canonical, constants.O_RDONLY | constants.O_NOFOLLOW),
          (file) =>
            Effect.tryPromise({ try: () => file.close(), catch: CrewError.from }).pipe(
              Effect.orDie,
            ),
        );
        const stat = yield* Effect.tryPromise({ try: () => file.stat(), catch: CrewError.from });
        if (!stat.isFile())
          return yield* new CrewError("DOCUMENT_PATH", "Document is not a regular file");
        const buffer = Buffer.alloc(documentLimit + 1);
        const { bytesRead } = yield* Effect.tryPromise({
          try: () => file.read(buffer, 0, buffer.length, 0),
          catch: CrewError.from,
        });
        return {
          buffer: buffer.subarray(0, Math.min(bytesRead, documentLimit)),
          limited: bytesRead > documentLimit,
        };
      }),
    ),
  );
}
export function changeRoot(e: Execution) {
  return domainEffect(
    Effect.gen(function* () {
      if (!(e.worktree_directory && !e.archive_path && e.current_phase !== "completed"))
        return yield* new CrewError(
          "DOCUMENT_UNAVAILABLE",
          "Planning documents are unavailable after worktree retirement",
        );
      const tree = yield* realpath(e.worktree_directory);
      const root = yield* realpath(resolve(tree, "openspec/changes", e.openspec_change));
      if (!within(tree, root))
        return yield* new CrewError("SPEC_PATH", "Planning change escapes the owned worktree");
      return root;
    }),
  );
}
export function changeDocument(e: Execution, name: RelativePath, label = "Document") {
  return domainEffect(
    Effect.gen(function* () {
      const root = yield* changeRoot(e);
      const path = yield* realpath(resolve(root, name));
      if (!within(root, path))
        return yield* new CrewError("SPEC_PATH", "Document escapes the owned change directory");
      if (!name.endsWith(".md"))
        return yield* new CrewError("SPEC_PATH", "Only Markdown planning documents are available");
      const read = yield* readBounded(root, path);
      return (
        read.buffer.toString("utf8") + (read.limited ? `\n[${label} truncated at 64 KiB]` : "")
      );
    }),
  );
}
export function changeDocuments(e: Execution) {
  return domainEffect(
    Effect.gen(function* () {
      const root = yield* changeRoot(e);
      const paths: RelativePath[] = [];
      const visit = (directory: AbsolutePath, depth: number): Effect.Effect<void, CrewError> =>
        domainEffect(
          Effect.gen(function* () {
            if (depth > 8 || paths.length >= 100) return;
            for (const entry of (yield* readdir(directory, { withFileTypes: true })).sort((a, b) =>
              a.name.localeCompare(b.name),
            )) {
              if (paths.length >= 100) break;
              const path = AbsolutePath.make(resolve(directory, entry.name));
              if (entry.isDirectory()) yield* visit(path, depth + 1);
              else if (entry.isFile() && entry.name.endsWith(".md"))
                paths.push(RelativePath.make(relative(root, path)));
            }
          }),
        );
      yield* visit(root, 0);
      return paths;
    }),
  );
}
