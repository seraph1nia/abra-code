import { createHash } from "node:crypto";
import { Effect } from "effect";
import { AbsolutePath, Fingerprint, RelativePath } from "../identities.ts";
import { CrewError } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { type Git } from "./repository.ts";
import { type CleanupBlocker } from "./retirement-contracts.ts";

export type CleanupSample = Pick<CleanupBlocker, "paths" | "truncated" | "fingerprint">;

/** Inspect names only. Bounded command failures cannot become a clean inventory. */
export const inspectCleanup = Effect.fn("Cleanup.inspect")(function* (
  git: Git,
  root: AbsolutePath,
  generated: readonly RelativePath[] = [],
) {
  const options = { trim: false, max_output_bytes: 65536 };
  const tracked = yield* git.run(root, ["diff", "--name-only", "-z", "HEAD"], options);
  if (tracked)
    return yield* new CrewError("DELIVERY_CHANGED", "Tracked content changed before retirement");
  const paths: Array<CleanupBlocker["paths"][number]> = [];
  const hash = createHash("sha256");
  let truncated = false;
  for (const category of ["untracked", "ignored"] as const) {
    const raw = yield* git.run(
      root,
      [
        "ls-files",
        "--others",
        "--exclude-standard",
        "--directory",
        "--no-empty-directory",
        "-z",
        ...(category === "ignored" ? ["--ignored"] : []),
        ...(generated.length ? ["--", ".", ...generated.map((p) => `:(exclude,literal)${p}`)] : []),
      ],
      options,
    );
    if (raw && !raw.endsWith("\0"))
      return yield* new CrewError(
        "CLEANUP_INSPECTION",
        "Incomplete path inventory; retain the worktree",
      );
    hash.update(category).update(raw);
    for (const name of raw.split("\0").filter(Boolean)) {
      const directory = name.endsWith("/");
      const path = directory ? name.slice(0, -1) : name;
      if (
        !path ||
        path.startsWith("/") ||
        path.split("/").some((p) => p === ".." || p === "." || !p)
      )
        return yield* new CrewError(
          "CLEANUP_INSPECTION",
          "Invalid worktree-relative path inventory",
        );
      const item = {
        path: RelativePath.make(path),
        kind: directory ? ("directory" as const) : ("file" as const),
        category,
      };
      if (paths.length >= 64 || Buffer.byteLength(JSON.stringify([...paths, item])) > 16384)
        truncated = true;
      else paths.push(item);
    }
  }
  if (!paths.length && !truncated) return undefined;
  return {
    paths,
    truncated,
    fingerprint: Fingerprint.make(hash.digest("hex")),
  } satisfies CleanupSample;
}, domainEffect);
