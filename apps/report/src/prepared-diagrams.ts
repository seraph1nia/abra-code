import { Schema } from "effect";
import { diagramLimits, PreparedDiagramSchema } from "@abracode/contracts/presentation/diagrams";
import type { PreparedReportDiagram } from "@abracode/presentation/report-evidence";

const OfflinePreparedDiagramSchema = Schema.Struct({
  id: Schema.optionalKey(PreparedDiagramSchema.fields.id),
  source: PreparedDiagramSchema.fields.source,
  svg: PreparedDiagramSchema.fields.svg,
});

const PreparedDiagramsJSON = Schema.fromJsonString(
  Schema.Array(OfflinePreparedDiagramSchema).check(Schema.isMaxLength(diagramLimits.count)),
);

/** Only the trusted host prepares SVG; the document itself never supplies executable markup. */
export function readPreparedDiagrams(
  raw = typeof document === "undefined"
    ? undefined
    : document.getElementById("abracode-report-diagrams")?.textContent,
): readonly PreparedReportDiagram[] | undefined {
  if (!raw) return [];
  const decoded = Schema.decodeResult(PreparedDiagramsJSON, { reportInput: false })(raw);
  if (decoded._tag === "Failure") return undefined;
  return decoded.success;
}

export const preparedDiagrams = readPreparedDiagrams();
