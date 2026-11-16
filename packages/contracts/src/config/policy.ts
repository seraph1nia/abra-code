import { Schema } from "effect";
import { Executable, AbsolutePath } from "../identities.ts";
import { CIPolicySchema, Count } from "../primitives.ts";

export const QualityProfile = Schema.Literals(["strict", "standard", "quick"]);
export type QualityProfile = typeof QualityProfile.Type;
const login = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/));
const workflow = Schema.String.check(
  Schema.isPattern(/^\.github\/workflows\/[A-Za-z0-9._-]+\.ya?ml$/),
);
export const AutomationFields = {
  publication: Schema.optional(Schema.Literals(["ready", "draft-until-verified", "manual-ready"])),
  reviewers: Schema.optional(
    Schema.Struct({
      users: Schema.Array(login),
      teams: Schema.Array(login),
      request: Schema.Literals(["manual", "on-ready"]),
      rerequest_after_correction: Schema.Boolean,
    }),
  ),
  discussion: Schema.optional(
    Schema.Struct({
      replies: Schema.Literals(["manual", "verified"]),
      resolve_threads: Schema.Literals(["manual", "addressed"]),
    }),
  ),
  ci_retry: Schema.optional(
    Schema.Struct({
      max_reruns: Count.check(Schema.isLessThanOrEqualTo(5)),
      workflows: Schema.Array(workflow),
    }),
  ),
  validation: Schema.optional(
    Schema.Struct({
      engine: Schema.Literals(["native", "no-mistakes"]),
      bin: Schema.optional(Executable),
      home: Schema.optional(AbsolutePath),
      max_runs: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(6)),
    }),
  ),
};
export const QualityOverrides = Schema.Struct({
  ci_policy: Schema.optional(CIPolicySchema),
  plan_approval: Schema.optional(Schema.Boolean),
});
export const QualityFields = {
  quality_profile: Schema.optional(QualityProfile),
  quality_overrides: Schema.optional(QualityOverrides),
};
export const QualityReceipt = Schema.Struct({
  profile: QualityProfile,
  resolver_version: Schema.Literal(1),
  source: Schema.Literals(["project", "task"]),
  overrides: QualityOverrides,
});
export const AutomationSchema = Schema.Struct(AutomationFields);
export const PlanApprovalSource = Schema.Literals([
  "task_requirement",
  "repository_policy",
  "repository_override",
  "task_quality_profile",
  "repository_quality_profile",
]);
