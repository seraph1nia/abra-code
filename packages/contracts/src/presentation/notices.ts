import { Schema } from "effect";

/** Projection shared by the portable build and its verified source identity. */
export const NoticeAuthorSchema = Schema.NullOr(
  Schema.Union([
    Schema.String,
    Schema.Struct({
      name: Schema.String,
      email: Schema.optionalKey(Schema.String),
      url: Schema.optionalKey(Schema.String),
    }),
  ]),
);

export const NoticeEvidenceSchema = Schema.Struct({
  sha256: Schema.String,
});

export const NoticePackageSchema = Schema.Struct({
  id: Schema.String,
  license: Schema.String,
  author: NoticeAuthorSchema,
  uses: Schema.Array(Schema.String),
  evidence: Schema.Array(NoticeEvidenceSchema),
});

export const NoticeInventorySchema = Schema.Struct({
  packages: Schema.Array(NoticePackageSchema),
});

export type NoticeAuthor = typeof NoticeAuthorSchema.Type;
export type NoticeInventory = typeof NoticeInventorySchema.Type;

export const reportNoticeInputs = (inventory: NoticeInventory) =>
  inventory.packages
    .filter((item) => item.uses.includes("report-artifact"))
    .map((item) => ({
      id: item.id,
      license: item.license,
      author: item.author,
      evidence: item.evidence.map((value) => value.sha256),
    }));
