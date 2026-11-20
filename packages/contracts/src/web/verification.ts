import { RetainedReferenceSchema, EvidenceReceiptSchema } from "./worker-evidence.ts";
import { Schema } from "effect";
import { Timestamp, SessionId, Fingerprint } from "../identities.ts";

export const CheckResultSchema = Schema.Struct({
  fingerprint: Fingerprint,
  at: Timestamp,
  commands: Schema.Array(Schema.String),
});
export const VerificationViewSchema = Schema.Struct({
  scope: Schema.optionalKey(
    Schema.Struct({
      goal: Schema.String,
      acceptance: Schema.Array(Schema.String),
      constraints: Schema.Array(Schema.String),
    }),
  ),
  plan: Schema.optionalKey(Fingerprint),
  observed: Schema.optionalKey(Fingerprint),
  references: Schema.optionalKey(Schema.Array(RetainedReferenceSchema)),
  evidence: Schema.optionalKey(Schema.Array(EvidenceReceiptSchema)),
  checks: Schema.Array(CheckResultSchema),
  review: Schema.optionalKey(
    Schema.Struct({
      session_id: SessionId,
      fingerprint: Fingerprint,
      findings: Schema.String,
      passed: Schema.Boolean,
    }),
  ),
});
