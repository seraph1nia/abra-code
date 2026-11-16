import { useMemo } from "react";
import { readReportDocument } from "@abracode/contracts/presentation/report-document";
import type { ResourceSelection } from "@abracode/contracts/web/resources";
import type { DocumentArtifactSchema } from "@abracode/contracts/web/wire";
import { GeneratedSurface } from "./surfaces.tsx";
import type { PreparedReportDiagram } from "./report-evidence.tsx";

/** All rendered values come from the verified immutable document. */
export function ReportDocumentView({
  artifact,
  inspect,
  preparedDiagrams,
}: {
  artifact: typeof DocumentArtifactSchema.Type;
  inspect?: (target: ResourceSelection) => void;
  preparedDiagrams?: readonly PreparedReportDiagram[];
}) {
  const result = useMemo(() => {
    try {
      if (new TextEncoder().encode(artifact.json).length !== artifact.bytes)
        throw new Error("Report byte count does not match its receipt.");
      return readReportDocument(artifact.json);
    } catch {
      return {
        supported: false as const,
        reason:
          "This retained document is malformed. Its original JSON remains available for download.",
      };
    }
  }, [artifact]);
  if (!result.supported) return <p role="status">{result.reason}</p>;
  const document = result.document;
  return (
    <article className="frozen-report" data-report-document={document.document_id}>
      <h2>{document.title}</h2>
      <p>Saved snapshot · {new Date(document.captured_at).toLocaleString()}</p>
      <p className="muted">
        Generated explanations are commentary. Captured findings and check receipts are labeled
        separately.{" "}
        {inspect
          ? "Links inspect current app resources."
          : "App navigation is unavailable in this offline view."}
      </p>
      <details>
        <summary>Document provenance and limitations</summary>
        <p>
          Revision {document.revision} · {document.provenance.execution_id} · Generation{" "}
          {document.provenance.generation}
        </p>
        <code>{artifact.hash}</code>
        <ul>
          {document.limitations.map((limitation, index) => (
            <li key={index}>{limitation}</li>
          ))}
        </ul>
      </details>
      <GeneratedSurface
        key={artifact.hash}
        frozen
        work={document.data.work}
        liveCoverage={document.data.live_coverage}
        inspect={inspect}
        evidence={document.data.evidence}
        preparedDiagrams={preparedDiagrams}
        record={{
          surface: document.surface,
          snapshot: document.data.snapshot_work ?? document.data.work,
          revision: document.revision,
          at: document.captured_at,
          coverage: document.data.snapshot_coverage,
        }}
      />
    </article>
  );
}
