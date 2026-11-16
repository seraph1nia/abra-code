import { Schema } from "effect";
import { AbsolutePath, RelativePath, SpecSchemaName, ContentHash } from "../identities.ts";
export const SchemaName = SpecSchemaName.check(
  Schema.isPattern(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/),
  Schema.isMaxLength(128),
);
const selection = Schema.Literals(["task", "repository_default"]);
export const SchemaResolution = Schema.Struct({
  name: SchemaName,
  source: Schema.Literals(["project", "user", "package"]),
  path: AbsolutePath,
});
export const NativeSchemaValidation = Schema.Struct({
  name: SchemaName,
  path: AbsolutePath,
  valid: Schema.Boolean,
});
const identity = { schema_version: Schema.Literal(1), selection_source: selection };
export const BoundSchema = Schema.Struct({
  ...identity,
  state: Schema.Literal("bound"),
  name: SchemaName,
  source: SchemaResolution.fields.source,
  root: AbsolutePath,
  hash: ContentHash,
  files: Schema.Array(
    Schema.Struct({
      path: RelativePath,
      hash: ContentHash,
      bytes: Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(262144)),
    }),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(129)),
});
export const SchemaBinding = Schema.Union([
  Schema.Struct({ ...identity, state: Schema.Literal("pending") }),
  BoundSchema,
]);
export type BoundSchema = typeof BoundSchema.Type;
