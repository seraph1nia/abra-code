import { createHash } from "node:crypto";
import { join, resolve, relative } from "node:path";
import { Effect } from "effect";
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
import {
  lstat,
  realpath,
  readFile,
  readdir,
  mkdir,
  mkdtemp,
  writeFile,
  rm,
} from "../filesystem.ts";
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

/** Trusted installed code only. Captured JSON and Mermaid are inert build inputs. */
export class ReactDocumentRenderer implements DocumentRenderer {
  constructor(
    private home: AbsolutePath,
    private runner: Runner,
  ) {}
  fingerprint = domainEffect(
    Effect.gen({ self: this }, function* () {
      const canonical = yield* realpath(this.home);
      const files: string[] = [
        "package.json",
        "pnpm-lock.yaml",
        "LICENSE",
        "licenses/inventory.json",
        "licenses/shadcn-ui.txt",
      ];
      const pending = [
        "src",
        "apps/report",
        "apps/web/src/components/ui",
        "apps/web/src/lib",
        "apps/web/src/presentation",
      ];
      let bytes = 0;
      while (pending.length) {
        const directory = pending.pop()!;
        const path = join(this.home, directory),
          stat = yield* lstat(path);
        ensure(
          stat.isDirectory() &&
            !stat.isSymbolicLink() &&
            (yield* realpath(path)) === resolve(canonical, directory),
          "REPORT_TEMPLATE",
          "Export source directories must remain inside the installation",
        );
        for (const name of (yield* readdir(path)).sort()) {
          if (["node_modules", "dist", ".vite"].includes(name)) continue;
          const child = join(directory, name),
            info = yield* lstat(join(this.home, child));
          ensure(
            !info.isSymbolicLink(),
            "REPORT_TEMPLATE",
            "Export source cannot redirect through symlinks",
          );
          if (info.isDirectory()) pending.push(child);
          else if (/\.(?:ts|tsx|css|json|html)$/.test(name)) files.push(child);
          ensure(
            files.length + pending.length < 1024,
            "REPORT_TEMPLATE",
            "Export source inventory exceeds its bound",
          );
        }
      }
      files.push("apps/web/src/surfaces.tsx", "apps/web/src/theme-tokens.css");
      const inventory = JSON.parse(
        yield* readFile(join(this.home, "licenses/inventory.json"), "utf8"),
      ) as { packages: { uses: string[]; evidence: { sha256: string }[] }[] };
      files.push(
        ...inventory.packages
          .filter((item) => item.uses.includes("report-artifact"))
          .flatMap((item) =>
            item.evidence.map((evidence) => `licenses/texts/${evidence.sha256}.txt`),
          ),
      );
      const hash = createHash("sha256");
      for (const file of [...new Set(files)].sort()) {
        const path = join(this.home, file),
          stat = yield* lstat(path);
        ensure(
          stat.isFile() &&
            !stat.isSymbolicLink() &&
            (yield* realpath(path)) === resolve(canonical, file),
          "REPORT_TEMPLATE",
          "Export source must be an owned regular file",
        );
        bytes += stat.size;
        ensure(
          bytes <= 32 * 1024 * 1024,
          "REPORT_TEMPLATE",
          "Export source inventory exceeds 32 MiB",
        );
        hash.update(file);
        hash.update(yield* readFile(path, "utf8"));
      }
      return ContentHash.make(hash.digest("hex"));
    }),
  );
  render = (input: ReportDocument, expected: ContentHash) =>
    domainEffect(
      Effect.gen({ self: this }, function* () {
        const document = yield* Effect.try({
          try: () => validateReportDocument(input),
          catch: CrewError.from,
        });
        ensure(
          (yield* this.fingerprint) === expected,
          "REPORT_TEMPLATE",
          "Installed exporter changed; explicitly export with its current identity",
        );
        const parent = yield* reportDirectory(this.home, [".abracode", "reports", ".scratch"]);
        return yield* Effect.acquireUseRelease(
          Effect.gen(function* () {
            const directory = yield* mkdtemp(join(parent, "export-"));
            return { directory, stat: yield* lstat(directory) };
          }),
          ({ directory }) =>
            domainEffect(
              Effect.gen({ self: this }, function* () {
                yield* mkdir(join(directory, "src"));
                yield* writeFile(
                  join(directory, "package.json"),
                  JSON.stringify({ name: "abracode-saved-export", private: true, type: "module" }),
                  { flag: "wx" },
                );
                yield* writeFile(
                  join(directory, "src/main.tsx"),
                  `import ${JSON.stringify(join(this.home, "apps/report/src/main.tsx"))};\n`,
                  { flag: "wx" },
                );
                const diagrams = document.data.evidence?.diagrams ?? [];
                for (const [index, diagram] of diagrams.entries())
                  yield* writeFile(join(directory, "src", `diagram${index}.mmd`), diagram.source, {
                    flag: "wx",
                  });
                const prepared = join(directory, "src/prepared-diagrams.ts");
                yield* writeFile(
                  prepared,
                  `${diagrams.map((_, index) => `import diagram${index} from "./diagram${index}.mmd";`).join("\n")}\nexport const preparedDiagrams=[${diagrams.map((_, index) => `diagram${index}`).join(",")}];\n`,
                  { flag: "wx" },
                );
                const json = canonicalJSON(document)
                  .replaceAll("<", "\\u003c")
                  .replaceAll("\u2028", "\\u2028")
                  .replaceAll("\u2029", "\\u2029");
                const html = (yield* readFile(
                  join(this.home, "apps/report/index.html"),
                  "utf8",
                )).replace(
                  "</body>",
                  `<script type="application/json" id="abracode-report-document" data-hash="${reportHash(canonicalJSON(document))}">${json}</script></body>`,
                );
                yield* writeFile(join(directory, "index.html"), html, { flag: "wx" });
                const config = join(directory, "vite.config.mts");
                yield* writeFile(
                  config,
                  `import {exportConfiguration} from ${JSON.stringify(join(this.home, "apps/report/vite.config.ts"))};\nconst deadline=setTimeout(()=>process.exit(124),45000);deadline.unref();\nexport default {...exportConfiguration({installationRoot:${JSON.stringify(this.home)},cacheDir:${JSON.stringify(join(directory, ".vite"))},preparedDiagrams:${JSON.stringify(prepared)}}),root:${JSON.stringify(directory)},build:{sourcemap:false,modulePreload:false,outDir:${JSON.stringify(join(directory, "dist"))},emptyOutDir:true}};\n`,
                  { flag: "wx" },
                );
                yield* this.runner.run(
                  Executable.make(join(this.home, "node_modules/.bin/vp")),
                  ["build", directory, "--config", config, "--configLoader", "native"],
                  this.home,
                  { NODE_ENV: "production" },
                  { deadline_ms: 45000, max_output_bytes: 262144 },
                );
                ensure(
                  JSON.stringify((yield* readdir(join(directory, "dist"))).sort()) ===
                    '["index.html"]',
                  "REPORT_ASSETS",
                  "Export must contain one portable HTML file",
                );
                const path = join(directory, "dist/index.html"),
                  stat = yield* lstat(path);
                ensure(
                  stat.isFile() && !stat.isSymbolicLink() && stat.size <= maximumHTMLBytes,
                  "REPORT_HTML",
                  "Export exceeds its 8 MiB bound or is not a regular file",
                );
                const output = yield* readFile(path, "utf8");
                validateDocumentHTML(output, document);
                ensure(
                  (yield* this.fingerprint) === expected,
                  "REPORT_TEMPLATE",
                  "Exporter changed during compilation; output was not published",
                );
                return output;
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
                  "Export scratch ownership changed; preserve it for inspection",
                );
                yield* rm(directory, { recursive: true, force: false });
              }),
            ).pipe(
              Effect.catch((error) => Effect.logWarning("Export scratch preserved", error.code)),
            ),
        );
      }),
    );
}
