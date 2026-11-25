import { canonicalJson } from "@abracode/contracts/canonical-json";
import { ContentHash } from "@abracode/contracts/identities";
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

export async function verifiedReportBlock(name: "document" | "diagrams") {
  const nodes = document.querySelectorAll(
    `script[type="application/json"]#abracode-report-${name}`,
  );
  const raw = nodes[0]?.textContent;
  if (nodes.length !== 1 || !raw) throw new Error("Missing report data");
  const json = canonicalJson(JSON.parse(raw));
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(json));
  const hash = ContentHash.make(
    Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join(""),
  );
  if (hash !== nodes[0]!.getAttribute("data-hash")) throw new Error("Report digest mismatch");
  return { json, hash };
}
