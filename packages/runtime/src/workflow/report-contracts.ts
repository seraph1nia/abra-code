import { isDeepStrictEqual } from "node:util";
import { Predicate } from "effect";
import type { ReportId } from "../identities.ts";
import type { ReportEvidenceSchema } from "@abracode/contracts/workflow/report-contracts";
export * from "@abracode/contracts/workflow/report-contracts";
export function researchMarkdown(
  e: import("../domain.ts").Execution,
  id: ReportId,
  input: typeof ReportEvidenceSchema.Type,
) {
  return `# Research report: ${e.issue_id}\n\nReport: ${id}\nExecution: ${e.execution_id}\nWorker: ${e.research_session_id}\nBase: ${e.base_commit}\nScope: ${e.scope!.fingerprint}\n\n## Contract\n\n${e.scope!.contract.goal}\n\n## Conclusions\n\n${input.conclusions}\n\n## Findings\n\n${input.findings.map((f) => `${f.finding}\n${f.evidence.map((r) => `- ${r.url ?? `${r.base}:${r.path}${r.line ? `:${r.line}` : ""}`}`).join("\n")}`).join("\n\n")}\n\n## Acceptance\n\n${input.acceptance.map((r) => `- [${r.met ? "x" : " "}] ${r.criterion}: ${r.evidence}`).join("\n")}\n\n## Limitations\n\n${input.limitations.length ? input.limitations.map((l) => `- ${l}`).join("\n") : "None reported."}\n${input.diagrams?.length ? `\n## Architecture diagrams\n\n${input.diagrams.map((d) => `### ${d.title}\n\n\`\`\`mermaid\n${d.source}\n\`\`\`\n`).join("\n")}` : ""}`;
}

const capturedReportFields = [
  "request",
  "generation",
  "requested_by",
  "notify_session",
  "source_report",
  "snapshot",
  "input_hash",
  "template_hash",
  "format",
  "document_hash",
  "producing_call",
] as const;

function sameJSON(left: unknown, right: unknown) {
  return isDeepStrictEqual(
    JSON.parse(JSON.stringify(left ?? null)),
    JSON.parse(JSON.stringify(right ?? null)),
  );
}

export function visualReportHistoryError(
  before: readonly unknown[],
  after: unknown,
): string | undefined {
  if (!Array.isArray(after)) return "Visual report history cannot be removed";
  for (const old of before) {
    if (!Predicate.isObject(old) || !Predicate.isObject(old.request)) continue;
    const requestID = old.request.request_id;
    const next = after.find(
      (n) =>
        Predicate.isObject(n) &&
        Predicate.isObject(n.request) &&
        n.request.request_id === requestID,
    );
    if (
      !Predicate.isObject(next) ||
      capturedReportFields.some((field) => !sameJSON(old[field], next[field])) ||
      (old.artifact && (!next.artifact || !sameJSON(old.artifact, next.artifact))) ||
      (old.status === "published" && next.status !== "published")
    )
      return "Captured visual report identity/artifact cannot be rebound or removed";

    if (!Array.isArray(old.notices)) continue;
    for (const notice of old.notices) {
      if (!Predicate.isObject(notice)) continue;
      const replacement = Array.isArray(next.notices)
        ? next.notices.find((n) => Predicate.isObject(n) && n.message_id === notice.message_id)
        : undefined;
      if (
        !Predicate.isObject(replacement) ||
        replacement.text !== notice.text ||
        replacement.phase !== notice.phase ||
        (notice.delivered && !replacement.delivered) ||
        (notice.associated && !replacement.associated)
      )
        return "Retained report result notices cannot be rebound or removed";
    }
  }
}
