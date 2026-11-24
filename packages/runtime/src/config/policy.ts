import { ensure, type Project } from "../domain.ts";
import { CIPolicySchema, PolicySchema } from "@abracode/contracts/primitives";
import {
  QualityProfile,
  AutomationSchema,
  PlanApprovalSource,
} from "@abracode/contracts/config/policy";
export * from "@abracode/contracts/config/policy";
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

/** Resolve existing quality precedence first; a task can only strengthen this gate. */
export function planPolicy(
  project: Parameters<typeof codingPolicy>[0],
  workflow: Parameters<typeof codingPolicy>[1],
  profile?: QualityProfile,
  required?: true,
) {
  ensure(
    required !== true || workflow === "full-openspec",
    "OPENSPEC_WORKFLOW",
    "Human plan requirements require full-openspec work",
  );
  const resolved = codingPolicy(project, workflow, profile);
  const selected = workflow === "research-only" ? undefined : (profile ?? project.quality_profile);
  const source: typeof PlanApprovalSource.Type =
    required === true
      ? "task_requirement"
      : !selected
        ? "repository_policy"
        : project.quality_overrides?.plan_approval !== undefined
          ? "repository_override"
          : profile
            ? "task_quality_profile"
            : "repository_quality_profile";
  return {
    ...resolved,
    plan_approval: required === true || resolved.plan_approval,
    plan_approval_source: source,
  };
}
