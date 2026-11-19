import type { createPreparedDiagrams } from "@abracode/report-export/preparation";
import { DiagramPreparationSchema } from "@abracode/contracts/presentation/diagrams";
import { decode } from "../decode.ts";
import { documentDiagrams } from "./diagrams.ts";
import { RendererShell, type Shell } from "./renderer-shell.ts";
import { Effect } from "effect";
import { AbsolutePath, ContentHash } from "../identities.ts";
import { CrewError, ensure } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { canonicalJSON } from "../presentation/identity.ts";
import { validateReportDocument, type ReportDocument } from "../presentation/report-document.ts";
import { reportHash, validatePortableHTML } from "./report-build.ts";
import type { Runner } from "../process.ts";

export interface DocumentRenderer {
  acquire: Effect.Effect<
    {
      fingerprint: ContentHash;
      render(document: ReportDocument): Effect.Effect<string, CrewError>;
    },
    CrewError
  >;
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
    home: AbsolutePath,
    private runner: Runner,
  ) {
    this.shell = new RendererShell(home, runner);
  }
  prepare = Effect.suspend(() => this.shell.prepare).pipe(Effect.map((value) => value.fingerprint));
  acquire = Effect.suspend(() => this.shell.acquire).pipe(
    Effect.map((shell) => ({
      fingerprint: shell.fingerprint,
      render: (document: ReportDocument) => this.render(document, shell),
    })),
  );
  private diagrams?: {
    fingerprint: ContentHash;
    service: Promise<ReturnType<typeof createPreparedDiagrams>>;
  };
  private diagramService(shell: Shell) {
    if (this.diagrams?.fingerprint === shell.fingerprint) return this.diagrams.service;
    const service = Promise.all([
      import(
        `data:text/javascript;base64,${Buffer.from(shell.host).toString("base64")}`
      ) as Promise<{ createPreparedDiagrams: typeof createPreparedDiagrams }>,
      import("playwright-core"),
    ]).then(([host, browser]) =>
      host.createPreparedDiagrams(shell.fingerprint, shell.engine, browser.chromium),
    );
    this.diagrams = { fingerprint: shell.fingerprint, service };
    return service;
  }
  private render = (input: ReportDocument, shell: Shell) =>
    domainEffect(
      Effect.gen({ self: this }, function* () {
        const document = yield* Effect.try({
          try: () => validateReportDocument(input),
          catch: CrewError.from,
        });
        const json = canonicalJSON(document);
        ensure(
          Buffer.byteLength(json) <= 1024 * 1024,
          "REPORT_DOCUMENT",
          "Captured report exceeds 1 MiB",
        );
        const sources = documentDiagrams(document);
        const batch = sources.length
          ? yield* Effect.tryPromise({
              try: async () => (await this.diagramService(shell)).prepare(sources),
              catch: CrewError.from,
            }).pipe(
              Effect.flatMap((value) =>
                decode(DiagramPreparationSchema, value, "Prepared diagram batch"),
              ),
            )
          : undefined;
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
        return output;
      }),
    );
}
