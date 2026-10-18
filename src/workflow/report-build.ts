import { Effect } from "effect";
import { createHash } from "node:crypto";
import { join, resolve, relative } from "node:path";
import { cp, symlink } from "node:fs/promises";
import { type ReportSnapshot, snapshotJSON } from "../../templates/reporter/src/snapshot-data.ts";
import { AbsolutePath, ContentHash, Executable } from "../identities.ts";
import { CrewError, ensure } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { type Runner } from "../process.ts";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "../filesystem.ts";
export const reportHash = (text: string) =>
  ContentHash.make(createHash("sha256").update(text).digest("hex"));
export const maximumHTMLBytes = 8 * 1024 * 1024;

/** Create one checked path segment at a time; never mkdir through a symlink. */
export const reportDirectory = (home: AbsolutePath, segments: readonly string[]) =>
  domainEffect(
    Effect.gen(function* () {
      const canonical = yield* realpath(home);
      let path: AbsolutePath = home;
      for (const segment of segments) {
        ensure(
          /^[a-zA-Z0-9._-]+$/.test(segment) && ![".", ".."].includes(segment),
          "REPORT_PATH",
          "Invalid owned report path segment",
        );
        path = AbsolutePath.make(join(path, segment));
        yield* mkdir(path, { mode: 0o700 }).pipe(
          Effect.catchIf(
            (error) => error.code === "EEXIST",
            () => Effect.void,
          ),
        );
        const stat = yield* lstat(path);
        ensure(
          stat.isDirectory() &&
            !stat.isSymbolicLink() &&
            (yield* realpath(path)) === resolve(canonical, relative(home, path)),
          "REPORT_PATH",
          "Report storage must use owned real directories",
        );
      }
      return yield* realpath(path);
    }),
  );

/** Validation is independent of publication. Assets are inline; untrusted JSON
 * stays inert and must round-trip to the exact captured snapshot. */
export function validateReportHTML(html: string, snapshot: ReportSnapshot) {
  ensure(
    Buffer.byteLength(html) <= maximumHTMLBytes && /<!doctype html>/i.test(html),
    "REPORT_HTML",
    "Invalid or oversized HTML artifact",
  );
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
  const data = scripts.find((m) => /\bid=["']?abracode-report-data(?:["'\s]|$)/i.test(m[1]!));
  ensure(
    data && JSON.stringify(JSON.parse(data[2]!)) === JSON.stringify(snapshot),
    "REPORT_HTML",
    "HTML does not retain the captured snapshot",
  );
  ensure(
    html.includes("abracode-license-notices"),
    "REPORT_HTML",
    "Required license notices are absent",
  );
  ensure(
    !scripts.some((m) => /\bsrc\s*=/i.test(m[1]!)),
    "REPORT_HTML",
    "Report scripts must be inline",
  );
  const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "");
  const resources = [
    ...markup.matchAll(
      /<(?:img|iframe|source|video|audio|image|use|feImage|link)\b[^>]*\b(?:src|href)\s*=\s*["']([^"']*)["']/gi,
    ),
  ];
  ensure(
    resources.every((m) => m[1]!.startsWith("data:") || m[1]!.startsWith("#")),
    "REPORT_HTML",
    "Report assets must be self-contained",
  );
  for (const style of markup.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) {
    ensure(
      !/@import\b/i.test(style[1]!) &&
        [...style[1]!.matchAll(/url\(\s*["']?([^)'"\s]+)/gi)].every(
          (m) => m[1]!.startsWith("data:") || m[1]!.startsWith("#"),
        ),
      "REPORT_HTML",
      "Report styles cannot require external assets",
    );
  }
}
export interface ReportRenderer {
  readonly fingerprint: Effect.Effect<ContentHash, CrewError>;
  render(snapshot: ReportSnapshot, expected: ContentHash): Effect.Effect<string, CrewError>;
}
const sourceFiles = [
  "snapshot-entry.tsx",
  "snapshot-report.tsx",
  "snapshot-data.ts",
  "snapshot-diagrams.ts",
  "styles.css",
  "mermaid-diagram.tsx",
  "mermaid.d.ts",
];

/** Only installed trusted TSX/config/plugins execute. Repository evidence is
 * copied as validated inert JSON and constrained Mermaid, never imports/code. */
export class ViteReportRenderer implements ReportRenderer {
  constructor(
    private home: AbsolutePath,
    private runner: Runner,
  ) {}
  fingerprint = domainEffect(
    Effect.gen({ self: this }, function* () {
      const template = join(this.home, "templates/reporter");
      const files = [
        "src/workflow/report-build.ts",
        "LICENSE",
        "pnpm-lock.yaml",
        "licenses/inventory.json",
        "templates/reporter/vite.config.ts",
        "templates/reporter/package.json",
        "templates/reporter/index.html",
        ...sourceFiles.map((p) => `templates/reporter/src/${p}`),
      ];
      for (const dir of ["components", "../scripts"]) {
        const path = resolve(template, "src", dir);
        for (const file of (yield* readdir(path)).sort())
          if (/\.(?:ts|tsx)$/.test(file))
            files.push(resolve(path, file).slice(this.home.length + 1));
      }
      const inventory = JSON.parse(
        yield* readFile(join(this.home, "licenses/inventory.json"), "utf8"),
      ) as { packages: Array<{ uses: string[]; evidence: Array<{ sha256: string }> }> };
      files.push(
        ...new Set(
          inventory.packages
            .filter((p) => p.uses.includes("report-artifact"))
            .flatMap((p) => p.evidence.map((e) => `licenses/texts/${e.sha256}.txt`)),
        ),
      );
      const hash = createHash("sha256");
      for (const path of [...new Set(files)].sort()) {
        hash.update(path);
        hash.update(yield* readFile(join(this.home, path), "utf8"));
      }
      return ContentHash.make(hash.digest("hex"));
    }),
  );
  render = Effect.fn("ReportRenderer.render")(
    function* (this: ViteReportRenderer, snapshot: ReportSnapshot, expected: ContentHash) {
      ensure(
        (yield* this.fingerprint) === expected,
        "REPORT_TEMPLATE",
        "Installed report template changed; use a new report request",
      );
      const template = AbsolutePath.make(join(this.home, "templates/reporter"));
      ensure(
        (yield* realpath(template)) === resolve(yield* realpath(this.home), "templates/reporter"),
        "REPORT_TEMPLATE",
        "Trusted report template cannot redirect outside the installation",
      );
      const parent = yield* reportDirectory(this.home, [".abracode", "reports", ".scratch"]);
      return yield* Effect.acquireUseRelease(
        Effect.gen(function* () {
          const directory = yield* mkdtemp(join(parent, "build-"));
          return { directory, stat: yield* lstat(directory) };
        }),
        ({ directory }) =>
          domainEffect(
            Effect.gen({ self: this }, function* () {
              yield* mkdir(join(directory, "src"));
              for (const file of sourceFiles)
                yield* copyFile(join(template, "src", file), join(directory, "src", file));
              yield* Effect.tryPromise({
                try: () =>
                  cp(join(template, "src/components"), join(directory, "src/components"), {
                    recursive: true,
                  }),
                catch: CrewError.from,
              });
              yield* Effect.tryPromise({
                try: () =>
                  symlink(join(template, "node_modules"), join(directory, "node_modules"), "dir"),
                catch: CrewError.from,
              });
              yield* writeFile(
                join(directory, "package.json"),
                JSON.stringify({ name: "abracode-report-build", private: true, type: "module" }),
                { flag: "wx" },
              );
              const diagrams = snapshot.diagrams ?? [];
              for (const [i, diagram] of diagrams.entries())
                yield* writeFile(
                  join(directory, "src", `snapshot-diagram-${i}.mmd`),
                  diagram.source,
                  { flag: "wx" },
                );
              yield* writeFile(
                join(directory, "src/snapshot-diagrams.ts"),
                `${diagrams.map((_, i) => `import diagram${i} from "./snapshot-diagram-${i}.mmd";`).join("\n")}\nexport const snapshotDiagrams = [${diagrams.map((_, i) => `diagram${i}`).join(",")}];\n`,
              );
              yield* writeFile(
                join(directory, "index.html"),
                (yield* readFile(join(template, "index.html"), "utf8"))
                  .replace("/src/main.tsx", "/src/snapshot-entry.tsx")
                  .replace(
                    "</body>",
                    `<script type="application/json" id="abracode-report-data">${snapshotJSON(snapshot)}</script>\n</body>`,
                  ),
                { flag: "wx" },
              );
              yield* writeFile(
                join(directory, "vite.config.mts"),
                `import {reportConfiguration} from ${JSON.stringify(join(template, "vite.config.ts"))};\nconst buildDeadline=setTimeout(()=>{process.stderr.write("Report build exceeded its 45 second deadline\\n");process.exit(124);},45000);buildDeadline.unref();
export default {...reportConfiguration({installationRoot:${JSON.stringify(this.home)},cacheDir:${JSON.stringify(join(directory, ".vite"))}}),root:${JSON.stringify(directory)},build:{sourcemap:false,modulePreload:false,outDir:${JSON.stringify(join(directory, "dist"))},emptyOutDir:true}};\n`,
                { flag: "wx" },
              );
              yield* this.runner.run(
                Executable.make(join(this.home, "node_modules/.bin/vp")),
                [
                  "build",
                  directory,
                  "--config",
                  join(directory, "vite.config.mts"),
                  "--configLoader",
                  "native",
                ],
                template,
                { NODE_ENV: "production" },
                { deadline_ms: 45000, max_output_bytes: 262144 },
              );
              ensure(
                JSON.stringify((yield* readdir(join(directory, "dist"))).sort()) ===
                  '["index.html"]',
                "REPORT_ASSETS",
                "Report output must contain one portable HTML file",
              );
              const path = join(directory, "dist/index.html"),
                stat = yield* lstat(path);
              ensure(
                stat.isFile() && !stat.isSymbolicLink() && stat.size <= maximumHTMLBytes,
                "REPORT_HTML",
                "Report output must be a bounded regular file",
              );
              const html = yield* readFile(path, "utf8");
              validateReportHTML(html, snapshot);
              ensure(
                (yield* this.fingerprint) === expected,
                "REPORT_TEMPLATE",
                "Template changed during the build; output was not published",
              );
              return html;
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
                  (yield* realpath(directory)) === directory,
                "REPORT_SCRATCH",
                "Scratch ownership changed; preserve it for inspection",
              );
              yield* rm(directory, { recursive: true, force: false });
            }),
          ).pipe(
            Effect.catch((error) => Effect.logWarning("Report scratch preserved", error.code)),
          ),
      );
    }.bind(this),
    domainEffect,
  );
}
