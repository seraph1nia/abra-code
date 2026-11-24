import { portableRendererABI as rendererABI } from "@abracode/contracts/presentation/report-export-contract";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, lstat as nodeLstat, realpath as nodeRealpath } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { Effect, Schema } from "effect";
import {
  NoticeInventorySchema,
  reportNoticeInputs,
} from "@abracode/contracts/presentation/notices";
import {
  AbsolutePath,
  ContentHash,
  Executable,
  LockKey,
  RelativePath,
} from "@abracode/contracts/identities";
import { CrewError, ensure } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { canonicalJSON } from "../presentation/identity.ts";
import { FileLocks } from "../storage/lock.ts";
import { lstat, mkdir, mkdtemp, readdir, realpath, rename, rm, writeFile } from "../filesystem.ts";
import type { Runner } from "../process.ts";
import {
  maximumHTMLBytes,
  reportDirectory,
  reportHash,
  validatePortableHTML,
} from "./report-build.ts";

export { portableRendererABI as rendererABI } from "@abracode/contracts/presentation/report-export-contract";
const Manifest = Schema.Struct({
  abi: Schema.Literal(rendererABI),
  inputs: Schema.Array(Schema.Struct({ file: RelativePath, hash: ContentHash })).check(
    Schema.isMaxLength(8192),
  ),
  links: Schema.Array(Schema.Tuple([RelativePath, RelativePath])).check(Schema.isMaxLength(8192)),
  notices_hash: ContentHash,
});
const Receipt = Schema.Struct({
  abi: Schema.Literal(rendererABI),
  fingerprint: ContentHash,
  html_hash: ContentHash,
  manifest_hash: ContentHash,
  engine_hash: ContentHash,
  host_hash: ContentHash,
  bytes: Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(maximumHTMLBytes)),
});
const Pointer = Schema.Struct({ fingerprint: ContentHash });
const ManifestJSON = Schema.fromJsonString(Manifest);
const ReceiptJSON = Schema.fromJsonString(Receipt);
const PointerJSON = Schema.fromJsonString(Pointer);
const NoticeInventoryJSON = Schema.fromJsonString(NoticeInventorySchema);

export type Shell = { fingerprint: ContentHash; html: string; engine: string; host: string };
const diagramFileLimit = 16 * 1024 * 1024;
const io = <A>(read: () => Promise<A>) => Effect.tryPromise({ try: read, catch: CrewError.from });

function decodeShellJSON<A>(
  codec: Schema.Codec<A, string>,
  text: string,
  message: string,
): Effect.Effect<A, CrewError> {
  return Schema.decodeEffect(codec, { reportInput: false })(text).pipe(
    Effect.mapError(() => new CrewError("REPORT_SHELL", message)),
  );
}

/** No-follow reads bound cache metadata and bytes before parsing or execution. */
async function bounded(path: string, maximum: number) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await file.stat();
    ensure(
      before.isFile() && before.size <= maximum,
      "REPORT_SHELL",
      "Renderer input/cache exceeds its regular-file bound",
    );
    const value = await file.readFile();
    const after = await file.stat();
    ensure(
      value.length <= maximum && before.size === after.size && before.mtimeMs === after.mtimeMs,
      "REPORT_SHELL",
      "Renderer input changed during capture",
    );
    return value;
  } finally {
    await file.close();
  }
}

const readBounded = (path: string, maximum: number) => io(() => bounded(path, maximum));
const readBoundedText = (path: string, maximum: number) =>
  readBounded(path, maximum).pipe(Effect.map((bytes) => bytes.toString("utf8")));

function evidence(manifest: string, html: string, engine: string, host: string) {
  const assets = {
    abi: rendererABI,
    manifest_hash: reportHash(manifest),
    html_hash: reportHash(html),
    engine_hash: reportHash(engine),
    host_hash: reportHash(host),
    bytes: Buffer.byteLength(html),
  };
  return { ...assets, fingerprint: reportHash(canonicalJSON(assets)) };
}

/** Preparation owns source discovery. Readers capture immutable assets from one active pointer. */
export class RendererShell {
  constructor(
    private home: AbsolutePath,
    private runner: Runner,
  ) {}

  private inputsCurrent(manifest: typeof Manifest.Type): Effect.Effect<boolean, CrewError> {
    return domainEffect(
      Effect.gen({ self: this }, function* () {
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
          ensure(
            names.has(RelativePath.make(required)),
            "REPORT_SHELL",
            "Renderer manifest lacks a required source input",
          );
        // Bound file descriptors and memory while overlapping independent filesystem reads.
        const current = yield* Effect.forEach(
          manifest.inputs,
          (input) =>
            domainEffect(
              Effect.gen(function* () {
                const path = resolve(home, input.file);
                const actual = yield* io(() => nodeRealpath(path).catch(() => undefined));
                if (actual !== path) return false;
                const stat = yield* lstat(path);
                bytes += stat.size;
                ensure(
                  bytes <= 128 * 1024 * 1024,
                  "REPORT_SHELL",
                  "Renderer inputs exceed 128 MiB",
                );
                const raw = yield* readBounded(path, 16 * 1024 * 1024);
                return (
                  ContentHash.make(createHash("sha256").update(raw).digest("hex")) === input.hash
                );
              }),
            ),
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
      }),
    );
  }

  private retained(
    root: string,
    fingerprint: ContentHash,
    sourceCheck: boolean,
  ): Effect.Effect<Shell | undefined, CrewError> {
    return domainEffect(
      Effect.gen({ self: this }, function* () {
        const directory = join(root, fingerprint);
        const info = yield* lstat(directory);
        ensure(
          info.isDirectory() &&
            !info.isSymbolicLink() &&
            (yield* realpath(directory)) === directory,
          "REPORT_SHELL",
          "Renderer cache directory changed ownership",
        );
        ensure(
          JSON.stringify((yield* readdir(directory)).sort()) ===
            '["diagram-engine.js","diagram-host.mjs","index.html","manifest.json","receipt.json"]',
          "REPORT_SHELL",
          "Renderer cache contains unexpected files",
        );
        const [manifest, html, engine, host, rawReceipt] = yield* Effect.all(
          [
            readBoundedText(join(directory, "manifest.json"), 2 * 1024 * 1024),
            readBoundedText(join(directory, "index.html"), maximumHTMLBytes),
            readBoundedText(join(directory, "diagram-engine.js"), diagramFileLimit),
            readBoundedText(join(directory, "diagram-host.mjs"), diagramFileLimit),
            readBoundedText(join(directory, "receipt.json"), 4096),
          ],
          { concurrency: "unbounded" },
        );
        const receipt = yield* decodeShellJSON(
          ReceiptJSON,
          rawReceipt,
          "Invalid or incompatible prepared renderer receipt. Run pnpm report:prepare or pnpm build.",
        );
        const expected = evidence(manifest, html, engine, host);
        ensure(
          expected.fingerprint === fingerprint &&
            canonicalJSON(receipt) === canonicalJSON(expected),
          "REPORT_SHELL",
          "Renderer bundle digest does not match its receipt",
        );
        validatePortableHTML(html);
        if (sourceCheck) {
          const decodedManifest = yield* decodeShellJSON(
            ManifestJSON,
            manifest,
            "Invalid or incompatible prepared renderer manifest. Run pnpm report:prepare or pnpm build.",
          );
          if (!(yield* this.inputsCurrent(decodedManifest))) return undefined;
        }
        return { fingerprint, html, engine, host };
      }),
    );
  }

  private pointer(root: string): Effect.Effect<ContentHash | undefined, CrewError> {
    return domainEffect(
      Effect.gen(function* () {
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
      }),
    );
  }

  private current(root: string, sourceCheck: boolean): Effect.Effect<Shell | undefined, CrewError> {
    return domainEffect(
      Effect.gen({ self: this }, function* () {
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
      }),
    );
  }

  acquire = domainEffect(
    Effect.gen({ self: this }, function* () {
      const root = yield* reportDirectory(this.home, [".abracode", "reports", "renderers", "v3"]);
      const selected = yield* this.current(root, false);
      ensure(
        selected,
        "REPORT_SHELL",
        "A compatible prepared renderer is required. Run pnpm report:prepare or pnpm build.",
      );
      return selected;
    }),
  );

  prepare = domainEffect(
    Effect.gen({ self: this }, function* () {
      const lockRoot = yield* reportDirectory(this.home, [".abracode", "locks"]);
      return yield* new FileLocks(lockRoot).with(
        LockKey.make("report-renderer-shell"),
        () =>
          domainEffect(
            Effect.gen({ self: this }, function* () {
              const root = yield* reportDirectory(this.home, [
                ".abracode",
                "reports",
                "renderers",
                "v3",
              ]);
              const current = yield* this.current(root, true);
              if (current) return current;
              const parent = yield* reportDirectory(this.home, [
                ".abracode",
                "reports",
                ".scratch",
              ]);
              return yield* Effect.acquireUseRelease(
                Effect.gen(function* () {
                  const directory = yield* mkdtemp(join(parent, "renderer-"));
                  return { directory, stat: yield* io(() => nodeLstat(directory)) };
                }),
                ({ directory }) =>
                  domainEffect(
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
                      ensure(
                        JSON.stringify((yield* readdir(output)).sort()) ===
                          '["diagram-engine.js","diagram-host.mjs","index.html","renderer-inputs.json"]',
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
                      const html = yield* readBoundedText(
                        join(output, "index.html"),
                        maximumHTMLBytes,
                      );
                      validatePortableHTML(html);
                      ensure(
                        !html.includes('id="abracode-report-document"'),
                        "REPORT_SHELL",
                        "Prepared shell must not retain document data",
                      );
                      ensure(
                        yield* this.inputsCurrent(manifest),
                        "REPORT_TEMPLATE",
                        "Renderer inputs changed during preparation",
                      );
                      const [engine, host] = yield* Effect.all(
                        [
                          readBoundedText(join(output, "diagram-engine.js"), diagramFileLimit),
                          readBoundedText(join(output, "diagram-host.mjs"), diagramFileLimit),
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
                      yield* writeFile(join(ready, "diagram-host.mjs"), shell.host, {
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
                      const names = (yield* readdir(root)).filter((name) =>
                        /^[a-f0-9]{64}$/.test(name),
                      );
                      const entries = yield* Effect.forEach(
                        names,
                        (name) =>
                          lstat(join(root, name)).pipe(Effect.map((stat) => ({ name, stat }))),
                        { concurrency: 8 },
                      );
                      for (const old of entries
                        .filter(
                          (entry) => entry.name !== active && entry.name !== shell.fingerprint,
                        )
                        .sort((a, b) => a.stat.mtime.getTime() - b.stat.mtime.getTime())
                        .slice(0, Math.max(0, entries.length - 8))) {
                        yield* this.retained(root, ContentHash.make(old.name), false);
                        yield* rm(join(root, old.name), { recursive: true, force: false });
                      }
                      const pointer = join(directory, "current.json");
                      yield* writeFile(
                        pointer,
                        JSON.stringify({ fingerprint: shell.fingerprint }),
                        { flag: "wx", mode: 0o600 },
                      );
                      yield* rename(pointer, join(root, "current.json"));
                      return {
                        fingerprint: shell.fingerprint,
                        html: shell.html,
                        engine: shell.engine,
                        host: shell.host,
                      };
                    }),
                  ),
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
          ),
        { waitSeconds: 60 },
      );
    }),
  );
}
