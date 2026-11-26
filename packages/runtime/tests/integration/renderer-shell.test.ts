import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import {
  appendFile,
  rename,
  readFile,
  writeFile,
  mkdir,
  readdir,
  symlink,
  rm,
} from "node:fs/promises";
import { join, dirname } from "node:path";
import { Effect } from "effect";
import { CrewError } from "../../src/domain.ts";
import { RequestId, AbsolutePath } from "@abracode/contracts/identities";
import { fixture } from "../fixtures.ts";
import { run } from "../effects.ts";
import { installSource } from "../e2e/install.ts";
import { reportDocument } from "../helpers/report-document.ts";
import { ProcessRunner, type Runner } from "../../src/process.ts";
import { ReactDocumentRenderer, validateDocumentHTML } from "../../src/reporting/report-export.ts";

/** No browser/native journey: exercise real compiler preparation and persisted reuse. */
test(
  "distinct concurrent documents share one prepared application and identity excludes unrelated inputs",
  { timeout: 120000 },
  async (t) => {
    const f = await run(fixture);
    t.onTestFinished(() => run(f.close()));
    const home = AbsolutePath.make(join(f.config.home, ".abracode/worktrees/renderer-install"));
    await mkdir(home, { recursive: true });
    await installSource(home, { buildWeb: false });
    const visible = "packages/presentation/src/.abracode-other/visible.ts";
    const metadata = "packages/presentation/src/.abracode/metadata.ts";
    for (const file of [visible, metadata]) {
      await mkdir(dirname(join(home, file)), { recursive: true });
      await writeFile(join(home, file), "export const fixture = true;\n");
    }
    let builds = 0;
    let interrupt = true;
    const actual = new ProcessRunner();
    const runner: Runner = {
      run: (file, args, cwd, env, options) => {
        if (file.endsWith("/vp") && args[0] === "build") {
          if (interrupt) {
            interrupt = false;
            const scratch = dirname(args[args.indexOf("--config") + 1]!);
            return Effect.tryPromise({
              try: async () => {
                await mkdir(join(scratch, "dist"));
                await writeFile(join(scratch, "dist/index.html"), "partial compiler output");
                throw new CrewError("PREP_INTERRUPTED", "Interrupted renderer preparation");
              },
              catch: CrewError.from,
            });
          }
          builds++;
        }
        return actual.run(file, args, cwd, env, options);
      },
    };
    const a = new ReactDocumentRenderer(home, runner),
      b = new ReactDocumentRenderer(home, runner);
    await assert.rejects(run(a.acquire), /pnpm report:prepare/);
    await assert.rejects(run(a.prepare), /Interrupted renderer preparation/);
    assert.deepEqual(await readdir(join(home, ".abracode/reports/renderers/v4")), []);
    assert.deepEqual(await readdir(join(home, ".abracode/reports/.scratch")), []);
    const [first, parallel] = await Promise.all([run(a.prepare), run(b.prepare)]);
    assert.equal(first, parallel);
    const manifest = JSON.parse(
      await readFile(join(home, ".abracode/reports/renderers/v4", first, "manifest.json"), "utf8"),
    );
    assert.ok(manifest.inputs.some((i: { file: string }) => i.file === visible));
    assert.ok(!manifest.inputs.some((i: { file: string }) => i.file === metadata));
    assert.equal(builds, 1);
    const captured = reportDocument();
    const one = {
      ...captured,
      data: { ...captured.data, evidence: { ...captured.data.evidence!, diagrams: [] } },
    };
    const two = {
      ...one,
      document_id: RequestId.make("second-frozen-report"),
      title: "</script><script>globalThis.executed=true</script>\u2028\u2029",
    };
    const pinned = await run(a.acquire);
    const other = await run(b.acquire);
    const [htmlOne, htmlTwo] = await Promise.all([run(pinned.render(one)), run(other.render(two))]);
    validateDocumentHTML(htmlOne, one);
    const atLimit = htmlOne + " ".repeat(8 * 1024 * 1024 - Buffer.byteLength(htmlOne));
    validateDocumentHTML(atLimit, one);
    assert.throws(() => validateDocumentHTML(atLimit + " ", one), /oversized HTML/);

    validateDocumentHTML(htmlTwo, two);
    assert.equal(builds, 1, "Second document must perform no application compilation");
    assert.notEqual(htmlOne, htmlTwo);
    assert.ok(!htmlTwo.includes("<script>globalThis.executed=true</script>"));
    await appendFile(
      join(home, "packages/runtime/src/workflow/advancement.ts"),
      "\n// Unrelated backend change\n",
    );
    await appendFile(join(home, "pnpm-lock.yaml"), "\n# Unrelated lock metadata\n");
    assert.equal(await run(new ReactDocumentRenderer(home, runner).prepare), first);
    assert.equal(builds, 1);
    await appendFile(
      join(home, "packages/presentation/src/report-evidence.tsx"),
      "\n// Renderer input changed\n",
    );
    assert.equal((await run(a.acquire)).fingerprint, first);
    assert.equal(await run(pinned.render(one)), htmlOne);
    const enginePath = join(home, "apps/report/scripts/mermaid-engine.ts");
    const originalEngine = await readFile(enginePath, "utf8");
    await writeFile(
      enginePath,
      originalEngine.replace(
        "return host.innerHTML;",
        'return host.innerHTML.replace("<svg ", \'<svg data-prepared-version="two" \');',
      ),
    );
    const oldDiagram = await run((await run(a.acquire)).render(captured));
    assert.ok(!oldDiagram.includes("data-prepared-version"));
    interrupt = true;
    await assert.rejects(run(a.prepare), /Interrupted renderer preparation/);
    assert.equal((await run(a.acquire)).fingerprint, first);
    const changed = await run(a.prepare);
    assert.notEqual(changed, first);
    assert.equal(builds, 2);
    const firstDirectory = join(home, ".abracode/reports/renderers/v4", first);
    await rm(firstDirectory, { recursive: true });
    assert.equal(await run(pinned.render(one)), htmlOne, "An in-flight export survives eviction");
    const evictedDiagram = await run(other.render(captured));
    validateDocumentHTML(evictedDiagram, captured);
    assert.ok(
      !evictedDiagram.includes("data-prepared-version"),
      "First diagram use after eviction uses captured host and engine bytes",
    );
    await appendFile(join(home, "LICENSE"), "\nChanged required notice input.\n");
    const noticeChanged = await run(a.prepare);
    assert.notEqual(noticeChanged, changed);
    assert.equal(builds, 3);
    // Remove the live rendering packages and source tree before exporting fresh diagram bytes.
    await rename(join(home, "apps/report"), join(home, "apps/hidden-report"));
    const installed = await run(a.acquire);
    assert.equal(installed.fingerprint, noticeChanged);
    const updatedDiagram = await run(installed.render(captured));
    validateDocumentHTML(updatedDiagram, captured);
    assert.ok(updatedDiagram.includes("data-prepared-version"));
    await rename(join(home, "apps/hidden-report"), join(home, "apps/report"));
    const dir = join(home, ".abracode/reports/renderers/v4", noticeChanged);
    const engine = join(dir, "diagram-engine.js");
    const receiptPath = join(dir, "receipt.json");
    const receipt = await readFile(receiptPath, "utf8");
    await writeFile(
      receiptPath,
      JSON.stringify({ ...JSON.parse(receipt), abi: "previous-format" }),
    );
    await assert.rejects(run(a.acquire), /incompatible.*report:prepare/);
    await writeFile(receiptPath, receipt);
    const backup = join(f.root, "engine-original");
    await rename(engine, backup);
    await symlink(backup, engine);
    await assert.rejects(run(a.acquire));
    await rm(engine);
    await rename(backup, engine);
    const cache = join(dir, "diagram-host.cjs");
    await writeFile(cache, "tampered");
    await assert.rejects(run(a.acquire), /digest/);
    assert.equal(await readFile(cache, "utf8"), "tampered");
    const outside = join(f.root, "outside-renderer.ts");
    await writeFile(outside, "preserved outside source");
    await symlink(outside, join(home, "packages/presentation/src/escape.ts"));
    await rm(join(home, ".abracode/reports/renderers/v4"), { recursive: true });
    await assert.rejects(run(a.prepare), /symlinks|escapes/);
    assert.equal(await readFile(outside, "utf8"), "preserved outside source");
  },
);
