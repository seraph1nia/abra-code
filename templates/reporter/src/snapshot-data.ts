import { Schema } from "effect";

const boundedText = (bytes: number) =>
  Schema.String.check(
    Schema.makeFilter(
      (value) => new TextEncoder().encode(value).length <= bytes || `Maximum ${bytes} UTF-8 bytes`,
    ),
  );
const text = boundedText(16384);
const required = text.check(Schema.isNonEmpty());
const time = Schema.String.check(
  Schema.makeFilter((value) => {
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value))
      return "Expected a UTC observation time with milliseconds";
    return (
      (Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value) ||
      "Invalid UTC observation time"
    );
  }),
);
const url = required.check(
  Schema.makeFilter((value) => {
    try {
      const parsed = new URL(value);
      return (
        (["https:", "http:"].includes(parsed.protocol) && !parsed.username && !parsed.password) ||
        "Evidence URL must be HTTP(S) without credentials"
      );
    } catch {
      return "Invalid evidence URL";
    }
  }),
);
export const SourceReferenceSchema = Schema.Struct({
  path: Schema.optional(boundedText(4096).check(Schema.isNonEmpty())),
  line: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
  commit: Schema.optional(Schema.String.check(Schema.isPattern(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/))),
  url: Schema.optional(url),
}).check(
  Schema.makeFilter(
    (value) =>
      ((!value.line || !!value.path) && (!!value.path || !!value.commit || !!value.url)) ||
      "A source reference requires identity; a line requires a path",
  ),
);
export type SourceReference = typeof SourceReferenceSchema.Type;
const finding = Schema.Struct({
  title: required,
  category: required,
  summary: text,
  evidence: text,
  references: Schema.Array(SourceReferenceSchema).check(Schema.isMaxLength(16)),
});
const check = Schema.Struct({
  name: required,
  status: Schema.Literals(["passed", "failed", "not_run", "unavailable"]),
  evidence: Schema.optional(required),
  at: Schema.optional(time),
}).check(
  Schema.makeFilter(
    (value) =>
      !["passed", "failed"].includes(value.status) ||
      !!value.evidence ||
      "A check result requires retained evidence",
  ),
);

/** Read-only presentation data. Identifiers and status labels never authorize controller actions. */
export const ReportSnapshotSchema = Schema.Struct({
  schema_version: Schema.Literal(1),
  issue_id: boundedText(256).check(Schema.isNonEmpty()),
  execution_id: boundedText(256).check(Schema.isNonEmpty()),
  title: required,
  summary: text,
  observed_at: time,
  provenance: required,
  status: required,
  diagrams: Schema.optional(
    Schema.Array(
      Schema.Struct({
        title: required,
        source: boundedText(32768).check(
          Schema.isNonEmpty(),
          Schema.makeFilter(
            (source) =>
              !/%%\{|<|\\|\/\/|^---(?:\r?\n)|@\s*\{|\bclick\b|\bhref\b|(?:javascript|data|https?):|\burl\s*\(/i.test(
                source,
              ) ||
              "Generated diagrams cannot contain directives, HTML, links or external resources",
          ),
        ),
      }),
    ).check(Schema.isMaxLength(8)),
  ),
  findings: Schema.Array(finding).check(Schema.isMaxLength(64)),
  checks: Schema.Array(check).check(Schema.isMaxLength(64)),
  events: Schema.Array(
    Schema.Struct({
      label: required,
      status: required,
      at: Schema.optional(time),
      detail: Schema.optional(text),
    }),
  ).check(Schema.isMaxLength(128)),
  excerpts: Schema.Array(
    Schema.Struct({
      title: required,
      kind: Schema.Literals(["code", "diff"]),
      text: boundedText(65536),
      provenance: required,
      reference: Schema.optional(SourceReferenceSchema),
    }),
  ).check(Schema.isMaxLength(16)),
  limitations: Schema.Array(required).check(Schema.isMaxLength(64)),
}).check(
  Schema.makeFilter(
    (value) =>
      new TextEncoder().encode(JSON.stringify(value)).length <= 524288 ||
      "Report snapshot exceeds 512 KiB",
  ),
);
export type ReportSnapshot = typeof ReportSnapshotSchema.Type;
export function validateSnapshot(input: unknown): ReportSnapshot {
  return Schema.decodeUnknownSync(ReportSnapshotSchema, {
    reportInput: false,
    onExcessProperty: "error",
  })(input);
}
/** For inert application/json script bodies, never executable authored code. */
export function snapshotJSON(input: unknown): string {
  return JSON.stringify(validateSnapshot(input))
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}
