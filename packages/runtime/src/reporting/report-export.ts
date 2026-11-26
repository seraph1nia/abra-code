import { tryDomainValue } from "../effect.ts";
import { compileFunction } from "node:vm";
import { createRequire } from "node:module";
import type { createPreparedDiagrams } from "@abracode/report-export/preparation";
import { DiagramPreparationSchema } from "@abracode/contracts/presentation/diagrams";
import { decode } from "../decode.ts";
import { documentDiagrams } from "./diagrams.ts";
import { RendererShell, type Shell } from "./renderer-shell.ts";
import { Effect } from "effect";
import { AbsolutePath, ContentHash } from "@abracode/contracts/identities";
import { CrewError, ensure } from "../domain.ts";
import { canonicalJSON } from "../presentation/identity.ts";
import {
  validateReportDocument,
  type ReportDocument,
} from "@abracode/contracts/presentation/report-document";
import { embeddedReportJSON, reportHash, validatePortableHTML } from "./report-build.ts";
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
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
  const block = (name: string) => {
    const matches = scripts.filter((match) =>
      match[1]!.split(/\s+/).includes(`id="abracode-report-${name}"`),
    );
    ensure(matches.length === 1, "REPORT_HTML", `Missing or duplicate report ${name} block`);
    const [attributes, raw] = matches[0]!.slice(1);
    const json = canonicalJSON(embeddedReportJSON(raw!));
    return { attributes: attributes!.split(/\s+/), json };
  };
  const payload = block("document");
  ensure(
    payload.json === canonicalJSON(document),
    "REPORT_HTML",
    "Export does not retain the exact canonical document",
  );
  const diagrams = block("diagrams");
  for (const item of [payload, diagrams]) {
    ensure(
      item.attributes.includes(`data-hash="${reportHash(item.json)}"`),
      "REPORT_HTML",
      "Export digest mismatch",
    );
  }
}

export function embedReportPayload(shell: string, document: string, diagrams: string) {
  const block = (name: string, json: string) => {
    const inert = json
      .replaceAll("<", "\\u003c")
      .replaceAll("\u2028", "\\u2028")
      .replaceAll("\u2029", "\\u2029");
    return `<script type="application/json" id="abracode-report-${name}" data-hash="${reportHash(json)}">${inert}</script>`;
  };
  const end = /<\/body\s*>\s*<\/html\s*>\s*$/i.exec(shell);
  ensure(end, "REPORT_HTML", "Renderer shell is missing its closing body");
  return (
    shell.slice(0, end.index) + block("document", document) + block("diagrams", diagrams) + end[0]
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
    const entry: {
      fingerprint: ContentHash;
      service: Promise<ReturnType<typeof createPreparedDiagrams>>;
    } = {
      fingerprint: shell.fingerprint,
      service: import("playwright-core")
        .then(({ chromium }) => {
          // Compile the bytes captured with this shell. No disk reread or global module-cache entry.
          const module = {
            exports: {} as { createPreparedDiagrams?: typeof createPreparedDiagrams },
          };
          const execute = compileFunction(shell.host, ["exports", "module", "require"]);
          execute(module.exports, module, createRequire(import.meta.url));
          if (typeof module.exports.createPreparedDiagrams !== "function")
            throw new Error("Prepared diagram host is missing its factory");
          return module.exports.createPreparedDiagrams(shell.fingerprint, shell.engine, chromium);
        })
        .catch((error) => {
          if (this.diagrams === entry) this.diagrams = undefined;
          throw error;
        }),
    };
    this.diagrams = entry;
    return entry.service;
  }
  private render = (input: ReportDocument, shell: Shell) =>
    Effect.gen({ self: this }, function* () {
      const document = yield* Effect.try({
        try: () => validateReportDocument(input),
        catch: CrewError.from,
      });
      const json = canonicalJSON(document);
      if (!(Buffer.byteLength(json) <= 1024 * 1024))
        return yield* new CrewError("REPORT_DOCUMENT", "Captured report exceeds 1 MiB");
      const sources = documentDiagrams(document);
      const batch = sources.length
        ? yield* Effect.tryPromise({
            try: async (signal) => (await this.diagramService(shell)).prepare(sources, signal),
            catch: CrewError.from,
          }).pipe(
            Effect.flatMap((value) =>
              decode(DiagramPreparationSchema, value, "Prepared diagram batch"),
            ),
          )
        : undefined;
      if (batch && !batch.verified)
        return yield* new CrewError(
          "REPORT_DIAGRAM",
          batch?.results
            .filter((r) => r.status !== "verified")
            .map((r) => `${r.id}: ${r.status}: ${r.message}`)
            .join("\n") ?? "Diagram preparation failed",
        );
      const prepared = batch?.assets ?? [];
      const output = yield* tryDomainValue(
        embedReportPayload,
        shell.html,
        json,
        canonicalJSON(prepared),
      );
      yield* tryDomainValue(validateDocumentHTML, output, document);
      return output;
    });
}
