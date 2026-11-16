import { RendererShell } from "./renderer-shell.ts";
import { decode } from "../decode.ts";
import { join, relative } from "node:path";
import { Effect, Schema } from "effect";
import { AbsolutePath, ContentHash, Executable } from "../identities.ts";
import { CrewError, ensure } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { canonicalJSON } from "../presentation/identity.ts";
import { validateReportDocument, type ReportDocument } from "../presentation/report-document.ts";
import {
  reportHash,
  reportDirectory,
  validatePortableHTML,
  maximumHTMLBytes,
} from "./report-build.ts";
import { lstat, realpath, readFile, mkdtemp, writeFile, rm } from "../filesystem.ts";
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
        const sources = document.data.evidence?.diagrams ?? [];
        const prepared = sources.length ? yield* this.diagrams(document, json) : [];
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
  private diagrams = (document: ReportDocument, json: string) =>
    domainEffect(
      Effect.gen({ self: this }, function* () {
        const parent = yield* reportDirectory(this.home, [".abracode", "reports", ".scratch"]);
        return yield* Effect.acquireUseRelease(
          Effect.gen(function* () {
            const directory = yield* mkdtemp(join(parent, "diagrams-"));
            return { directory, stat: yield* lstat(directory) };
          }),
          ({ directory }) =>
            domainEffect(
              Effect.gen({ self: this }, function* () {
                const input = join(directory, "document.json"),
                  output = join(directory, "diagrams.json");
                yield* writeFile(input, json, { flag: "wx", mode: 0o600 });
                yield* this.runner.run(
                  Executable.make(join(this.home, "node_modules/.bin/tsx")),
                  [join(this.home, "apps/report/scripts/prepare-diagrams.ts"), input, output],
                  this.home,
                  { NODE_ENV: "production" },
                  { deadline_ms: 45000, max_output_bytes: 262144 },
                );
                const stat = yield* lstat(output);
                ensure(
                  stat.isFile() && !stat.isSymbolicLink() && stat.size <= maximumHTMLBytes,
                  "REPORT_DIAGRAM",
                  "Prepared diagram output exceeds its regular-file bound",
                );
                const value: unknown = JSON.parse(yield* readFile(output, "utf8"));
                const sources = document.data.evidence?.diagrams ?? [];
                const prepared = yield* decode(
                  Schema.Array(Schema.Struct({ source: Schema.String, svg: Schema.String })).check(
                    Schema.isMaxLength(8),
                  ),
                  value,
                  "Prepared diagrams",
                );
                ensure(
                  prepared.length === sources.length &&
                    prepared.every(
                      (item, i) =>
                        item.source === sources[i]!.source &&
                        /<svg\b/i.test(item.svg) &&
                        !/<(?:script|iframe|object|embed)\b|\son[a-z]+\s*=/i.test(item.svg),
                    ),
                  "REPORT_DIAGRAM",
                  "Prepared SVG does not match the captured source",
                );
                return prepared;
              }),
            ),
          ({ directory, stat }) =>
            domainEffect(
              Effect.gen(function* () {
                const current = yield* lstat(directory);
                ensure(
                  current.isDirectory() &&
                    !current.isSymbolicLink() &&
                    current.dev === stat.dev &&
                    current.ino === stat.ino &&
                    (yield* realpath(directory)) === directory &&
                    !relative(parent, directory).startsWith(".."),
                  "REPORT_SCRATCH",
                  "Diagram scratch ownership changed",
                );
                yield* rm(directory, { recursive: true, force: false });
              }),
            ).pipe(
              Effect.catch((error) => Effect.logWarning("Diagram scratch preserved", error.code)),
            ),
        );
      }),
    );
}
