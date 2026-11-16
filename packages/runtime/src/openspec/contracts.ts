import { Schema } from "effect";
import { Count, NonEmpty } from "../contracts.ts";
import { ChangeName, ArtifactId, RelativePath, SpecSchemaName, TaskId } from "../identities.ts";
export const SpecArtifactSchema = Schema.Struct({
  id: ArtifactId,
  status: Schema.Literals(["done", "ready", "blocked", "skipped"]),
  outputPath: RelativePath,
  requires: Schema.optional(Schema.Array(ArtifactId)),
});
export const SpecStatusSchema = Schema.Struct({
  changeName: ChangeName,
  schemaName: SpecSchemaName,
  isPlanningComplete: Schema.Boolean,
  isComplete: Schema.Boolean,
  artifacts: Schema.Array(SpecArtifactSchema),
  applyRequires: Schema.Array(ArtifactId),
  nextSteps: Schema.optional(Schema.Array(Schema.String)),
  actionContext: Schema.optional(Schema.Struct({ mode: NonEmpty })),
});
export const ProgressSchema = Schema.Struct({
  total: Count,
  complete: Count,
  remaining: Count,
}).check(
  Schema.makeFilter((p) => p.total === p.complete + p.remaining || "Task counts must agree"),
);
export const ApplyStatusSchema = Schema.Struct({
  state: Schema.Literals(["blocked", "ready", "all_done"]),
  taskTrackingConfigured: Schema.Boolean,
  progress: ProgressSchema,
  tasks: Schema.Array(Schema.Struct({ id: TaskId, done: Schema.Boolean })),
  contextFiles: Schema.optional(Schema.Record(Schema.String, Schema.Array(Schema.String))),
  instruction: Schema.optional(Schema.String),
  context: Schema.optional(Schema.String),
  operationGuidance: Schema.optional(Schema.Array(Schema.String)),
}).check(
  Schema.makeFilter(
    (a) =>
      a.state !== "all_done" ||
      (a.taskTrackingConfigured && a.progress.remaining === 0) ||
      "Completed apply requires completed tracking",
  ),
);
export const ValidationSchema = Schema.Struct({
  items: Schema.Array(Schema.Struct({ valid: Schema.Boolean })),
  summary: Schema.Struct({ totals: Schema.Struct({ failed: Count, passed: Count }) }),
});
export const CreatedSchema = Schema.Struct({
  change: Schema.Struct({
    id: ChangeName,
    path: NonEmpty,
    metadataPath: NonEmpty,
    schema: SpecSchemaName,
  }),
});
export const InstructionsSchema = Schema.Struct({
  artifactId: ArtifactId,
  changeName: ChangeName,
  schemaName: SpecSchemaName,
  changeDir: NonEmpty,
  outputPath: RelativePath,
  resolvedOutputPath: NonEmpty,
  description: Schema.String,
  instruction: Schema.String,
  template: Schema.String,
  context: Schema.optional(Schema.String),
  rules: Schema.optional(Schema.Array(Schema.String)),
  dependencies: Schema.Array(
    Schema.Struct({
      id: ArtifactId,
      done: Schema.Boolean,
      path: NonEmpty,
      description: Schema.String,
    }),
  ),
  unlocks: Schema.Array(ArtifactId),
  skipped: Schema.optional(Schema.Boolean),
  warning: Schema.optional(Schema.String),
});
export const ArchiveSchema = Schema.Struct({
  archive: Schema.Struct({
    change: ChangeName,
    archivedAs: NonEmpty,
    path: NonEmpty,
    specsUpdated: Schema.Boolean,
  }),
});
export const DiscoverySchema = Schema.Array(
  Schema.Struct({ name: SpecSchemaName, artifacts: Schema.Array(ArtifactId), source: NonEmpty }),
);
export type SpecStatus = typeof SpecStatusSchema.Type;
export type ApplyStatus = typeof ApplyStatusSchema.Type;
