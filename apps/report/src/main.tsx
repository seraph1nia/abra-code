import { createRoot } from "react-dom/client";
import { StrictMode, useState } from "react";
import { Checkbox } from "@abracode/presentation/ui/checkbox";
import { FrozenReportDocument } from "@abracode/presentation/report-document";
import { readReportDocument } from "@abracode/contracts/presentation/report-document";
import { FeedbackForm } from "./feedback.tsx";
import { readPreparedDiagrams, verifiedReportBlock } from "@report/prepared-diagrams";
import type { ContentHash } from "@abracode/contracts/identities";
import "./style.css";

const reportEvidenceSectionLabels: Record<string, string> = {
  summary: "Summary",
  findings: "Findings",
  checks: "Checks",
  events: "Events",
  excerpts: "Code and evidence",
  limitations: "Limitations",
  diagrams: "Diagrams",
};

function feedbackSections(parsed: ReturnType<typeof readReportDocument>): readonly string[] {
  if (!parsed.supported || !parsed.document.data.evidence) return [];
  const seen = new Set<string>();
  const sections: string[] = [];
  for (const component of parsed.document.surface.createSurface.components) {
    if (component.component !== "ReportEvidence" || typeof component.section !== "string") continue;
    const label = reportEvidenceSectionLabels[component.section];
    if (!label || seen.has(label)) continue;
    seen.add(label);
    sections.push(label);
  }
  return sections;
}

function PortableReport({
  parsed,
  hash,
  preparedDiagrams,
}: {
  parsed: ReturnType<typeof readReportDocument>;
  hash: ContentHash;
  preparedDiagrams: NonNullable<ReturnType<typeof readPreparedDiagrams>>;
}) {
  const [dark, setDark] = useState(false);
  const [sections] = useState(() => feedbackSections(parsed));
  const notices =
    document.getElementById("abracode-license-notices")?.textContent ?? "Notices unavailable";
  return (
    <main className="portable-report">
      <header className="portable-toolbar">
        <strong>AbraCode · Saved report</strong>
        <label>
          Dark theme{" "}
          <Checkbox
            checked={dark}
            onCheckedChange={(checked) => {
              setDark(checked);
              document.documentElement.dataset.theme = checked ? "dark" : "light";
            }}
          />
        </label>
      </header>
      {parsed.supported ? (
        <FrozenReportDocument
          document={parsed.document}
          hash={hash}
          preparedDiagrams={preparedDiagrams}
        />
      ) : (
        <output>{parsed.reason}</output>
      )}
      <FeedbackForm sections={sections} />
      <details>
        <summary>Third-party notices</summary>
        <pre>{notices}</pre>
      </details>
      <footer>
        Read-only saved evidence. App navigation and workflow actions are unavailable in this
        offline export.
      </footer>
    </main>
  );
}
const root = createRoot(document.getElementById("root")!);
async function openReport() {
  const [report, diagrams] = await Promise.all([
    verifiedReportBlock("document"),
    verifiedReportBlock("diagrams"),
  ]);
  const preparedDiagrams = readPreparedDiagrams(diagrams.json);
  if (!preparedDiagrams) throw new Error("Invalid diagram data");
  root.render(
    <StrictMode>
      <PortableReport
        parsed={readReportDocument(report.json)}
        hash={report.hash}
        preparedDiagrams={preparedDiagrams}
      />
    </StrictMode>,
  );
}
void openReport().catch(() => {
  root.render(
    <main className="portable-report">
      <p>Report integrity verification failed. Reopen a verified export.</p>
    </main>,
  );
});
