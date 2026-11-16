import type { PreparedReportDiagram } from "@abracode/presentation/report-evidence";
/** Only the trusted host prepares SVG; the document itself never supplies executable markup. */
function readPrepared(): readonly PreparedReportDiagram[] {
  const json = document.getElementById("abracode-report-diagrams")?.textContent;
  if (!json) return [];
  const parsed: unknown = JSON.parse(json);
  if (
    !Array.isArray(parsed) ||
    parsed.length > 8 ||
    !parsed.every(
      (item) =>
        item &&
        typeof item === "object" &&
        typeof item.source === "string" &&
        typeof item.svg === "string",
    )
  )
    throw new Error("Prepared diagram data is unavailable");
  return parsed;
}
export const preparedDiagrams = readPrepared();
