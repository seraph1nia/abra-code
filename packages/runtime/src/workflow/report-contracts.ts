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
