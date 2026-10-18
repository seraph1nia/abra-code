import { ReportSnapshotSchema } from "../../templates/reporter/src/snapshot-data.ts";
import {
  RequestId,
  Timestamp,
  MessageId,
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
export const EvidenceReferenceSchema = Schema.Struct({
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
export const VisualRenderRequestSchema = Schema.Struct({
  diagrams: ReportSnapshotSchema.fields.diagrams,
  request_id: RequestId,
  title: Schema.optional(text),
});
export const ReportEvidenceSchema = Schema.Struct({
  diagrams: ReportSnapshotSchema.fields.diagrams,
  conclusions: text,
  findings: Schema.Array(
    Schema.Struct({
      finding: text,
      evidence: Schema.Array(EvidenceReferenceSchema).check(
        Schema.isMinLength(1),
        Schema.isMaxLength(64),
      ),
    }),
  ).check(Schema.isMaxLength(64)),
  acceptance: Schema.Array(
    Schema.Struct({ criterion: text, met: Schema.Boolean, evidence: text }),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  limitations: strings,
});
export const ReportInputSchema = Schema.Struct({
  ...ReportEvidenceSchema.fields,
  render: Schema.optional(VisualRenderRequestSchema),
  report_id: ReportId,
  generation: Count,
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
  evidence: Schema.optional(ReportEvidenceSchema),
  receipt: ReportReceiptSchema,
  content: NonEmpty.check(Schema.isMaxLength(65536)),
});

/** HTML is an optional attachment; Markdown research acceptance stays authoritative. */
export const VisualReceiptSchema = Schema.Struct({
  schema_version: Schema.Literal(1),
  request_id: RequestId,
  issue_id: IssueId,
  execution_id: ExecutionId,
  generation: Count,
  input_hash: ContentHash,
  template_hash: ContentHash,
  hash: ContentHash,
  bytes: Positive.check(Schema.isLessThanOrEqualTo(8 * 1024 * 1024)),
  path: AbsolutePath,
  observed_at: Timestamp,
  source_report: Schema.optional(Schema.Struct({ report_id: ReportId, hash: ContentHash })),
});
export const VisualBuildSchema = Schema.Struct({
  request: VisualRenderRequestSchema,
  generation: Count,
  requested_by: SessionId,
  notify_session: Schema.optional(SessionId),
  deadline_at: Schema.optional(Schema.Finite),
  notices: Schema.optional(
    Schema.Array(
      Schema.Struct({
        phase: Schema.Literals(["published", "failed"]),
        message_id: MessageId,
        text: text,
        delivered: Schema.Boolean,
      }),
    ).check(
      Schema.isMaxLength(2),
      Schema.makeFilter(
        (ns) =>
          (new Set(ns.map((n) => n.phase)).size === ns.length &&
            new Set(ns.map((n) => n.message_id)).size === ns.length) ||
          "Duplicate artifact notice phase",
      ),
    ),
  ),
  source_report: VisualReceiptSchema.fields.source_report,
  snapshot: ReportSnapshotSchema,
  input_hash: ContentHash,
  template_hash: ContentHash,
  status: Schema.Literals(["pending", "building", "validated", "published", "failed"]),
  artifact: Schema.optional(VisualReceiptSchema),
  staging: Schema.optional(AbsolutePath),
  error: Schema.optional(text),
}).check(
  Schema.makeFilter(
    (b) =>
      ((b.status !== "building" || b.deadline_at !== undefined) &&
        (!["validated", "published"].includes(b.status) || !!b.artifact) &&
        (!b.artifact ||
          (b.artifact.request_id === b.request.request_id &&
            b.artifact.input_hash === b.input_hash &&
            b.artifact.template_hash === b.template_hash &&
            b.artifact.generation === b.generation &&
            b.artifact.issue_id === b.snapshot.issue_id &&
            b.artifact.execution_id === b.snapshot.execution_id))) ||
      "Visual artifact identity does not match its captured input",
  ),
);
export type VisualBuild = typeof VisualBuildSchema.Type;
export const VisualBuildsSchema = Schema.Array(VisualBuildSchema).check(
  Schema.isMaxLength(16),
  Schema.makeFilter(
    (builds) =>
      new Set(builds.map((b) => b.request.request_id)).size === builds.length ||
      "Duplicate visual report request",
  ),
);
export const WorkReportInputSchema = Schema.Union([
  Schema.Struct({ issue_id: IssueId, action: Schema.optional(Schema.Literal("read")) }),
  Schema.Struct({ issue_id: IssueId, action: Schema.Literal("artifacts") }),
  Schema.Struct({
    issue_id: IssueId,
    action: Schema.Literal("generate"),
    ...VisualRenderRequestSchema.fields,
  }),
]);

const {
  snapshot: _snapshot,
  staging: _staging,
  notices: _notices,
  ...visualSummaryFields
} = VisualBuildSchema.fields;
export const VisualBuildSummarySchema = Schema.Struct({
  ...visualSummaryFields,
  request: Schema.Struct({ request_id: RequestId, title: VisualRenderRequestSchema.fields.title }),
});

export function researchMarkdown(
  e: import("../domain.ts").Execution,
  id: ReportId,
  input: typeof ReportEvidenceSchema.Type,
) {
  return `# Research report: ${e.issue_id}\n\nReport: ${id}\nExecution: ${e.execution_id}\nWorker: ${e.research_session_id}\nBase: ${e.base_commit}\nScope: ${e.scope!.fingerprint}\n\n## Contract\n\n${e.scope!.contract.goal}\n\n## Conclusions\n\n${input.conclusions}\n\n## Findings\n\n${input.findings.map((f) => `${f.finding}\n${f.evidence.map((r) => `- ${r.url ?? `${r.base}:${r.path}${r.line ? `:${r.line}` : ""}`}`).join("\n")}`).join("\n\n")}\n\n## Acceptance\n\n${input.acceptance.map((r) => `- [${r.met ? "x" : " "}] ${r.criterion}: ${r.evidence}`).join("\n")}\n\n## Limitations\n\n${input.limitations.length ? input.limitations.map((l) => `- ${l}`).join("\n") : "None reported."}\n${input.diagrams?.length ? `\n## Architecture diagrams\n\n${input.diagrams.map((d) => `### ${d.title}\n\n\`\`\`mermaid\n${d.source}\n\`\`\`\n`).join("\n")}` : ""}`;
}
