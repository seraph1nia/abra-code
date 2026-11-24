import { Schema } from "effect";
import { Catalog, basicCatalog, STRICT_VALIDATION, type ComponentApi } from "@a2ui/web_core/v1_0";
import {
  SingleSelectSchema,
  MultiSelectSchema,
  DesignChoiceSchema,
  CommentFieldSchema,
  type ReviewAnswers,
  type ReviewDefinition,
} from "./reviews.ts";

export const reviewCatalogId = "https://abracode.local/catalog/review/v1/catalog.json";
export const ReviewFormSchema = Schema.Struct({
  component: Schema.Literal("ReviewForm"),
  title: Schema.String,
  description: Schema.optionalKey(Schema.String),
});
export const reviewComponentSchemas = {
  ReviewForm: ReviewFormSchema,
  SingleSelect: SingleSelectSchema,
  MultiSelect: MultiSelectSchema,
  DesignChoiceGroup: DesignChoiceSchema,
  CommentField: CommentFieldSchema,
};
export const reviewValidation = {
  ...STRICT_VALIDATION,
  targetVersion: "1.0",
  maxDepth: 10,
  allowedMessages: ["createSurface", "updateDataModel"],
};
const base = basicCatalog
  .derive({ catalogId: reviewCatalogId, components: ["Column", "Row", "Text"], functions: [] })
  .toJson();
const object = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Json));
const custom = Object.entries(reviewComponentSchemas).map(([name, schema]) => ({
  name,
  document: Schema.toJsonSchemaDocument(schema, { onExcessProperty: "error" }),
}));
export const reviewCatalogDocument = {
  ...base,
  instructions:
    "App-only review input. No workflow approvals, executable actions or external URLs. The app owns submission.",
  components: {
    ...object(base.components),
    ...Object.fromEntries(custom.map(({ name, document }) => [name, document.schema])),
  },
  $defs: {
    ...object(base.$defs),
    ...Object.assign({}, ...custom.map(({ document }) => document.definitions)),
    anyComponent: {
      oneOf: ["Column", "Row", "Text", ...Object.keys(reviewComponentSchemas)].map((name) => ({
        $ref: `#/components/${name}`,
      })),
      discriminator: { propertyName: "component" },
    },
    anyFunction: { not: {} },
  },
};
export const reviewCatalog = Catalog.fromJson(reviewCatalogDocument);
export const implementedReviewCatalog = <T extends ComponentApi>(entries: readonly T[]) =>
  new Catalog(reviewCatalogId, "1.0", entries, []);
export type ReviewSurfaceState = {
  readonly answers?: ReviewAnswers;
  readonly errors?: Readonly<Record<string, string>>;
  readonly disabled?: boolean;
};
export function reviewSurface(review: ReviewDefinition, state?: ReviewSurfaceState) {
  return {
    version: "1.0" as const,
    createSurface: {
      surfaceId: review.review_id,
      catalogId: reviewCatalogId,
      dataModel: {
        answers: { ...state?.answers },
        errors: { ...state?.errors },
        disabled: state?.disabled ?? false,
      },
      components: [
        {
          id: "root",
          component: "Column",
          children: ["review_heading", ...review.fields.map((f) => f.id)],
        },
        {
          id: "review_heading",
          component: "ReviewForm",
          title: review.title,
          ...(review.description ? { description: review.description } : {}),
        },
        ...review.fields,
      ],
    },
  };
}
