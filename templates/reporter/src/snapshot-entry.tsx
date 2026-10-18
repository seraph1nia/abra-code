import { render } from "solid-js/web";
import { snapshotDiagrams } from "./snapshot-diagrams.ts";
import SnapshotReport from "./snapshot-report.tsx";
import { type ReportSnapshot } from "./snapshot-data.ts";
import "./styles.css";

// The authorized build supplies schema-validated, escaped JSON as inert data.
const data = document.getElementById("abracode-report-data");
if (!data) throw new Error("Validated report snapshot is missing");
const snapshot = JSON.parse(data.textContent ?? "null") as ReportSnapshot;
render(
  () => <SnapshotReport snapshot={snapshot} diagrams={snapshotDiagrams} />,
  document.getElementById("root")!,
);
