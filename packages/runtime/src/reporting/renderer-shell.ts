import { sha256 } from "../digest.ts";
import { tryDomainValue } from "../effect.ts";
import { lstat as nodeLstat, realpath as nodeRealpath } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { Effect, Option } from "effect";
import { reportNoticeInputs } from "@abracode/contracts/presentation/notices";
import {
  AbsolutePath,
  ContentHash,
  Executable,
  LockKey,
  RelativePath,
} from "@abracode/contracts/identities";
import { CrewError, ensure } from "../domain.ts";
import { FileLocks } from "../storage/lock.ts";
import {
  lstat,
  mkdir,
  temporaryDirectory,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "../filesystem.ts";
import type { Runner } from "../process.ts";
import {
  maximumHTMLBytes,
  reportDirectory,
  reportHash,
  validatePortableHTML,
} from "./report-build.ts";
import {
  Manifest,
  ManifestJSON,
  readPreparedBundle,
  PointerJSON,
  NoticeInventoryJSON,
  diagramFileLimit,
  io,
  decodeShellJSON,
  readBounded,
  readBoundedText,
  evidence,
  type Shell,
} from "./renderer-evidence.ts";
export type { Shell } from "./renderer-evidence.ts";
export { portableRendererABI as rendererABI } from "@abracode/contracts/presentation/report-export-contract";
/** Preparation owns source discovery. Readers capture immutable assets from one active pointer. */
export class RendererShell {
  constructor(
    private home: AbsolutePath,
    private runner: Runner,
  ) {}

  private inputsCurrent(manifest: typeof Manifest.Type): Effect.Effect<boolean, CrewError> {
    return Effect.gen({ self: this }, function* () {
      const home = yield* realpath(this.home);
      let bytes = 0;
      const names = new Set(manifest.inputs.map((input) => input.file));
      const { rendererStyleInputs } = yield* io(
        () => import("@abracode/report-export/renderer-styles"),
      );
      const styleInputs = yield* io(() => rendererStyleInputs(home));
      if (styleInputs.some((path) => !names.has(RelativePath.make(path)))) return false;
      for (const required of [
        "apps/report/src/main.tsx",
        "apps/report/index.html",
        "apps/report/vite.config.ts",
        "apps/report/scripts/renderer-manifest.ts",
      ])
        if (!names.has(RelativePath.make(required)))
          return yield* new CrewError(
            "REPORT_SHELL",
            "Renderer manifest lacks a required source input",
          );
      // Bound file descriptors and memory while overlapping independent filesystem reads.
      const current = yield* Effect.forEach(
        manifest.inputs,
        (input) =>
          Effect.gen(function* () {
            const path = resolve(home, input.file);
            const actual = yield* io(() => nodeRealpath(path).catch(() => undefined));
            if (actual !== path) return false;
            const stat = yield* lstat(path);
            bytes += Number(stat.size);
            if (!(bytes <= 128 * 1024 * 1024))
              return yield* new CrewError("REPORT_SHELL", "Renderer inputs exceed 128 MiB");
            const raw = yield* readBounded(path, 16 * 1024 * 1024);
            return ContentHash.make(sha256(raw)) === input.hash;
          }),
        { concurrency: 8 },
      );
      if (current.some((valid) => !valid)) return false;
      const linksCurrent = yield* Effect.forEach(
        manifest.links,
        ([linkPath, target]) =>
          io(() => nodeRealpath(resolve(home, linkPath)).catch(() => undefined)).pipe(
            Effect.map((actual) => actual === resolve(home, target)),
          ),
        { concurrency: 8 },
      );
      if (linksCurrent.some((valid) => !valid)) return false;
      const rawInventory = yield* readBoundedText(
        join(home, "licenses/inventory.json"),
        16 * 1024 * 1024,
      );
      const inventory = yield* decodeShellJSON(
        NoticeInventoryJSON,
        rawInventory,
        "Invalid license notice inventory.",
      );
      return reportHash(JSON.stringify(reportNoticeInputs(inventory))) === manifest.notices_hash;
    });
  }

  private retained(
    root: string,
    fingerprint: ContentHash,
    sourceCheck: boolean,
  ): Effect.Effect<Shell | undefined, CrewError> {
    return Effect.gen({ self: this }, function* () {
      const { manifest, html, engine, host } = yield* io(() =>
        readPreparedBundle(root, fingerprint),
      );
      yield* tryDomainValue(validatePortableHTML, html);
      if (sourceCheck) {
        const decodedManifest = yield* decodeShellJSON(
          ManifestJSON,
          manifest,
          "Invalid or incompatible prepared renderer manifest. Run pnpm report:prepare or pnpm build.",
        );
        if (!(yield* this.inputsCurrent(decodedManifest))) return undefined;
      }
      return { fingerprint, html, engine, host };
    });
  }

  private pointer(root: string): Effect.Effect<ContentHash | undefined, CrewError> {
    return Effect.gen(function* () {
      const raw = yield* readBoundedText(join(root, "current.json"), 4096).pipe(
        Effect.catchIf(
          (error) => error.code === "ENOENT",
          () => Effect.undefined,
        ),
      );
      if (raw === undefined) return undefined;
      const decoded = yield* decodeShellJSON(
        PointerJSON,
        raw,
        "Invalid prepared renderer pointer. Run pnpm report:prepare or pnpm build.",
      );
      return decoded.fingerprint;
    });
  }

  private current(root: string, sourceCheck: boolean): Effect.Effect<Shell | undefined, CrewError> {
    return Effect.gen({ self: this }, function* () {
      const fingerprint = yield* this.pointer(root);
      if (!fingerprint) return undefined;
      return yield* this.retained(root, fingerprint, sourceCheck).pipe(
        Effect.catchIf(
          (error) => error.code === "ENOENT",
          () =>
            Effect.gen({ self: this }, function* () {
              const newer = yield* this.pointer(root);
              if (newer && newer !== fingerprint)
                return yield* this.retained(root, newer, sourceCheck);
              if (sourceCheck) return undefined;
              return yield* new CrewError(
                "REPORT_SHELL",
                "Prepared renderer is incomplete. Run pnpm report:prepare or pnpm build.",
              );
            }),
        ),
      );
    });
  }

  acquire = Effect.gen({ self: this }, function* () {
    const root = yield* reportDirectory(this.home, [".abracode", "reports", "renderers", "v4"]);
    const selected = yield* this.current(root, false);
    if (!selected)
      return yield* new CrewError(
        "REPORT_SHELL",
        "A compatible prepared renderer is required. Run pnpm report:prepare or pnpm build.",
      );
    return selected;
  });

  prepare = Effect.gen({ self: this }, function* () {
    const lockRoot = yield* reportDirectory(this.home, [".abracode", "locks"]);
    return yield* new FileLocks(lockRoot).with(
      LockKey.make("report-renderer-shell"),
      () =>
        Effect.gen({ self: this }, function* () {
          const root = yield* reportDirectory(this.home, [
            ".abracode",
            "reports",
            "renderers",
            "v4",
          ]);
          const current = yield* this.current(root, true);
          if (current) return current;
          const parent = yield* reportDirectory(this.home, [".abracode", "reports", ".scratch"]);
          return yield* Effect.acquireUseRelease(
            Effect.gen(function* () {
              const directory = yield* temporaryDirectory(parent, "renderer-");
              return { directory, stat: yield* io(() => nodeLstat(directory)) };
            }),
            ({ directory }) =>
              Effect.gen({ self: this }, function* () {
                const config = join(directory, "vite.config.mts");
                yield* writeFile(
                  config,
                  `import {exportConfiguration} from ${JSON.stringify(join(this.home, "apps/report/vite.config.ts"))};\nconst deadline=setTimeout(()=>process.exit(124),45000);deadline.unref();\nexport default {...exportConfiguration({installationRoot:${JSON.stringify(this.home)},cacheDir:${JSON.stringify(join(directory, ".vite"))},portableShell:true}),root:${JSON.stringify(join(this.home, "apps/report"))},build:{sourcemap:false,modulePreload:false,outDir:${JSON.stringify(join(directory, "dist"))},emptyOutDir:true}};\n`,
                  { flag: "wx" },
                );
                yield* this.runner.run(
                  Executable.make(join(this.home, "node_modules/.bin/vp")),
                  [
                    "build",
                    join(this.home, "apps/report"),
                    "--config",
                    config,
                    "--configLoader",
                    "native",
                  ],
                  this.home,
                  { NODE_ENV: "production" },
                  { deadline_ms: 45000, max_output_bytes: 262144 },
                );
                const output = join(directory, "dist");
                if (
                  JSON.stringify((yield* readdir(output)).sort()) !==
                  '["diagram-engine.js","diagram-host.cjs","index.html","renderer-inputs.json"]'
                )
                  return yield* new CrewError(
                    "REPORT_ASSETS",
                    "Prepared renderer must contain one shell and its input manifest",
                  );
                const rawManifest = yield* readBoundedText(
                  join(output, "renderer-inputs.json"),
                  2 * 1024 * 1024,
                );
                const manifest = yield* decodeShellJSON(
                  ManifestJSON,
                  rawManifest,
                  "Invalid prepared renderer manifest.",
                );
                const html = yield* readBoundedText(join(output, "index.html"), maximumHTMLBytes);
                yield* tryDomainValue(validatePortableHTML, html);
                if (html.includes('id="abracode-report-document"'))
                  return yield* new CrewError(
                    "REPORT_SHELL",
                    "Prepared shell must not retain document data",
                  );
                if (!(yield* this.inputsCurrent(manifest)))
                  return yield* new CrewError(
                    "REPORT_TEMPLATE",
                    "Renderer inputs changed during preparation",
                  );
                const [engine, host] = yield* Effect.all(
                  [
                    readBoundedText(join(output, "diagram-engine.js"), diagramFileLimit),
                    readBoundedText(join(output, "diagram-host.cjs"), diagramFileLimit),
                  ],
                  { concurrency: "unbounded" },
                );
                const manifestText = JSON.stringify(manifest);
                const receipt = evidence(manifestText, html, engine, host);
                const shell = {
                  html,
                  engine,
                  host,
                  manifest: manifestText,
                  receipt,
                  fingerprint: receipt.fingerprint,
                };
                const ready = join(directory, "ready");
                yield* mkdir(ready);
                yield* writeFile(join(ready, "index.html"), shell.html, {
                  flag: "wx",
                  mode: 0o600,
                });
                yield* writeFile(join(ready, "manifest.json"), shell.manifest, {
                  flag: "wx",
                  mode: 0o600,
                });
                yield* writeFile(join(ready, "receipt.json"), JSON.stringify(shell.receipt), {
                  flag: "wx",
                  mode: 0o600,
                });
                yield* writeFile(join(ready, "diagram-engine.js"), shell.engine, {
                  flag: "wx",
                  mode: 0o600,
                });
                yield* writeFile(join(ready, "diagram-host.cjs"), shell.host, {
                  flag: "wx",
                  mode: 0o600,
                });
                const destination = join(root, shell.fingerprint);
                const existing = yield* lstat(destination).pipe(
                  Effect.catchIf(
                    (error) => error.code === "ENOENT",
                    () => Effect.undefined,
                  ),
                );
                if (!existing) yield* rename(ready, destination);
                yield* this.retained(root, shell.fingerprint, false);

                const active = yield* this.pointer(root);
                // Retain at most eight complete identities; prior exports contain their own bytes.
                const names = (yield* readdir(root)).filter((name) => /^[a-f0-9]{64}$/.test(name));
                const entries = yield* Effect.forEach(
                  names,
                  (name) => lstat(join(root, name)).pipe(Effect.map((stat) => ({ name, stat }))),
                  { concurrency: 8 },
                );
                for (const old of entries
                  .filter((entry) => entry.name !== active && entry.name !== shell.fingerprint)
                  .sort(
                    (a, b) =>
                      (Option.getOrUndefined(a.stat.mtime)?.getTime() ?? 0) -
                      (Option.getOrUndefined(b.stat.mtime)?.getTime() ?? 0),
                  )
                  .slice(0, Math.max(0, entries.length - 8))) {
                  yield* this.retained(root, ContentHash.make(old.name), false);
                  yield* rm(join(root, old.name), { recursive: true, force: false });
                }
                const pointer = join(directory, "current.json");
                yield* writeFile(pointer, JSON.stringify({ fingerprint: shell.fingerprint }), {
                  flag: "wx",
                  mode: 0o600,
                });
                yield* rename(pointer, join(root, "current.json"));
                return {
                  fingerprint: shell.fingerprint,
                  html: shell.html,
                  engine: shell.engine,
                  host: shell.host,
                };
              }),
            ({ directory, stat }) =>
              io(async () => {
                const current = await nodeLstat(directory);
                ensure(
                  current.isDirectory() &&
                    !current.isSymbolicLink() &&
                    current.dev === stat.dev &&
                    current.ino === stat.ino &&
                    (await nodeRealpath(directory)) === directory &&
                    !relative(parent, directory).startsWith(".."),
                  "REPORT_SCRATCH",
                  "Renderer scratch ownership changed",
                );
              }).pipe(
                Effect.andThen(rm(directory, { recursive: true, force: false })),
                Effect.catch((error) =>
                  Effect.logWarning("Renderer scratch preserved", error.code),
                ),
              ),
          );
        }),
      { waitSeconds: 60 },
    );
  });
}
