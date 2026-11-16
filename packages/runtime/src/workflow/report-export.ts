import { prepareDiagrams, documentDiagrams } from "./diagrams.ts";
import { RendererShell } from "./renderer-shell.ts";
import { Effect } from "effect";
import { AbsolutePath, ContentHash } from "../identities.ts";
import { CrewError, ensure } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { canonicalJSON } from "../presentation/identity.ts";
import { validateReportDocument, type ReportDocument } from "../presentation/report-document.ts";
import { reportHash, validatePortableHTML } from "./report-build.ts";
import type { Runner } from "../process.ts";

export interface DocumentRenderer {
  readonly fingerprint: Effect.Effect<ContentHash, CrewError>;
  render(document: ReportDocument, expected: ContentHash): Effect.Effect<string, CrewError>;
}
export function validateDocumentHTML(html: string, document: ReportDocument) {
  validatePortableHTML(html);
  const payload = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)].find((match) =>
    /\bid=["']?abracode-report-document(?:["'\s]|$)/i.test(match[1]!),
  );
  ensure(
    payload && canonicalJSON(JSON.parse(payload[2]!)) === canonicalJSON(document),
    "REPORT_HTML",
    "Export does not retain the exact canonical document",
  );
  ensure(
    payload[1]!.includes(reportHash(canonicalJSON(document))),
    "REPORT_HTML",
    "Export document digest is missing",
  );
}

/** Reuses trusted application code; documents and prepared diagrams stay inert data. */
export class ReactDocumentRenderer implements DocumentRenderer {
  private shell: RendererShell;
  constructor(
    private home: AbsolutePath,
    private runner: Runner,
  ) {
    this.shell = new RendererShell(home, runner);
  }
  fingerprint = Effect.suspend(() => this.shell.prepare).pipe(
    Effect.map((value) => value.fingerprint),
  );
  render = (input: ReportDocument, expected: ContentHash) =>
    domainEffect(
      Effect.gen({ self: this }, function* () {
        const document = yield* Effect.try({
          try: () => validateReportDocument(input),
          catch: CrewError.from,
        });
        const shell = yield* this.shell.forDocument(expected);
        ensure(
          shell.fingerprint === expected,
          "REPORT_TEMPLATE",
          "Installed exporter changed; explicitly export with its current identity",
        );
        const json = canonicalJSON(document);
        ensure(
          Buffer.byteLength(json) <= 1024 * 1024,
          "REPORT_DOCUMENT",
          "Captured report exceeds 1 MiB",
        );
        const sources = documentDiagrams(document);
        const batch = sources.length ? yield* prepareDiagrams(sources) : undefined;
        ensure(
          !batch || batch.verified,
          "REPORT_DIAGRAM",
          batch?.results
            .filter((r) => r.status !== "verified")
            .map((r) => `${r.id}: ${r.status}: ${r.message}`)
            .join("\n") ?? "Diagram preparation failed",
        );
        const prepared = batch?.assets ?? [];
        const escaped = (value: string) =>
          value
            .replaceAll("<", "\\u003c")
            .replaceAll("\u2028", "\\u2028")
            .replaceAll("\u2029", "\\u2029");
        const payload = `<script type="application/json" id="abracode-report-document" data-hash="${reportHash(json)}">${escaped(json)}</script><script type="application/json" id="abracode-report-diagrams">${escaped(JSON.stringify(prepared))}</script>`;
        const output = shell.html.replace(/<\/body\s*>/i, () => payload + "</body>");
        validateDocumentHTML(output, document);
        ensure(
          (yield* this.shell.prepare).fingerprint === expected,
          "REPORT_TEMPLATE",
          "Renderer inputs changed during export; output was not published",
        );
        return output;
      }),
    );
}
