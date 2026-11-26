import { utf8Bytes } from "../utf8.ts";
import { Schema } from "effect";

export const diagramLimits = {
  count: 32,
  source: 32768,
  total: 262144,
  output: 8 * 1024 * 1024,
} as const;

export const DiagramLiteralSchema = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.makeFilter(
    (source) => utf8Bytes(source) <= diagramLimits.source || "Diagram source exceeds 32 KiB",
  ),
);
export const DiagramSourceSchema = DiagramLiteralSchema.check(
  Schema.makeFilter((source) => diagramSourcePolicy(source) ?? true),
);
export const DiagramSchema = Schema.Struct({
  title: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(16384)),
  source: DiagramSourceSchema,
  description: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(16384))),
});
export const DiagramInputSchema = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/)),
  source: DiagramLiteralSchema,
});
export const DiagramCollectionSchema = Schema.Array(DiagramSchema).check(
  Schema.isMaxLength(diagramLimits.count),
  Schema.makeFilter(
    (diagrams) =>
      diagrams.reduce((n, d) => n + utf8Bytes(d.source), 0) <= diagramLimits.total ||
      "Diagram sources exceed 256 KiB",
  ),
);
/** Retained source is inert data. Publication/preparation applies the active feature policy. */
export const StoredDiagramCollectionSchema = Schema.Array(
  Schema.Struct({ ...DiagramSchema.fields, source: DiagramLiteralSchema }),
).check(
  Schema.isMaxLength(diagramLimits.count),
  Schema.makeFilter(
    (diagrams) =>
      diagrams.reduce((n, d) => n + utf8Bytes(d.source), 0) <= diagramLimits.total ||
      "Diagram sources exceed 256 KiB",
  ),
);
export const DiagramVerifyInputSchema = Schema.Struct({
  diagrams: Schema.Array(DiagramInputSchema).check(Schema.isMaxLength(32), Schema.isMinLength(1)),
});
export const DiagramResultSchema = Schema.Struct({
  id: DiagramInputSchema.fields.id,
  status: Schema.Literals([
    "verified",
    "syntax",
    "render",
    "forbidden",
    "limit",
    "timeout",
    "unavailable",
    "busy",
  ]),
  message: Schema.String.check(Schema.isMaxLength(2048)),
  line: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
  column: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
});
export const DiagramVerificationSchema = Schema.Struct({
  verified: Schema.Boolean,
  compiler: Schema.String.check(Schema.isMaxLength(512)),
  metrics: Schema.optionalKey(
    Schema.Struct({ compilations: Schema.Int, launches: Schema.Int, hits: Schema.Int }),
  ),
  results: Schema.Array(DiagramResultSchema).check(Schema.isMaxLength(32)),
});
export const PreparedDiagramSchema = Schema.Struct({
  id: DiagramInputSchema.fields.id,
  source: DiagramSourceSchema,
  svg: Schema.String.check(Schema.makeFilter((svg) => utf8Bytes(svg) <= diagramLimits.output)),
});
export const DiagramPreparationSchema = Schema.Struct({
  ...DiagramVerificationSchema.fields,
  assets: Schema.Array(PreparedDiagramSchema).check(Schema.isMaxLength(32)),
}).check(
  Schema.makeFilter(
    (value) =>
      utf8Bytes(JSON.stringify(value)) <= diagramLimits.output || "Prepared diagrams exceed 8 MiB",
  ),
);
export type DiagramInput = typeof DiagramInputSchema.Type;
export type DiagramResult = typeof DiagramResultSchema.Type;
export type DiagramPreparation = typeof DiagramPreparationSchema.Type;
export type PreparedDiagram = typeof PreparedDiagramSchema.Type;

/** Extract only declared placements. Repeated evidence sections count as repeated instances. */
export function collectDiagrams(
  components: readonly Record<string, unknown>[],
  evidence?: { diagrams?: readonly { source: string }[] },
): DiagramInput[] {
  return components.flatMap((component) => {
    if (component.component === "Mermaid" && typeof component.source === "string")
      return [{ id: String(component.id), source: component.source }];
    if (component.component === "ReportEvidence" && component.section === "diagrams")
      return (evidence?.diagrams ?? []).map((d, i) => ({
        id: `${String(component.id)}.evidence-${i}`,
        source: d.source,
      }));
    return [];
  });
}
export function diagramBudget(diagrams: readonly DiagramInput[]): string | undefined {
  if (diagrams.length > diagramLimits.count) return "Diagram collection exceeds 32 instances";
  if (new Set(diagrams.map((d) => d.id)).size !== diagrams.length)
    return "Repeated diagram identity";
  if (diagrams.some((d) => utf8Bytes(d.source) > diagramLimits.source))
    return "Diagram source exceeds 32 KiB";
  if (diagrams.reduce((n, d) => n + utf8Bytes(d.source), 0) > diagramLimits.total)
    return "Diagram sources exceed 256 KiB";
}

/** Reject active syntax, not punctuation in arrows or plain labels. The compiler checks SVG too. */
export function diagramSourcePolicy(source: string): string | undefined {
  if (/%%\{|^\s*---\s*(?:\r?\n)/m.test(source))
    return "Diagram configuration directives/frontmatter are forbidden";
  if (/<\/?[a-z][^>]*>/i.test(source)) return "Diagram HTML is forbidden";
  // Quoted labels and comments are inert; command checks apply outside them.
  const commands = source
    .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|%%[^\n]*/g, "")
    .replace(/#[a-zA-Z0-9]+;/g, "");
  if (
    /(?:^|[;\n])\s*(?:click|link)\b|@\s*\{[^}]*\b(?:img|image|icon)\s*:|::icon\s*\(|(?:^|[;\n])\s*(?:style|classDef)\b[^;\n]*\b(?:url|image|image-set|-webkit-image-set|cross-fade)\s*\(/im.test(
      commands,
    )
  )
    return "Diagram callbacks, links, images and external resources are forbidden";
}
