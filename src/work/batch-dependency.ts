import { Schema } from "effect";
import { Identifier, IssueId } from "../identities.ts";
export const BatchDependencySchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal("local"), client_key: Identifier }),
  Schema.Struct({ type: Schema.Literal("existing"), issue_id: IssueId }),
]);
