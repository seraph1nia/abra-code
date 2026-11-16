import { Schema } from "effect";
import { RoleSchema, WorkerModelSchema } from "../primitives.ts";
import { DispatchProfileId } from "../identities.ts";

export const workerRoles = ["explore", "apply", "review", "research"] as const;
export const DispatchProfileSchema = Schema.Struct({ role: RoleSchema, model: WorkerModelSchema });
export const DispatchProfilesSchema = Schema.Record(DispatchProfileId, DispatchProfileSchema).check(
  Schema.makeFilter(
    (profiles) => Object.keys(profiles).length <= 32 || "At most 32 dispatch profiles are allowed",
  ),
);
const selector = Schema.Struct({
  model: Schema.optional(WorkerModelSchema),
  profile: Schema.optional(DispatchProfileId),
}).check(
  Schema.makeFilter(
    (s) => !!s.model !== !!s.profile || "Select exactly one complete model or role profile",
  ),
);
export const ProjectDispatchSchema = Schema.Struct({
  explore: Schema.optional(selector),
  apply: Schema.optional(selector),
  review: Schema.optional(selector),
  research: Schema.optional(selector),
});
export const DispatchSchema = ProjectDispatchSchema.check(
  Schema.makeFilter(
    (s) =>
      workerRoles.some((role) => s[role] !== undefined) || "Dispatch requires a role selection",
  ),
);
export type Dispatch = typeof DispatchSchema.Type;
export const SelectionSourceSchema = Schema.Struct({
  source: Schema.Literals([
    "task.model",
    "task.profile",
    "repository.model",
    "repository.profile",
    "role_override",
    "default",
  ]),
  profile: Schema.optional(DispatchProfileId),
});
export type SelectionSource = typeof SelectionSourceSchema.Type;
export const DispatchSourcesSchema = Schema.Struct({
  explore: SelectionSourceSchema,
  apply: SelectionSourceSchema,
  review: SelectionSourceSchema,
  research: SelectionSourceSchema,
});
