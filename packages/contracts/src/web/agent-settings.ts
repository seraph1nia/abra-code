import { Schema } from "effect";
import { Model } from "@opencode/schema/model";

/** Authored definition metadata only; no executable tools or assignment context. */
export const AgentDefinitionViewSchema = Schema.Struct({
  id: Schema.String,
  revision: Schema.String,
  description: Schema.String,
  mode: Schema.Literals(["primary", "subagent", "all"]),
  roles: Schema.Array(Schema.String),
  model: Schema.optional(Model.Ref),
  instructions: Schema.Array(
    Schema.Union([
      Schema.Struct({ kind: Schema.Literal("file"), path: Schema.String }),
      Schema.Struct({ kind: Schema.Literal("inline"), content: Schema.String }),
    ]),
  ),
  tools: Schema.optional(Schema.Array(Schema.String)),
  customTools: Schema.Array(Schema.Struct({ id: Schema.String, revision: Schema.String })),
  skills: Schema.Array(Schema.Struct({ name: Schema.String, preload: Schema.Boolean })),
  requiredSkills: Schema.Array(Schema.String),
  requiredTools: Schema.Array(Schema.Array(Schema.String)),
  deny: Schema.Array(Schema.String),
  dynamicContext: Schema.Boolean,
});
export type AgentDefinitionView = typeof AgentDefinitionViewSchema.Type;
export const AgentCatalogSchema = Schema.Struct({
  agents: Schema.Array(AgentDefinitionViewSchema),
});
export type AgentCatalog = typeof AgentCatalogSchema.Type;
