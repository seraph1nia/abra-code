import { createRoot } from "react-dom/client";
import { StrictMode, useState } from "react";
import { Checkbox } from "@abracode/presentation/ui/checkbox";
import { ReportDocumentView } from "@abracode/presentation/report-document";
import { FeedbackForm } from "./feedback.tsx";
import { preparedDiagrams } from "@report/prepared-diagrams";
import { Schema } from "effect";
import { ContentHash } from "@abracode/contracts/identities";
import "./style.css";

function PortableReport() {
  const [dark, setDark] = useState(false);
  const data = document.getElementById("abracode-report-document");
  const json = data?.textContent;
  if (!json)
    return (
      <main className="portable-report">
        <p>A saved JSON document is required for this export.</p>
      </main>
    );
  const digest = Schema.decodeUnknownResult(ContentHash)(data?.getAttribute("data-hash"));
  if (digest._tag === "Failure")
    return (
      <main className="portable-report">
        <p>The saved document digest is unavailable.</p>
      </main>
    );
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
      <ReportDocumentView
        artifact={{
          json,
          hash: digest.success,
          bytes: new TextEncoder().encode(json).length,
        }}
        preparedDiagrams={preparedDiagrams}
      />
      <FeedbackForm
        sections={[
          "Summary",
          "Findings",
          "Checks",
          "Events",
          "Code and evidence",
          "Limitations",
          "Diagrams",
        ]}
      />
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
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PortableReport />
  </StrictMode>,
);
