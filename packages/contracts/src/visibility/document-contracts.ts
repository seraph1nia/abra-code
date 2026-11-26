import { Schema } from "effect";
import { Commit, Timestamp, RelativePath } from "../identities.ts";
import { FilePatchId } from "../web/resources.ts";
import { Count } from "../primitives.ts";
export const PlanningObservationSchema = Schema.Struct({
  source: Schema.Literals(["worktree", "archive"]),
  commit: Schema.optional(Commit),
  limited: Schema.Boolean,
});
export const WorkDiffSchema = Schema.Struct({
  base: Schema.optional(Commit),
  head: Schema.optional(Commit),
  at: Timestamp,
  historical: Schema.Boolean,
  files: Schema.Array(
    Schema.Struct({
      patch_id: FilePatchId,
      path: RelativePath,
      status: Schema.Literals(["added", "modified", "deleted"]),
      additions: Count,
      deletions: Count,
      binary: Schema.Boolean,
      limited: Schema.Boolean,
    }),
  ),
  file: Schema.optional(RelativePath),
  patch: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
  limited: Schema.Boolean,
});
export const DiffScopeSchema = Schema.Literals(["all", "uncommitted"]);
export type DiffScope = typeof DiffScopeSchema.Type;
export type WorkDiff = typeof WorkDiffSchema.Type;
