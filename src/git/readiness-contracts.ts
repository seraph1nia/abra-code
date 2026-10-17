import { Schema } from "effect";
import { CheckName, Commit, Timestamp } from "../identities.ts";
import { Count, Positive, CIPolicySchema } from "../contracts.ts";
import { CheckFields, CheckSource } from "./check-contracts.ts";
export const ForgeObservationSchema = Schema.Struct({
  head: Commit,
  at: Timestamp,
  ci_policy: CIPolicySchema,
  required_confirmed: Schema.Boolean,
  required: Schema.Array(Schema.Struct({ context: CheckName, app_id: Schema.optional(Positive) })),
  checks: Schema.Array(
    Schema.Struct({
      ...CheckFields,
      source: Schema.optional(CheckSource),
      blocking: Schema.Boolean,
    }),
  ),
  checks_total: Count,
  limited: Schema.Boolean,
  reasons: Schema.Array(Schema.String),
});
