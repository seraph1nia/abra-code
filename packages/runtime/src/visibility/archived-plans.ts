import { Effect } from "effect";
import { CrewError, type Execution, type Project } from "../domain.ts";
import { type AbsolutePath, Commit, RelativePath } from "@abracode/contracts/identities";
import { decode } from "../decode.ts";
import { domainEffect } from "../effect.ts";
import type { Git } from "../git/repository.ts";
import { documentLimit } from "./documents.ts";

/** Decode commit identity at the Git boundary so malformed output becomes a typed failure. */
export const resolveCommit = (
  git: Pick<Git, "run">,
  path: AbsolutePath,
  ref: string,
  source = "Git commit",
) =>
  git
    .run(path, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`])
    .pipe(Effect.flatMap((value) => decode(Commit, value, source)));

/** Read retained blobs, never a replacement working-tree file or a symbolic-link target. */
export const archivedPlans = Effect.fn("Visibility.archivedPlans")(function* (
  git: Pick<Git, "run" | "validate">,
  project: Project | undefined,
  execution: Execution,
) {
  const archive = execution.archive_path;
  if (!archive || !execution.delivered_commit)
    return yield* new CrewError(
      "DOCUMENT_UNAVAILABLE",
      "Archived planning documents have no retained archive and delivered-commit reference.",
    );
  const prefix = "openspec/changes/archive/";
  const name = archive.slice(prefix.length);
  if (
    !archive.startsWith(prefix) ||
    name.includes("/") ||
    !/^\d{4}-\d{2}-\d{2}-/.test(name) ||
    !name.endsWith(`-${execution.openspec_change}`)
  )
    return yield* new CrewError("SPEC_PATH", "Archive does not belong to the retained change.");
  if (!project)
    return yield* new CrewError("DOCUMENT_UNAVAILABLE", "The planning repository is unavailable.");
  yield* git.validate(project);
  const commit = yield* resolveCommit(
    git,
    project.path,
    execution.delivered_commit,
    "Archived planning commit",
  );
  const tree = yield* git.run(
    project.path,
    ["--literal-pathspecs", "ls-tree", "-r", "-z", commit, "--", archive],
    { trim: false, max_output_bytes: 128 * 1024 },
  );
  const entries = tree
    .split("\0")
    .filter(Boolean)
    .flatMap((line) => {
      const match = /^(100644|100755) blob ([a-f0-9]+)\t([\s\S]+)$/.exec(line);
      if (!match || !match[3].startsWith(`${archive}/`)) return [];
      const path = match[3].slice(archive.length + 1);
      if (
        !path.endsWith(".md") ||
        path.split("/").length > 9 ||
        path.split("/").some((part) => !part || part === "." || part === "..")
      )
        return [];
      return [{ path: RelativePath.make(path), object: match[2] }];
    })
    .sort((a, b) => a.path.localeCompare(b.path));
  if (!entries.length)
    return yield* new CrewError(
      "DOCUMENT_UNAVAILABLE",
      "No regular Markdown planning documents exist at the retained archive/commit.",
    );
  const retained = entries.slice(0, 100);
  return {
    paths: retained.map((entry) => entry.path),
    commit,
    limited: entries.length > retained.length,
    read: (path: RelativePath) =>
      domainEffect(
        Effect.gen(function* () {
          const entry = retained.find((entry) => entry.path === path);
          if (!entry)
            return yield* new CrewError(
              "SPEC_PATH",
              "Select a document from the retained archive.",
            );
          const bytes = Number(yield* git.run(project.path, ["cat-file", "-s", entry.object]));
          if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > documentLimit)
            return yield* new CrewError(
              "DOCUMENT_UNAVAILABLE",
              "Archived planning document exceeds the 64 KiB preview limit.",
            );
          return yield* git.run(project.path, ["cat-file", "blob", entry.object], {
            trim: false,
            max_output_bytes: documentLimit,
          });
        }),
      ),
  };
}, domainEffect);
