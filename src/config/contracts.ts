import { ProjectDispatchSchema, DispatchProfilesSchema } from "./dispatch.ts";
import { CapabilityFields } from "../opencode/capability-contracts.ts";
import {
  Executable,
  SpecSchemaName,
  RepositoryId,
  AbsolutePath,
  GitRemote,
  BranchName,
  AgentId,
} from "../identities.ts";
import {
  DeliveryPolicySchema,
  BranchPolicySchema,
  CIPolicySchema,
  MergeMethodSchema,
  CommandArgs,
  NonEmpty,
  PolicySchema,
  Positive,
  WorkerModelSchema,
} from "../contracts.ts";

import { WatchdogPolicySchema } from "../workflow/attention-contracts.ts";
import { GeneratedPathsSchema } from "./paths.ts";
import { Schema, Effect } from "effect";

import { parseDocument } from "yaml";
import { CrewError } from "../domain.ts";

export const StructuredCommandSchema = Schema.Struct({
  argv: Schema.mutable(CommandArgs),
  deadline_ms: Schema.optional(Positive),
  max_output_bytes: Schema.optional(Positive),
  env: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});
export const VerificationCommandSchema = Schema.Union([
  Schema.mutable(CommandArgs),
  StructuredCommandSchema,
]);
export const VerificationSchema = Schema.mutable(Schema.Array(VerificationCommandSchema));
export type VerificationCommand = typeof VerificationCommandSchema.Type;
export function verificationCommand(command: VerificationCommand) {
  return Array.isArray(command)
    ? { argv: command, deadline_ms: 900_000 }
    : { ...command, deadline_ms: command.deadline_ms ?? 900_000 };
}
import { AutomationFields, QualityProfile } from "./policy.ts";

export const ProjectInputFields = {
  dispatch: Schema.optional(ProjectDispatchSchema),
  ...AutomationFields,
  quality_profile: Schema.optional(QualityProfile),
  diagnostic_turns: Schema.optional(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(5)),
  ),
  repair_rounds: Schema.optional(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(5)),
  ),
  generated_paths: Schema.optional(GeneratedPathsSchema),
  merge_method: Schema.optional(MergeMethodSchema),
  ci_policy: Schema.optional(CIPolicySchema),
  allow_no_checks: Schema.optional(Schema.Boolean),
  id: RepositoryId,
  path: Schema.optional(AbsolutePath),
  remote: Schema.optional(GitRemote),
  target_branch: Schema.optional(BranchName),
  branch_policy: Schema.optional(BranchPolicySchema),
  managed: Schema.optional(Schema.Boolean),
  verification: Schema.optional(VerificationSchema),
  max_workers: Schema.optional(Positive),
  max_executions: Schema.optional(Positive),
  plan_approval: Schema.optional(Schema.Boolean),
  merge_approval: Schema.optional(Schema.Boolean),
  delivery: Schema.optional(DeliveryPolicySchema),
};
export const ProjectInputSchema = Schema.Struct(ProjectInputFields);
export const WorkerSchema = Schema.Struct({
  ...CapabilityFields,
  agent: Schema.optional(AgentId),
  model: Schema.optional(WorkerModelSchema),
});
export const WorkerInputSchema = Schema.Struct({
  ...CapabilityFields,
  agent: Schema.optional(AgentId),
});
export const ModelOverridesSchema = Schema.Struct({
  supervisor: Schema.optional(WorkerModelSchema),
  explore: Schema.optional(WorkerModelSchema),
  apply: Schema.optional(WorkerModelSchema),
  review: Schema.optional(WorkerModelSchema),
  research: Schema.optional(WorkerModelSchema),
});
export const ModelsSchema = Schema.Struct({
  default: WorkerModelSchema,
  overrides: Schema.optional(ModelOverridesSchema),
});
export const SupervisionModeSchema = Schema.Literals([
  "manual",
  "attended-automatic",
  "unattended",
]);
export const ConfigInputSchema = Schema.Struct({
  version: Schema.Literal(1),
  models: ModelsSchema,
  profiles: Schema.optional(DispatchProfilesSchema),
  attention_capacity: Schema.optional(Positive),
  progress_timeout_ms: Schema.optional(WatchdogPolicySchema),
  work_database: Schema.optional(AbsolutePath),
  worktree_root: Schema.optional(AbsolutePath),
  repository_root: Schema.optional(AbsolutePath),
  server_url: Schema.optional(NonEmpty),
  default_workflow: PolicySchema.pipe(Schema.withDecodingDefault(Effect.succeed("full-openspec"))),
  supervision_mode: Schema.optional(SupervisionModeSchema),
  auto_schedule: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  max_workers: Positive.pipe(Schema.withDecodingDefault(Effect.succeed(2))),
  max_executions: Schema.optional(Positive),
  research_capacity: Schema.optional(Positive),
  explore_capacity: Positive.pipe(Schema.withDecodingDefault(Effect.succeed(2))),
  review_capacity: Positive.pipe(Schema.withDecodingDefault(Effect.succeed(2))),
  reconcile_interval_ms: Positive.check(Schema.isGreaterThanOrEqualTo(1000)).pipe(
    Schema.withDecodingDefault(Effect.succeed(30000)),
  ),
  commands: Schema.optional(
    Schema.Struct({ openspec: Schema.optional(Executable), forge: Schema.optional(Executable) }),
  ),
  workers: Schema.optional(
    Schema.Struct({
      research: Schema.optional(WorkerInputSchema),
      explore: Schema.optional(WorkerInputSchema),
      apply: Schema.optional(WorkerInputSchema),
      review: Schema.optional(WorkerInputSchema),
    }),
  ),
  repositories: Schema.optional(
    Schema.mutable(Schema.Array(ProjectInputSchema).check(Schema.isMaxLength(128))),
  ),
});
export const ConfigSchema = Schema.Struct({
  ...ConfigInputSchema.fields,
  config_path: AbsolutePath,
  config_digest: NonEmpty,
  supervisor_model: WorkerModelSchema,
  home: AbsolutePath,
  work_database: AbsolutePath,
  worktree_root: AbsolutePath,
  repository_root: AbsolutePath,
  default_workflow: PolicySchema,
  auto_schedule: Schema.Boolean,
  max_workers: Positive,
  max_executions: Positive,
  explore_capacity: Positive,
  review_capacity: Positive,
  attention_capacity: Positive,
  research_capacity: Positive,
  progress_timeout_ms: WatchdogPolicySchema,
  reconcile_interval_ms: Positive,
  commands: Schema.Struct({
    openspec: Schema.mutableKey(Executable),
    forge: Schema.mutableKey(Executable),
  }),
  workers: Schema.Struct({
    research: Schema.mutableKey(Schema.optional(WorkerSchema)),
    explore: Schema.mutableKey(Schema.optional(WorkerSchema)),
    apply: Schema.mutableKey(Schema.optional(WorkerSchema)),
    review: Schema.mutableKey(Schema.optional(WorkerSchema)),
  }),
  repositories: Schema.mutable(Schema.Array(ProjectInputSchema)),
});
export const PackageSchema = Schema.Struct({
  scripts: Schema.optional(Schema.Record(Schema.String, NonEmpty)),
});
export const OpenSpecConfigSchema = Schema.Struct({ schema: SpecSchemaName });
export const parseYaml = (content: string, source: string) =>
  Effect.try({
    try: (): unknown => {
      const document = parseDocument(content, { uniqueKeys: true });
      const error = document.errors[0];
      if (error) {
        const position = error.linePos?.[0];
        throw new CrewError(
          "INVALID_DATA",
          `${source}: Invalid YAML or duplicate key (${error.code})${position ? ` at line ${position.line}, column ${position.col}` : ""}`,
        );
      }
      return document.toJS();
    },
    catch: (error) =>
      error instanceof CrewError
        ? error
        : new CrewError("INVALID_DATA", `${source}: Invalid YAML or duplicate key`),
  });
