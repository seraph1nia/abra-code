import {
  ReportId,
  IssueId,
  ExecutionId,
  SessionId,
  Fingerprint,
  ContentHash,
  AbsolutePath,
  RelativePath,
} from "../identities.ts";
import { Schema } from "effect";
import { NonEmpty, Commit, Count, Positive } from "../contracts.ts";
const text = NonEmpty.check(Schema.isMaxLength(16384));
const strings = Schema.Array(text).check(Schema.isMaxLength(64));
const reference = Schema.Struct({
  base: Schema.optional(Commit),
  path: Schema.optional(
    RelativePath.check(
      Schema.isNonEmpty(),
      Schema.makeFilter(
        (p) =>
          (!p.startsWith("/") &&
            !p.includes("\\") &&
            p.split("/").every((s) => s !== ".." && s !== "." && s !== "")) ||
          "Evidence path must be relative",
      ),
    ),
  ),
  line: Schema.optional(Positive),
  url: Schema.optional(NonEmpty.check(Schema.isPattern(/^https?:\/\//))),
}).check(
  Schema.makeFilter(
    (r) => !!r.url || (!!r.path && !!r.base) || "Evidence requires a URL or base/path identity",
  ),
);
export const ReportInputSchema = Schema.Struct({
  report_id: ReportId,
  generation: Count,
  conclusions: text,
  findings: Schema.Array(
    Schema.Struct({
      finding: text,
      evidence: Schema.Array(reference).check(Schema.isMinLength(1), Schema.isMaxLength(64)),
    }),
  ).check(Schema.isMaxLength(64)),
  acceptance: Schema.Array(
    Schema.Struct({ criterion: text, met: Schema.Boolean, evidence: text }),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  limitations: strings,
});
export const ReportReceiptSchema = Schema.Struct({
  schema_version: Schema.Literal(1),
  issue_id: IssueId,
  execution_id: ExecutionId,
  report_id: ReportId,
  session_id: SessionId,
  base_commit: Commit,
  scope_fingerprint: Fingerprint,
  hash: ContentHash,
  bytes: Positive.check(Schema.isLessThanOrEqualTo(65536)),
  path: AbsolutePath,
});
export const ReportIntentSchema = Schema.Struct({
  receipt: ReportReceiptSchema,
  content: NonEmpty.check(Schema.isMaxLength(65536)),
});
