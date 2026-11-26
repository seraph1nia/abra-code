import { GitError } from "../errors.ts";
import { Effect } from "effect";

import { realpath } from "../filesystem.ts";
import { AbsolutePath, Commit, RelativePath } from "@abracode/contracts/identities";
import { type Git } from "./repository.ts";
import { type WorkDiff } from "../visibility/protocol.ts";
import { documentLimit } from "../workflow/read-model/documents.ts";
import { untrackedDiff } from "../workflow/read-model/untracked-diff.ts";

const fileLimit = 500;
type DiffFile = WorkDiff["files"][number];
/** Observe net changes once and read individual patches from that comparison. */
export const compareChanges = Effect.fn("Git.compareChanges")(function* (
  git: Pick<Git, "run">,
  path: AbsolutePath,
  base: Commit,
  head: Commit,
  historical: boolean,
) {
  const range = historical ? [base, head] : [base];
  const diff = [
    "--literal-pathspecs",
    "diff",
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    "--no-renames",
  ];
  const [stats, names, untracked] = yield* Effect.all(
    [
      git.run(path, [...diff, "--numstat", "-z", ...range, "--"]),
      git.run(path, [...diff, "--name-status", "-z", ...range, "--"]),
      historical
        ? Effect.succeed("")
        : git.run(path, ["ls-files", "--others", "--exclude-standard", "-z"]),
    ],
    { concurrency: "unbounded" },
  );
  const statuses = new Map<RelativePath, DiffFile["status"]>();
  const tokens = names.split("\0");
  for (let i = 0; i + 1 < tokens.length; i += 2)
    statuses.set(
      RelativePath.make(tokens[i + 1]),
      tokens[i] === "A" ? "added" : tokens[i] === "D" ? "deleted" : "modified",
    );
  let files: DiffFile[] = [];
  const records = stats.split("\0").filter(Boolean);
  const extra = untracked
    .split("\0")
    .filter(Boolean)
    .map((path) => RelativePath.make(path));
  for (const record of records.slice(0, fileLimit)) {
    const parsed = /^(-|\d+)\t(-|\d+)\t([\s\S]+)$/.exec(record);
    if (!parsed) return yield* new GitError("DIFF_FORMAT", "Git returned invalid diff statistics");
    files.push({
      path: RelativePath.make(parsed[3]),
      status: statuses.get(RelativePath.make(parsed[3])) ?? "modified",
      additions: Number(parsed[1]) || 0,
      deletions: Number(parsed[2]) || 0,
      binary: parsed[1] === "-",
      limited: false,
    });
  }
  const tree = historical ? undefined : yield* realpath(path);
  const extraDiff = historical
    ? { files, patches: new Map<RelativePath, { patch?: string; message?: string }>() }
    : yield* untrackedDiff(git, tree!, base, files, extra, fileLimit);
  files = extraDiff.files;
  files.sort((a, b) => a.path.localeCompare(b.path));
  const preview = (entry: DiffFile) =>
    Effect.gen(function* () {
      if (entry.binary) return { message: "Binary file changed. A text patch is not available." };
      if (entry.limited)
        return { message: "File is too large or unavailable for safe preview (64 KiB limit)." };
      const fresh = extraDiff.patches.get(entry.path);
      if (fresh) return fresh;
      const patch = yield* git
        .run(path, [...diff, "--unified=3", ...range, "--", entry.path], {
          trim: false,
          max_output_bytes: documentLimit,
        })
        .pipe(Effect.result);
      if (patch._tag === "Failure")
        return { message: "Text preview is unavailable or exceeds 64 KiB." };
      return { patch: patch.success };
    });
  return { files, preview, limited: new Set([...statuses.keys(), ...extra]).size > fileLimit };
});
