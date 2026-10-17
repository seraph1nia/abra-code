import { AbsolutePath, RelativePath, Fingerprint, Commit, ContentHash } from "../identities.ts";
import { Count, Positive } from "../contracts.ts";
import { Schema } from "effect";
export const DirectoryIdentitySchema = Schema.Struct({
  path: AbsolutePath,
  device: Schema.String,
  inode: Schema.String,
  birth: Schema.String,
});
export const RetirementSchema = Schema.Struct({
  generated: Schema.Array(
    Schema.Struct({
      path: RelativePath,
      identity: DirectoryIdentitySchema,
      state: Schema.Literals(["authorized", "removing", "removed"]),
    }),
  ),
  native: Schema.Literals(["not_started", "requested", "confirmed"]),
});

export const CleanupPathSchema = RelativePath.check(
  Schema.makeFilter(
    (path) =>
      (!path.startsWith("/") &&
        !path.includes("\0") &&
        path.split("/").every((p) => p !== ".." && p !== "." && !!p)) ||
      "Expected a worktree-relative path",
  ),
);

// Paths are data, never shell fragments. Keep the entire encoded sample bounded.
export const CleanupPathsSchema = Schema.Array(
  Schema.Struct({
    path: CleanupPathSchema,
    kind: Schema.Literals(["file", "directory"]),
    category: Schema.Literals(["ignored", "untracked"]),
  }),
).check(
  Schema.isMaxLength(64),
  Schema.makeFilter(
    (paths) => Buffer.byteLength(JSON.stringify(paths)) <= 16384 || "Cleanup sample exceeds 16 KiB",
  ),
);
export const CleanupBlockerSchema = Schema.Struct({
  paths: CleanupPathsSchema,
  truncated: Schema.Boolean,
  observed_at: Count,
  generation: Count,
  preservation: Schema.Union([Commit, ContentHash]),
  fingerprint: Fingerprint,
  attempts: Positive.check(Schema.isLessThanOrEqualTo(8)),
  next_check_at: Count,
});
export type CleanupBlocker = typeof CleanupBlockerSchema.Type;
