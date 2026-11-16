import { Schema } from "effect";
import { Count, NonEmpty } from "../primitives.ts";
import {
  AbsolutePath,
  Commit,
  ExecutionId,
  Timestamp,
  ObligationKey,
  FormId,
  Fingerprint,
} from "../identities.ts";
import { CleanupBlockerSchema } from "../git/retirement-contracts.ts";
import { GeneratedPathsSchema } from "../config/paths.ts";
import { CleanupPreflightSchema } from "./finishing-observation.ts";
export const FinishingOutcomeSchema = Schema.Struct({
  consumed: Count,
  automatic_remaining: Count.check(Schema.isLessThanOrEqualTo(2)),
  synchronization: Schema.optional(
    Schema.Struct({
      stage: NonEmpty,
      input: Fingerprint,
      published: Commit,
      intended_commit: Schema.optional(Commit),
    }),
  ),
  preflight: Schema.optional(CleanupPreflightSchema),
  preflight_age_ms: Schema.optional(Count),
  questions: Schema.Array(
    Schema.Struct({
      key: ObligationKey,
      owner: Schema.Literal("user"),
      question: NonEmpty,
      routing: Schema.Literals(["undelivered", "pending", "answered", "deferred", "superseded"]),
      form_id: Schema.optional(FormId),
      age_ms: Count,
      choices: Schema.Array(NonEmpty),
    }),
  ),
});

export const DeliveryOutcomeSchema = Schema.Struct({
  execution_id: ExecutionId,
  generation: Count,
  delivered_commit: Schema.optional(Commit),
  observed_at: Count,
  finishing: Schema.optional(FinishingOutcomeSchema),
  approval: Schema.Struct({
    kind: Schema.Literals(["plan", "merge"]),
    state: Schema.Literals(["recorded", "pending", "rejected", "not_required", "unavailable"]),
    evidence_at: Schema.optional(Timestamp),
  }),
  delivery: Schema.Struct({
    kind: Schema.Literals(["github-pr", "branch", "report"]),
    state: Schema.Literals(["verified", "waiting", "unconfirmed"]),
    evidence_at: Schema.optional(Timestamp),
  }),
  cleanup: Schema.Struct({
    state: Schema.Literals(["retired", "blocked", "in_progress", "not_started", "unavailable"]),
    blocker: Schema.optional(CleanupBlockerSchema),
    worktree: Schema.optional(AbsolutePath),
    generated_paths: GeneratedPathsSchema,
  }),
  closure: Schema.Literals(["open", "closed", "unavailable"]),
  next_action: NonEmpty,
});
export type DeliveryOutcome = typeof DeliveryOutcomeSchema.Type;
