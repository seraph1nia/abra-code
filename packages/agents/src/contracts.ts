import { Schema } from "effect";
import { Agent as NativeAgent } from "@opencode/schema/agent";
import { Model } from "@opencode/schema/model";
import { Skill } from "@opencode/schema/skill";
import { RoleSchema, PolicySchema } from "@abracode/contracts/primitives";
import { createHash } from "node:crypto";
import { CapabilityRequirementsSchema } from "./capabilities.ts";
import { nativePermissions, leadPermissions, validDenial, legacyReviewProfile } from "./policy.ts";

export const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value !== null && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([key, item]) => [key, canonical(item)]),
        )
      : value;
export const canonicalJson = (value: unknown) => JSON.stringify(canonical(value));
export const AssignmentRole = Schema.Union([
  RoleSchema,
  Schema.Literals(["supervisor", "project-lead"]),
]);
export type AssignmentRole = typeof AssignmentRole.Type;
export const Identity = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{0,63}$/));
export const Fragment = Schema.Struct({
  name: Identity,
  content: Schema.String.check(Schema.isMaxLength(32768)),
});
export type Fragment = typeof Fragment.Type;
export const ContributionDescriptor = Schema.Struct({
  id: Identity,
  revision: Schema.NonEmptyString,
  action: Schema.Literal("read"),
  schema_digest: Schema.NonEmptyString,
});
export const StaticProfile = Schema.Struct({
  version: Schema.Literal(1),
  definition: Identity,
  implementation: Schema.NonEmptyString,
  role: AssignmentRole,
  id: NativeAgent.ID,
  revision: Schema.String,
  description: Schema.NonEmptyString,
  system: Schema.String,
  instruction_sources: Schema.Array(
    Schema.Struct({
      kind: Schema.Literals(["file", "inline"]),
      source: Schema.String,
      digest: Schema.String,
    }),
  ),
  mode: NativeAgent.Info.fields.mode,
  model: Schema.optional(Model.Ref),
  permissions: NativeAgent.Info.fields.permissions,
  skills: Schema.Array(
    Schema.Struct({
      id: Skill.ID,
      preload: Schema.Boolean,
      digest: Schema.String,
      content: Schema.optional(Schema.String),
    }),
  ),
  tools: Schema.Array(Schema.String),
  requirements: CapabilityRequirementsSchema,
  contributions: Schema.Array(ContributionDescriptor),
});
export type StaticProfile = typeof StaticProfile.Type;
// Only task-independent, relocatable content contributes to a shared profile identity.
export const profileRevision = (profile: Omit<StaticProfile, "revision" | "id">) =>
  digest(canonicalJson(profile));
export const validProfile = (profile: StaticProfile) => {
  const { id, revision, ...material } = profile;
  const permissions =
    profile.role === "project-lead" ? leadPermissions() : nativePermissions(profile.role);
  const baseline = legacyReviewProfile(profile)
    ? permissions.filter((p) => p.action !== "abra_review_changes")
    : permissions;
  return (
    profile.permissions.length >= baseline.length &&
    canonicalJson(profile.permissions.slice(0, baseline.length)) === canonicalJson(baseline) &&
    profile.permissions
      .slice(baseline.length)
      .every(
        (rule) => rule.effect === "deny" && rule.resource === "*" && validDenial(rule.action),
      ) &&
    revision === profileRevision(material) &&
    id ===
      (profile.role === "supervisor"
        ? "abra"
        : profile.role === "project-lead"
          ? "project-lead"
          : `abra-${profile.definition}-${revision}`)
  );
};
export const CapturedProfile = StaticProfile.check(
  Schema.makeFilter(
    (p) => validProfile(p) || "Static profile identity does not match captured content",
  ),
);
export const PreparedAgent = Schema.Struct({
  version: Schema.Literal(1),
  profile: CapturedProfile,
  fragments: Schema.Array(Fragment).check(Schema.isMaxLength(32)),
  model: Schema.optional(Model.Ref),
  delivery: Schema.Literals(["native", "external"]),
  native_agent: NativeAgent.ID,
  digest: Schema.String,
}).check(
  Schema.makeFilter(
    (p) =>
      (new Set(p.fragments.map((f) => f.name)).size === p.fragments.length &&
        p.digest === preparedDigest(p)) ||
      "Invalid prepared digest or duplicate context fragment name",
  ),
);
export type PreparedAgent = typeof PreparedAgent.Type;
export const PrepareFacts = Schema.Struct({
  task: Schema.Struct({
    id: Schema.NonEmptyString.check(Schema.isMaxLength(256)),
    title: Schema.String.check(Schema.isMaxLength(8192)),
    description: Schema.String.check(Schema.isMaxLength(131072)),
  }),
  repository: Schema.Struct({
    id: Schema.NonEmptyString.check(Schema.isMaxLength(256)),
    directory: Schema.NonEmptyString.check(Schema.isMaxLength(8192)),
    base: Schema.NonEmptyString.check(Schema.isMaxLength(256)),
  }),
});
export const preparedDigest = (prepared: Omit<PreparedAgent, "digest">) =>
  digest(
    canonicalJson({
      version: prepared.version,
      profile: prepared.profile,
      fragments: prepared.fragments,
      model: prepared.model,
      delivery: prepared.delivery,
      native_agent: prepared.native_agent,
    }),
  );
export interface PrepareAgentInput {
  readonly role: AssignmentRole;
  readonly workflow?: typeof PolicySchema.Type;
  readonly task: Readonly<{ id: string; title: string; description: string }>;
  readonly repository: Readonly<{ id: string; directory: string; base: string }>;
  readonly configuredModel?: Model.Ref;
  readonly nativeOverride?: NativeAgent.ID;
  readonly captured?: StaticProfile;
}
