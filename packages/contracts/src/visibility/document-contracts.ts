import { Schema } from "effect";
import { Commit, Fingerprint, Timestamp, RelativePath, SafeRelativePath } from "../identities.ts";
import { FilePatchId } from "../web/resources.ts";
import { Count } from "../primitives.ts";
export const TaskIntentSchema = Schema.Struct({
  goal: Schema.String,
  criteria: Schema.Array(Schema.String),
  results: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({ criterion: Schema.String, met: Schema.Boolean, evidence: Schema.String }),
    ),
  ),
  limitations: Schema.optionalKey(Schema.Array(Schema.String)),
  comparison: Schema.optional(
    Schema.Struct({ previous: Commit, current: Commit, url: Schema.optional(Schema.String) }),
  ),
});
/** The brief is captured at the validated plan checkpoint, before Apply can change tasks. */
export const PlanBriefSchema = Schema.Struct({
  fingerprint: Fingerprint,
  sections: Schema.Array(Schema.Struct({ title: Schema.String, text: Schema.String })),
  previous: Schema.optionalKey(Fingerprint),
  revised: Schema.Boolean,
  changes: Schema.optionalKey(Schema.String),
  significance: Schema.optionalKey(Schema.String),
});
export type PlanBrief = typeof PlanBriefSchema.Type;
export const PlanStepsSchema = Schema.Struct({
  total: Count,
  complete: Count,
  rows: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      label: Schema.String,
      done: Schema.Boolean,
      source: Schema.optional(Schema.Struct({ path: SafeRelativePath, line: Count })),
    }),
  ).check(Schema.isMaxLength(100)),
});
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
