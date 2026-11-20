import { Schema } from "effect";
import { Count, Positive } from "../primitives.ts";
import { IssueId, RequestId, ContentHash, SessionId, Timestamp, Commit } from "../identities.ts";
import { ResourcePathSchema } from "./resources.ts";

export const CaptureInputSchema = Schema.Struct({
  kind: Schema.Literals(["screenshot", "trace"]),
  request_id: RequestId,
  path: ResourcePathSchema,
  description: Schema.NonEmptyString.check(Schema.isMaxLength(2048)),
  claimed_revision: Schema.optionalKey(Schema.NonEmptyString.check(Schema.isMaxLength(128))),
});
const receiptFields = {
  ...CaptureInputSchema.fields,
  issue_id: IssueId,
  session_id: SessionId,
  generation: Count,
  at: Timestamp,
  bytes: Positive,
  hash: ContentHash,
};
export const EvidenceReceiptSchema = Schema.Union([
  Schema.Struct({
    ...receiptFields,
    kind: Schema.Literal("screenshot"),
    width: Positive,
    height: Positive,
  }),
  Schema.Struct({ ...receiptFields, kind: Schema.Literal("trace") }),
]);
const label = Schema.NonEmptyString.check(Schema.isMaxLength(512));
export const WorkerReferenceSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("code"),
    file: ResourcePathSchema,
    revision: Commit,
    line: Positive,
    symbol: Schema.optionalKey(label),
  }),
  Schema.Struct({
    kind: Schema.Literal("documentation"),
    title: label,
    version: label,
    url: Schema.String.check(
      Schema.isMaxLength(2048),
      Schema.makeFilter((value) => {
        try {
          const url = new URL(value);
          return url.protocol === "https:" && !url.username && !url.password;
        } catch {
          return false;
        }
      }),
    ),
  }),
]);
export const RetainedReferenceSchema = Schema.Struct({
  source: WorkerReferenceSchema,
  session_id: SessionId,
  generation: Count,
  excerpt: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(2048))),
});
export type WorkerReference = typeof WorkerReferenceSchema.Type;
export type RetainedReference = typeof RetainedReferenceSchema.Type;
export const EvidenceQuerySchema = Schema.Struct({
  issue_id: IssueId,
  request_id: RequestId,
  hash: ContentHash,
});
export const EvidenceDataSchema = Schema.Struct({
  receipt: EvidenceReceiptSchema,
  data: Schema.String.check(Schema.isMaxLength(3 * 1024 * 1024)),
});
export type EvidenceReceipt = typeof EvidenceReceiptSchema.Type;
export type CaptureInput = typeof CaptureInputSchema.Type;
export type EvidenceQuery = typeof EvidenceQuerySchema.Type;
