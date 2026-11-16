import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { cp, symlink, readdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve, join } from "node:path";
import { Effect } from "effect";
import { fixture } from "../fixtures.ts";
import { run } from "../effects.ts";
import { ProcessRunner, type Runner } from "../../src/process.ts";
import { ReactDocumentRenderer } from "../../src/workflow/report-export.ts";
import { ReportExports } from "../../src/workflow/report-exports.ts";
import { Reports } from "../../src/workflow/reports.ts";
import * as Id from "../../src/identities.ts";
import { launchReportBrowser } from "../../apps/report/scripts/browser.ts";

test(
  "concurrent exports consume exact saved JSON and isolate trusted builds, caches and output",
  { timeout: 120000 },
  async (t) => {
    const f = await run(fixture);
    t.onTestFinished(() => run(f.close()));
    for (const path of [
      "package.json",
      "pnpm-lock.yaml",
      "LICENSE",
      "licenses",
      "src",
      "apps/report",
      "apps/web/src",
      "apps/web/tsconfig.json",
    ])
      await cp(resolve(path), join(f.config.home, path), {
        recursive: true,
        filter: (path) => !/\/(?:node_modules|dist|\.vite)(?:\/|$)/.test(path),
      });
    for (const path of ["node_modules", "apps/report/node_modules", "apps/web/node_modules"])
      await symlink(resolve(path), join(f.config.home, path), "dir");
    const parent = Id.SessionId.make("ses_concurrent-json"),
      issue = Id.IssueId.make("concurrent-report");
    f.work.add(issue);
    const hostile =
      '</ScRiPt><script>globalThis.reportExecuted=true</script><img src="https://example.invalid/asset">';
    f.work.issues.get(issue)!.title = hostile;
    await run(f.controller.recordSupervisor(parent));
    await run(f.controller.start(issue, parent));
    const reports = new Reports(f.config.home, f.records, f.git, f.locks, f.work, (...args) =>
      f.runtime.notify(...args),
    );
    const docs = await Promise.all(
      ["first-json", "second-json"].map((id) =>
        run(
          reports.generate(parent, issue, {
            request_id: Id.RequestId.make(id),
            diagrams: [{ title: "Saved flow", source: "flowchart LR\n A --> B" }],
          }),
        ),
      ),
    );
    let active = 0,
      peak = 0;
    const roots: string[] = [];
    const native = new ProcessRunner();
    const runner: Runner = {
      run: (file, args, cwd, env, options) =>
        Effect.acquireUseRelease(
          Effect.sync(() => {
            active++;
            peak = Math.max(peak, active);
            roots.push(args[1]!);
            assert.equal(options?.deadline_ms, 45000);
            assert.equal(options?.max_output_bytes, 262144);
          }),
          () => native.run(file, args, cwd, env, options),
          () =>
            Effect.sync(() => {
              active--;
            }),
        ),
    };
    const renderer = new ReactDocumentRenderer(f.config.home, runner),
      owner = new ReportExports(f.config.home, f.locks, renderer);
    const exported = await Promise.all(
      docs.map((doc) =>
        run(
          reports
            .readDocument(issue, doc.request.request_id, doc.artifact!.hash)
            .pipe(Effect.flatMap((a) => owner.create(a.json, a.hash))),
        ),
      ),
    );
    assert.equal(peak, 2);
    assert.equal(new Set(roots).size, 2);
    assert.notEqual(exported[0]!.document_hash, exported[1]!.document_hash);
    assert.deepEqual(await readdir(join(f.config.home, ".abracode/reports/.scratch")), []);
    const browser = await launchReportBrowser();
    t.onTestFinished(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 375, height: 812 }, offline: true });
    const outer = join(f.root, "portable-frame.html"),
      escaped = exported[0]!.html
        .replaceAll("&", "&amp;")
        .replaceAll('"', "&quot;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
    await writeFile(
      outer,
      `<!doctype html><meta charset="UTF-8"><iframe title="Isolated report" sandbox="allow-scripts" style="width:100%;height:800px;border:0" srcdoc="${escaped}"></iframe>`,
    );
    await page.goto(pathToFileURL(outer).href);
    const report = page.frameLocator("iframe");
    await report.getByRole("heading", { name: hostile, exact: true }).first().waitFor();
    assert.equal(await report.locator("img").count(), 0);
    assert.equal(
      await report.locator('[data-diagram-state="ready"] svg').count(),
      docs[0]!.snapshot.diagrams?.length,
    );
    assert.equal(
      await page.frames()[1]!.evaluate(() => Reflect.get(globalThis, "reportExecuted")),
      undefined,
    );
  },
);
