import { portableRendererABI as rendererABI } from "@abracode/contracts/presentation/report-export-contract";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, lstat, realpath, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { Effect, Schema } from "effect";
import { reportNoticeInputs, type NoticeInventory } from "@abracode/contracts/presentation/notices";
import { AbsolutePath, ContentHash, Executable, LockKey, RelativePath } from "../identities.ts";
import { CrewError, ensure } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { canonicalJSON } from "../presentation/identity.ts";
import { FileLocks } from "../storage/lock.ts";
import { mkdir, mkdtemp, rename, rm, writeFile } from "../filesystem.ts";
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
export type Shell = { fingerprint: ContentHash; html: string; engine: string; host: string };
const diagramFileLimit = 16 * 1024 * 1024;
const io = <A>(read: () => Promise<A>) => Effect.tryPromise({ try: read, catch: CrewError.from });

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
  private async inputsCurrent(manifest: typeof Manifest.Type) {
    const home = await realpath(this.home);
    let bytes = 0;
    const names = new Set(manifest.inputs.map((input) => input.file));
    const { rendererStyleInputs } = await import("@abracode/report-export/renderer-styles");
    if ((await rendererStyleInputs(home)).some((path) => !names.has(RelativePath.make(path))))
      return false;
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
    for (let offset = 0; offset < manifest.inputs.length; offset += 8) {
      const current = await Promise.all(
        manifest.inputs.slice(offset, offset + 8).map(async (input) => {
          const path = resolve(home, input.file);
          if ((await realpath(path).catch(() => undefined)) !== path) return false;
          const stat = await lstat(path);
          bytes += stat.size;
          ensure(bytes <= 128 * 1024 * 1024, "REPORT_SHELL", "Renderer inputs exceed 128 MiB");
          return (
            ContentHash.make(
              createHash("sha256")
                .update(await bounded(path, 16 * 1024 * 1024))
                .digest("hex"),
            ) === input.hash
          );
        }),
      );
      if (current.some((valid) => !valid)) return false;
    }
    for (const [link, target] of manifest.links)
      if ((await realpath(resolve(home, link)).catch(() => undefined)) !== resolve(home, target))
        return false;
    const inventory = JSON.parse(
      (await bounded(join(home, "licenses/inventory.json"), 16 * 1024 * 1024)).toString("utf8"),
    ) as NoticeInventory;
    return reportHash(JSON.stringify(reportNoticeInputs(inventory))) === manifest.notices_hash;
  }
  private async retained(
    root: string,
    fingerprint: ContentHash,
    sourceCheck: boolean,
  ): Promise<Shell | undefined> {
    const directory = join(root, fingerprint),
      info = await lstat(directory);
    ensure(
      info.isDirectory() && !info.isSymbolicLink() && (await realpath(directory)) === directory,
      "REPORT_SHELL",
      "Renderer cache directory changed ownership",
    );
    ensure(
      JSON.stringify((await readdir(directory)).sort()) ===
        '["diagram-engine.js","diagram-host.mjs","index.html","manifest.json","receipt.json"]',
      "REPORT_SHELL",
      "Renderer cache contains unexpected files",
    );
    const read = async (name: string, limit: number) =>
      (await bounded(join(directory, name), limit)).toString("utf8");
    const [manifest, html, engine, host, rawReceipt] = await Promise.all([
      read("manifest.json", 2 * 1024 * 1024),
      read("index.html", maximumHTMLBytes),
      read("diagram-engine.js", diagramFileLimit),
      read("diagram-host.mjs", diagramFileLimit),
      read("receipt.json", 4096),
    ]);
    const decoded = Schema.decodeUnknownResult(Receipt)(JSON.parse(rawReceipt));
    ensure(
      decoded._tag === "Success",
      "REPORT_SHELL",
      "Invalid or incompatible prepared renderer receipt. Run pnpm report:prepare or pnpm build.",
    );
    const receipt = decoded.success;
    const expected = evidence(manifest, html, engine, host);
    ensure(
      expected.fingerprint === fingerprint && canonicalJSON(receipt) === canonicalJSON(expected),
      "REPORT_SHELL",
      "Renderer bundle digest does not match its receipt",
    );
    validatePortableHTML(html);
    if (
      sourceCheck &&
      !(await this.inputsCurrent(Schema.decodeUnknownSync(Manifest)(JSON.parse(manifest))))
    )
      return;
    return { fingerprint, html, engine, host };
  }
  private async pointer(root: string) {
    const pointer = join(root, "current.json");
    try {
      return Schema.decodeUnknownSync(Pointer)(
        JSON.parse((await bounded(pointer, 4096)).toString("utf8")),
      ).fingerprint;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
      throw error;
    }
  }
  private async current(root: string, sourceCheck: boolean) {
    const fingerprint = await this.pointer(root);
    if (!fingerprint) return;
    try {
      return await this.retained(root, fingerprint, sourceCheck);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        const newer = await this.pointer(root);
        if (newer && newer !== fingerprint) return this.retained(root, newer, sourceCheck);
        if (sourceCheck) return;
        throw new CrewError(
          "REPORT_SHELL",
          "Prepared renderer is incomplete. Run pnpm report:prepare or pnpm build.",
        );
      }
      throw error;
    }
  }
  acquire = domainEffect(
    Effect.gen({ self: this }, function* () {
      const root = yield* reportDirectory(this.home, [".abracode", "reports", "renderers", "v3"]);
      const selected = yield* io(() => this.current(root, false));
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
              const current = yield* io(() => this.current(root, true));
              if (current) return current;
              const parent = yield* reportDirectory(this.home, [
                ".abracode",
                "reports",
                ".scratch",
              ]);
              return yield* Effect.acquireUseRelease(
                Effect.gen(function* () {
                  const directory = yield* mkdtemp(join(parent, "renderer-"));
                  return { directory, stat: yield* io(() => lstat(directory)) };
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
                      const shell = yield* io(async () => {
                        const output = join(directory, "dist");
                        ensure(
                          JSON.stringify((await readdir(output)).sort()) ===
                            '["diagram-engine.js","diagram-host.mjs","index.html","renderer-inputs.json"]',
                          "REPORT_ASSETS",
                          "Prepared renderer must contain one shell and its input manifest",
                        );
                        const manifest = Schema.decodeUnknownSync(Manifest)(
                          JSON.parse(
                            (
                              await bounded(join(output, "renderer-inputs.json"), 2 * 1024 * 1024)
                            ).toString("utf8"),
                          ),
                        );
                        const html = (
                          await bounded(join(output, "index.html"), maximumHTMLBytes)
                        ).toString("utf8");
                        validatePortableHTML(html);
                        ensure(
                          !html.includes('id="abracode-report-document"'),
                          "REPORT_SHELL",
                          "Prepared shell must not retain document data",
                        );
                        ensure(
                          await this.inputsCurrent(manifest),
                          "REPORT_TEMPLATE",
                          "Renderer inputs changed during preparation",
                        );
                        const engine = (
                          await bounded(join(output, "diagram-engine.js"), diagramFileLimit)
                        ).toString("utf8");
                        const host = (
                          await bounded(join(output, "diagram-host.mjs"), diagramFileLimit)
                        ).toString("utf8");
                        const manifestText = JSON.stringify(manifest);
                        const receipt = evidence(manifestText, html, engine, host);
                        return {
                          html,
                          engine,
                          host,
                          manifest: manifestText,
                          receipt,
                          fingerprint: receipt.fingerprint,
                        };
                      });
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
                      const existing = yield* io(() => lstat(destination).catch(() => undefined));
                      if (!existing) yield* rename(ready, destination);
                      yield* io(() => this.retained(root, shell.fingerprint, false));

                      const active = yield* io(() => this.pointer(root));
                      // Retain at most eight complete identities; prior exports contain their own bytes.
                      const entries = yield* io(async () => {
                        const names = (await readdir(root)).filter((name) =>
                          /^[a-f0-9]{64}$/.test(name),
                        );
                        return Promise.all(
                          names.map(async (name) => ({
                            name,
                            stat: await lstat(join(root, name)),
                          })),
                        );
                      });
                      for (const old of entries
                        .filter(
                          (entry) => entry.name !== active && entry.name !== shell.fingerprint,
                        )
                        .sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs)
                        .slice(0, Math.max(0, entries.length - 8))) {
                        yield* io(() => this.retained(root, ContentHash.make(old.name), false));
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
                    const current = await lstat(directory);
                    ensure(
                      current.isDirectory() &&
                        !current.isSymbolicLink() &&
                        current.dev === stat.dev &&
                        current.ino === stat.ino &&
                        (await realpath(directory)) === directory &&
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
