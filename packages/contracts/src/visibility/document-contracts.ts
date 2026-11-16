import { Schema } from "effect";
import { Commit } from "../identities.ts";
export const PlanningObservationSchema = Schema.Struct({
  source: Schema.Literals(["worktree", "archive"]),
  commit: Schema.optional(Commit),
  limited: Schema.Boolean,
});
