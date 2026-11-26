import { createCatalogDocument, catalogObject as object } from "./catalog-document.ts";
import { Schema } from "effect";
import { Catalog, basicCatalog, STRICT_VALIDATION, type ComponentApi } from "@a2ui/web_core/v1_0";
import {
  DesignChoiceSchema,
  type ReviewField,
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
  DesignChoiceGroup: DesignChoiceSchema,
};
export const reviewValidation = {
  ...STRICT_VALIDATION,
  targetVersion: "1.0",
  maxDepth: 10,
  allowedMessages: ["createSurface", "updateDataModel"],
};
const base = basicCatalog
  .derive({
    catalogId: reviewCatalogId,
    components: ["Column", "ChoicePicker", "TextField"],
    functions: ["required", "length"],
  })
  .toJson();
const custom = Object.entries(reviewComponentSchemas).map(([name, schema]) => ({
  name,
  document: Schema.toJsonSchemaDocument(schema, { onExcessProperty: "error" }),
}));
export const reviewCatalogDocument = createCatalogDocument(base, {
  catalogId: reviewCatalogId,
  title: "AbraCode interactive reviews",
  instructions:
    "App-only review input. No workflow approvals, executable actions or external URLs. The app owns submission.",
  components: {
    ...object(base.components),
    ...Object.fromEntries(
      custom.map(({ name, document }) => [
        name,
        name === "DesignChoiceGroup"
          ? {
              ...document.schema,
              properties: {
                ...object(document.schema.properties),
                value: { $ref: "common_types.json#/$defs/DynamicString" },
                checks: { $ref: "common_types.json#/$defs/Checkable/properties/checks" },
              },
            }
          : document.schema,
      ]),
    ),
  },
  definitions: Object.assign({}, ...custom.map(({ document }) => document.definitions)),
});
export const reviewCatalog = Catalog.fromJson(reviewCatalogDocument);
export const implementedReviewCatalog = <T extends ComponentApi>(entries: readonly T[]) =>
  new Catalog(
    reviewCatalogId,
    "1.0",
    entries,
    [...basicCatalog.functions.values()].filter((fn) => reviewCatalog.functions.has(fn.name)),
    { themeSchema: basicCatalog.themeSchema, defs: reviewCatalogDocument.$defs },
  );
export type ReviewSurfaceState = {
  readonly answers?: ReviewAnswers;
  readonly errors?: Readonly<Record<string, string>>;
  readonly disabled?: boolean;
};
export function reviewControlValue(field: ReviewField, answer: ReviewAnswers[string] | undefined) {
  if (field.component === "SingleSelect")
    return typeof answer === "string" && answer ? [answer] : [];
  return answer ?? (field.component === "MultiSelect" ? [] : "");
}
function reviewComponent(field: ReviewField) {
  const value = { "@path": `/answers/${field.id}` };
  const checks = [
    ...(field.required
      ? [{ condition: { "@call": "required", args: { value } }, message: "An answer is required." }]
      : []),
    ...(field.component === "CommentField"
      ? [
          {
            condition: { "@call": "length", args: { value, max: 4096 } },
            message: "Use at most 4096 characters.",
          },
        ]
      : []),
  ];
  const input = { id: field.id, label: field.label, value, checks };
  switch (field.component) {
    case "CommentField":
      return { ...input, component: "TextField", variant: "longText" };
    case "DesignChoiceGroup":
      return { ...field, ...input };
    default:
      return {
        ...input,
        component: "ChoicePicker",
        variant: field.component === "MultiSelect" ? "multipleSelection" : "mutuallyExclusive",
        options: field.options.map(({ label, value }) => ({ label, value })),
      };
  }
}
export function reviewSurface(review: ReviewDefinition, state?: ReviewSurfaceState) {
  return {
    version: "1.0" as const,
    createSurface: {
      surfaceId: review.review_id,
      catalogId: reviewCatalogId,
      dataModel: {
        fieldHints: Object.fromEntries(
          review.fields.map((field) => [
            field.id,
            {
              required: field.required ?? false,
              description: field.description ?? "",
              options: Object.fromEntries(
                ("options" in field ? field.options : []).map((o) => [
                  o.value,
                  o.description ?? "",
                ]),
              ),
            },
          ]),
        ),
        answers: Object.fromEntries(
          review.fields.map((field) => [
            field.id,
            reviewControlValue(field, state?.answers?.[field.id]),
          ]),
        ),
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
        ...review.fields.map(reviewComponent),
      ],
    },
  };
}
