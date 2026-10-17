import { Schema } from "effect";
import { Executable, AbsolutePath } from "../identities.ts";
import { CIPolicySchema, Count, PolicySchema } from "../contracts.ts";
import { ensure, type Project } from "../domain.ts";

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
export function profileDefaults(profile: QualityProfile) {
  return {
    ci_policy: profile === "strict" ? ("all-reported" as const) : ("required" as const),
    plan_approval: profile !== "quick",
  };
}
/** Registration without a selection preserves both effective policy and its provenance. */
export function registrationPolicy(
  input: {
    quality_profile?: QualityProfile;
    ci_policy?: typeof CIPolicySchema.Type;
    plan_approval?: boolean;
  },
  previous?: Pick<Project, "quality_profile" | "quality_overrides" | "ci_policy" | "plan_approval">,
) {
  const selected = input.quality_profile ?? previous?.quality_profile;
  const defaults = input.quality_profile ? profileDefaults(input.quality_profile) : undefined;
  const overrides = {
    ...(input.quality_profile ? {} : previous?.quality_overrides),
    ...(input.ci_policy === undefined ? {} : { ci_policy: input.ci_policy }),
    ...(input.plan_approval === undefined ? {} : { plan_approval: input.plan_approval }),
  };
  return {
    ...(selected ? { quality_profile: selected } : {}),
    ...(selected || Object.keys(overrides).length ? { quality_overrides: overrides } : {}),
    ci_policy: input.ci_policy ?? defaults?.ci_policy ?? previous?.ci_policy ?? "all-reported",
    plan_approval:
      input.plan_approval ?? defaults?.plan_approval ?? previous?.plan_approval ?? true,
  };
}
export function codingPolicy(
  project: Pick<Project, "quality_profile" | "quality_overrides" | "ci_policy" | "plan_approval">,
  policy: typeof PolicySchema.Type,
  requested?: QualityProfile,
) {
  ensure(
    policy !== "research-only" || !requested,
    "QUALITY_WORKFLOW",
    "Research cannot select a coding quality profile",
  );
  const profile = policy === "research-only" ? undefined : (requested ?? project.quality_profile);
  ensure(
    !profile || profile !== "strict" || policy === "full-openspec",
    "QUALITY_WORKFLOW",
    "Strict requires full-openspec",
  );
  ensure(
    !profile || profile !== "quick" || policy === "lightweight-fix",
    "QUALITY_WORKFLOW",
    "Quick requires explicitly selected lightweight-fix",
  );
  return profile
    ? {
        ...profileDefaults(profile),
        ...project.quality_overrides,
        quality: {
          profile,
          resolver_version: 1 as const,
          source: requested ? ("task" as const) : ("project" as const),
          overrides: project.quality_overrides ?? {},
        },
      }
    : { ci_policy: project.ci_policy, plan_approval: project.plan_approval };
}
export const AutomationSchema = Schema.Struct(AutomationFields);
export function automation(value: typeof AutomationSchema.Type) {
  return structuredClone({
    publication: value.publication ?? ("ready" as const),
    reviewers: value.reviewers ?? {
      users: [],
      teams: [],
      request: "manual" as const,
      rerequest_after_correction: false,
    },
    discussion: value.discussion ?? {
      replies: "manual" as const,
      resolve_threads: "manual" as const,
    },
    ci_retry: value.ci_retry ?? { max_reruns: 0, workflows: [] },
    validation: value.validation ?? { engine: "native" as const, max_runs: 1 },
  });
}
