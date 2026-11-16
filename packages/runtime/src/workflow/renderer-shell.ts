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
  bytes: Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(maximumHTMLBytes)),
});
const Pointer = Schema.Struct({ fingerprint: ContentHash });
type Shell = { fingerprint: ContentHash; html: string };
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
function identity(manifest: typeof Manifest.Type, html: string) {
  return reportHash(`${rendererABI}\n${canonicalJSON(manifest)}\n${reportHash(html)}`);
}

/** Cross-process preparation is independent of document/artifact publication. */
export class RendererShell {
  private verified?: Shell;
  /** Reuse verified immutable bytes; render still revalidates source/cache before returning. */
  forDocument(expected: ContentHash): Effect.Effect<Shell, CrewError> {
    return Effect.suspend(() =>
      this.verified?.fingerprint === expected ? Effect.succeed(this.verified) : this.prepare,
    );
  }

  constructor(
    private home: AbsolutePath,
    private runner: Runner,
  ) {}
  private async inputsCurrent(manifest: typeof Manifest.Type) {
    const home = await realpath(this.home);
    let bytes = 0;
    const names = new Set(manifest.inputs.map((input) => input.file));
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
        '["index.html","manifest.json","receipt.json"]',
      "REPORT_SHELL",
      "Renderer cache contains unexpected files",
    );
    const manifest = Schema.decodeUnknownSync(Manifest)(
      JSON.parse(
        (await bounded(join(directory, "manifest.json"), 2 * 1024 * 1024)).toString("utf8"),
      ),
    );
    const receipt = Schema.decodeUnknownSync(Receipt)(
      JSON.parse((await bounded(join(directory, "receipt.json"), 4096)).toString("utf8")),
    );
    const html = (await bounded(join(directory, "index.html"), maximumHTMLBytes)).toString("utf8");
    ensure(
      receipt.fingerprint === fingerprint &&
        receipt.bytes === Buffer.byteLength(html) &&
        receipt.html_hash === reportHash(html) &&
        identity(manifest, html) === fingerprint,
      "REPORT_SHELL",
      "Renderer shell digest does not match its receipt",
    );
    validatePortableHTML(html);
    return !sourceCheck || (await this.inputsCurrent(manifest)) ? { fingerprint, html } : undefined;
  }
  private async current(root: string) {
    const pointer = join(root, "current.json");
    if (!(await lstat(pointer).catch(() => undefined))) return;
    const value = Schema.decodeUnknownSync(Pointer)(
      JSON.parse((await bounded(pointer, 4096)).toString("utf8")),
    );
    if (!(await lstat(join(root, value.fingerprint)).catch(() => undefined))) return;
    return this.retained(root, value.fingerprint, true);
  }
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
                "v2",
              ]);
              const current = yield* io(() => this.current(root));
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
                            '["index.html","renderer-inputs.json"]',
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
                        return { html, manifest, fingerprint: identity(manifest, html) };
                      });
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
                        .sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs)
                        .slice(0, Math.max(0, entries.length - 7))) {
                        yield* io(() => this.retained(root, ContentHash.make(old.name), false));
                        yield* rm(join(root, old.name), { recursive: true, force: false });
                      }
                      const ready = join(directory, "ready");
                      yield* mkdir(ready);
                      yield* writeFile(join(ready, "index.html"), shell.html, {
                        flag: "wx",
                        mode: 0o600,
                      });
                      yield* writeFile(
                        join(ready, "manifest.json"),
                        JSON.stringify(shell.manifest),
                        { flag: "wx", mode: 0o600 },
                      );
                      yield* writeFile(
                        join(ready, "receipt.json"),
                        JSON.stringify({
                          abi: rendererABI,
                          fingerprint: shell.fingerprint,
                          html_hash: reportHash(shell.html),
                          bytes: Buffer.byteLength(shell.html),
                        }),
                        { flag: "wx", mode: 0o600 },
                      );
                      const destination = join(root, shell.fingerprint);
                      const existing = yield* io(() => lstat(destination).catch(() => undefined));
                      if (existing) yield* io(() => this.retained(root, shell.fingerprint, true));
                      else yield* rename(ready, destination);
                      const pointer = join(directory, "current.json");
                      yield* writeFile(
                        pointer,
                        JSON.stringify({ fingerprint: shell.fingerprint }),
                        { flag: "wx", mode: 0o600 },
                      );
                      yield* rename(pointer, join(root, "current.json"));
                      return { fingerprint: shell.fingerprint, html: shell.html };
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
  ).pipe(
    Effect.tap((shell) =>
      Effect.sync(() => {
        this.verified = shell;
      }),
    ),
  );
}
