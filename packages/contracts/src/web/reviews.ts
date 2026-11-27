import { utf8Bytes } from "../utf8.ts";
import { Schema } from "effect";
import {
  Identifier,
  ContentHash,
  IssueId,
  MessageId,
  RequestId,
  SessionId,
  Timestamp,
} from "../identities.ts";
import { exactParseOptions as exact } from "../primitives.ts";
import { ComponentId, SurfaceId } from "./surface-destination.ts";
import { ResourcePathSchema } from "./resources.ts";
import { SubmissionSchema, ReceiptSchema } from "./workspace-wire.ts";

const text = Schema.String.check(Schema.isMaxLength(4096));
const label = text.check(Schema.isNonEmpty());
const positive = Schema.Int.check(Schema.isGreaterThan(0));
export const ReviewSurfaceSourceSchema = Schema.Struct({
  kind: Schema.Literal("surface"),
  surface_id: SurfaceId,
  revision: positive,
  hash: ContentHash,
}).annotate(exact);
export const ReviewReportSourceSchema = Schema.Struct({
  kind: Schema.Literal("report"),
  issue_id: IssueId,
  request_id: RequestId,
  hash: ContentHash,
}).annotate(exact);
export const ReviewPlanSourceSchema = Schema.Struct({
  kind: Schema.Literal("plan"),
  issue_id: IssueId,
  path: ResourcePathSchema,
  generation: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  hash: ContentHash,
}).annotate(exact);
export const ReviewSourceSchema = Schema.Union([
  ReviewSurfaceSourceSchema,
  ReviewReportSourceSchema,
  ReviewPlanSourceSchema,
]);
export type ReviewSource = typeof ReviewSourceSchema.Type;
const optionFields = { value: Identifier, label, description: Schema.optionalKey(text) };
const options = Schema.Array(Schema.Struct(optionFields).annotate(exact)).check(
  Schema.isMinLength(1),
  Schema.isMaxLength(32),
);
const field = {
  id: ComponentId,
  label,
  description: Schema.optionalKey(text),
  required: Schema.optionalKey(Schema.Boolean),
};
export const SingleSelectSchema = Schema.Struct({
  component: Schema.Literal("SingleSelect"),
  ...field,
  options,
}).annotate(exact);
export const MultiSelectSchema = Schema.Struct({
  component: Schema.Literal("MultiSelect"),
  ...field,
  options,
}).annotate(exact);
export const DesignChoiceSchema = Schema.Struct({
  component: Schema.Literal("DesignChoiceGroup"),
  ...field,
  options: Schema.Array(
    Schema.Struct({ ...optionFields, preview: Identifier }).annotate(exact),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(16)),
}).annotate(exact);
export const CommentFieldSchema = Schema.Struct({
  component: Schema.Literal("CommentField"),
  ...field,
}).annotate(exact);
export const ReviewFieldSchema = Schema.Union([
  SingleSelectSchema,
  MultiSelectSchema,
  DesignChoiceSchema,
  CommentFieldSchema,
]);
export const ReviewDefinitionSchema = Schema.Struct({
  review_id: Identifier,
  title: label,
  description: Schema.optionalKey(text),
  source: ReviewSourceSchema,
  fields: Schema.Array(ReviewFieldSchema).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
  responds_to: Schema.optionalKey(SubmissionSchema.fields.request_id),
})
  .annotate(exact)
  .check(
    Schema.makeFilter((review) => {
      if (new Set(review.fields.map((f) => f.id)).size !== review.fields.length)
        return "Review field IDs must be unique";
      if (review.fields.some((f) => f.id === "root" || f.id === "review_heading"))
        return "Reserved review field ID";
      if (
        review.fields.some(
          (f) => "options" in f && new Set(f.options.map((o) => o.value)).size !== f.options.length,
        )
      )
        return "Option values must be unique";
      return utf8Bytes(JSON.stringify(review)) <= 65536 || "Review exceeds 64 KiB";
    }),
  );
export type ReviewDefinition = typeof ReviewDefinitionSchema.Type;
export type ReviewField = typeof ReviewFieldSchema.Type;
export const ReviewPublishSchema = Schema.Struct({
  review: ReviewDefinitionSchema,
  previews: Schema.optionalKey(
    Schema.Array(Schema.Struct({ id: Identifier, path: ResourcePathSchema }).annotate(exact)).check(
      Schema.isMaxLength(16),
    ),
  ),
}).annotate(exact);
export const ReviewSelectionSchema = Schema.Struct({
  review_id: Identifier,
  revision: positive,
}).annotate(exact);
export type ReviewSelection = typeof ReviewSelectionSchema.Type;
export const ReviewAssetSchema = Schema.Struct({
  id: Identifier,
  hash: ContentHash,
  mime: Schema.Literals(["image/png", "image/jpeg", "image/webp"]),
  bytes: positive.check(Schema.isLessThanOrEqualTo(2 * 1024 * 1024)),
});
export const ReviewRecordSchema = Schema.Struct({
  schema_version: Schema.Literal(1),
  session_id: SessionId,
  message_id: MessageId,
  call_id: Schema.String,
  revision: positive,
  at: Timestamp,
  hash: ContentHash,
  review: ReviewDefinitionSchema,
  source_text: Schema.String.check(Schema.isMaxLength(65536)),
  assets: Schema.Array(ReviewAssetSchema).check(Schema.isMaxLength(16)),
});
export type ReviewRecord = typeof ReviewRecordSchema.Type;
export const ReviewReferenceSchema = Schema.Struct({
  ...ReviewSelectionSchema.fields,
  hash: ContentHash,
  title: label,
  source: ReviewSourceSchema,
  responds_to: Schema.optionalKey(SubmissionSchema.fields.request_id),
});
export const ReviewViewSchema = Schema.Struct({
  record: ReviewRecordSchema,
  current_revision: positive,
  unavailable: Schema.optionalKey(Schema.String),
  revisions: Schema.Array(ReviewReferenceSchema).check(Schema.isMaxLength(32)),
});
export type ReviewView = typeof ReviewViewSchema.Type;
export const ReviewListQuerySchema = Schema.Struct({
  issue_id: Schema.optionalKey(IssueId),
}).annotate(exact);
export const ReviewListSchema = Schema.Struct({
  reviews: Schema.Array(ReviewReferenceSchema).check(Schema.isMaxLength(32)),
  diagnostics: Schema.Array(Schema.String),
});
export const ReviewAssetQuerySchema = Schema.Struct({
  ...ReviewSelectionSchema.fields,
  hash: ContentHash,
}).annotate(exact);
export const ReviewAssetDataSchema = Schema.Struct({
  ...ReviewAssetSchema.fields,
  data: Schema.String.check(Schema.isMaxLength(3 * 1024 * 1024)),
});
export const ReviewAnswersSchema = Schema.Record(
  Identifier,
  Schema.Union([text, Schema.Array(Identifier).check(Schema.isMaxLength(32))]),
);
export type ReviewAnswers = typeof ReviewAnswersSchema.Type;
export const ReviewSubmitSchema = Schema.Struct({
  ...ReviewSelectionSchema.fields,
  hash: ContentHash,
  request_id: SubmissionSchema.fields.request_id,
  answers: ReviewAnswersSchema,
})
  .annotate(exact)
  .check(
    Schema.makeFilter(
      (input) => utf8Bytes(JSON.stringify(input.answers)) <= 16384 || "Answers exceed 16 KiB",
    ),
  );
export type ReviewSubmit = typeof ReviewSubmitSchema.Type;
export const FeedbackSummarySchema = Schema.Struct({
  title: Schema.String,
  choices: Schema.Array(Schema.Struct({ question: Schema.String, answer: Schema.String })),
});
export const ReviewReceiptSchema = Schema.Struct({
  ...ReceiptSchema.fields,
  feedback: Schema.optional(FeedbackSummarySchema),
  review_id: Identifier,
  revision: positive,
  hash: ContentHash,
});
export type ReviewReceipt = typeof ReviewReceiptSchema.Type;
export const ReviewResponseQuerySchema = Schema.Struct({
  ...ReviewSelectionSchema.fields,
  hash: ContentHash,
  request_id: SubmissionSchema.fields.request_id,
}).annotate(exact);
export const ReviewReceiptLookupSchema = Schema.NullOr(ReviewReceiptSchema);

export function feedbackMessage(input: typeof ReviewResponseQuerySchema.Type) {
  return `Review feedback ${input.request_id} for ${input.review_id} revision ${input.revision} (${input.hash}). Retrieve my choices with abra_review_ui action response.`;
}
export function feedbackReference(text: string) {
  const match =
    /^Review feedback (\S+) for (\S+) revision (\d+) \(([a-f0-9]{64})\)\. Retrieve my choices with abra_review_ui action response\.$/.exec(
      text,
    );
  if (!match) return;
  const ref = {
    request_id: match[1],
    review_id: match[2],
    revision: Number(match[3]),
    hash: match[4],
  };
  return Schema.is(ReviewResponseQuerySchema)(ref) ? ref : undefined;
}

/** The same field constraints drive client errors and authoritative native validation. */
export function reviewAnswerErrors(review: ReviewDefinition, answers: ReviewAnswers) {
  const errors: Record<string, string> = {};
  for (const key of Object.keys(answers))
    if (!review.fields.some((f) => f.id === key)) errors[key] = "Unknown review field";
  for (const f of review.fields) {
    const value = answers[f.id];
    if (
      value !== undefined &&
      (f.component === "MultiSelect" ? !Array.isArray(value) : typeof value !== "string")
    ) {
      errors[f.id] = "Choose the expected answer type";
      continue;
    }
    const missing =
      value === undefined || (typeof value === "string" ? !value.trim() : !value.length);
    if (missing) {
      if (f.required) errors[f.id] = "Choose an answer or enter a comment";
      continue;
    }
    if (f.component === "CommentField") {
      if (typeof value !== "string" || value.length > 4096)
        errors[f.id] = "Enter a comment of at most 4096 characters";
    } else {
      const selected = Array.isArray(value) ? value : [value];
      if (
        (f.component === "MultiSelect") !== Array.isArray(value) ||
        new Set(selected).size !== selected.length ||
        selected.some((v) => !f.options.some((o) => o.value === v))
      )
        errors[f.id] = "Choose available options";
    }
  }
  return errors;
}

export const reviewReference = (record: ReviewRecord) => ({
  review_id: record.review.review_id,
  revision: record.revision,
  hash: record.hash,
  title: record.review.title,
  source: record.review.source,
  ...(record.review.responds_to ? { responds_to: record.review.responds_to } : {}),
});
export const reviewSourceKey = (source: ReviewSource) => JSON.stringify(source);
