import { Effect, Schema } from "effect";
import { CrewError } from "../domain.ts";
import { decodeJSON } from "../decode.ts";
import { AbsolutePath, Commit, Executable, RelativePath } from "@abracode/contracts/identities";
import { Count } from "@abracode/contracts/primitives";
import { type Git } from "./repository.ts";
import { compareChanges } from "./compare-changes.ts";
import { documentLimit } from "../visibility/documents.ts";

const pathEntry = Schema.Struct({ path: RelativePath });
const previewSchema = Schema.Struct({
  schema_version: Schema.Literal("1"),
  reviewable_files: Schema.Array(pathEntry),
  excluded_files: Schema.Array(
    Schema.Struct({ path: RelativePath, exclude_reason: Schema.String }),
  ),
});
const rules = Schema.Array(
  Schema.Struct({ files: Schema.Array(RelativePath), rule: Schema.String }),
);
const ruleSchema = Schema.Struct({ schema_version: Schema.Literal("1"), groups: rules });
const change = Schema.Struct({
  path: RelativePath,
  status: Schema.String,
  patch: Schema.optional(Schema.String),
  excluded: Schema.optional(Schema.String),
  unavailable: Schema.optional(Schema.String),
});
export const ReviewChangesPage = Schema.Struct({
  total: Count,
  offset: Count,
  next_offset: Schema.optional(Count),
  inventory_limited: Schema.Boolean,
  changes: Schema.Array(change),
  rules,
});

/** OCR supplies selection and guidance. Git supplies the net patch against the retained base. */
export const readReviewChanges = Effect.fn("Review.changes")(function* (
  git: Git,
  executable: Executable,
  directory: AbsolutePath,
  base: Commit,
  offset: number,
  selected?: RelativePath,
) {
  const head = yield* git.head(directory);
  const comparison = yield* compareChanges(git, directory, base, head, false);
  const files = selected ? comparison.files.filter((f) => f.path === selected) : comparison.files;
  if (selected && !files.length)
    return yield* new CrewError(
      "REVIEW_PATH",
      "Select a path from the current net change inventory",
    );
  if (offset > files.length)
    return yield* new CrewError("REVIEW_OFFSET", "Review page is outside the current comparison");
  const run = (args: string[]) =>
    git.runner.run(
      executable,
      ["delegate", ...args],
      directory,
      { GIT_OPTIONAL_LOCKS: "0", OCR_NO_UPDATE: "1" },
      { deadline_ms: 30_000, max_output_bytes: 2 * 1024 * 1024 },
    );
  const preview = (refs: string[]) =>
    run(["preview", "--format", "json", ...refs]).pipe(
      Effect.flatMap((raw) => decodeJSON(previewSchema, raw, "OCR delegate preview")),
    );
  const inventories = yield* Effect.all(
    [...(head === base ? [] : [preview(["--from", base, "--to", head])]), preview([])],
    { concurrency: 2 },
  );
  const included = new Set(inventories.flatMap((p) => p.reviewable_files.map((f) => f.path)));
  const excluded = new Map(
    inventories.flatMap((p) => p.excluded_files.map((f) => [f.path, f.exclude_reason] as const)),
  );
  const changes: (typeof change.Type)[] = [];
  let bytes = 0;
  for (const file of files.slice(offset, offset + 32)) {
    // A rename may appear as one OCR entry and two net Git paths. Include unclassified paths.
    const reason = !selected && !included.has(file.path) && excluded.get(file.path);
    if (reason) {
      changes.push({ path: file.path, status: file.status, excluded: reason });
      continue;
    }
    const evidence = yield* comparison.preview(file);
    const size = Buffer.byteLength(evidence.patch ?? "");
    if (size > documentLimit) {
      changes.push({ path: file.path, status: file.status, unavailable: "Patch exceeds 64 KiB." });
      continue;
    }
    if (bytes && bytes + size > documentLimit) break;
    bytes += size;
    changes.push({
      path: file.path,
      status: file.status,
      ...(evidence.patch
        ? { patch: evidence.patch }
        : evidence.message === "Empty file added."
          ? { patch: evidence.message }
          : { unavailable: evidence.message || "Patch unavailable" }),
    });
  }
  const paths = changes.filter((file) => file.patch).map((file) => file.path);
  // Resolve against the final worktree, including pending changes to repository rules.
  const groups = paths.length
    ? (yield* run(["rule", "--format", "json", "--", ...paths]).pipe(
        Effect.flatMap((raw) => decodeJSON(ruleSchema, raw, "OCR delegate rule")),
      )).groups
    : [];
  const grouped = groups.flatMap((group) => group.files);
  if (grouped.length !== paths.length || paths.some((path) => !grouped.includes(path)))
    return yield* new CrewError("REVIEW_RULES", "OCR did not resolve the requested file rules");
  const end = offset + changes.length;
  return {
    total: files.length,
    offset,
    next_offset: end < files.length ? end : undefined,
    inventory_limited: comparison.limited,
    changes,
    rules: groups,
  };
});
