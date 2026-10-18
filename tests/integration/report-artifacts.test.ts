import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { cp, symlink, readFile, readdir, mkdir, copyFile, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Effect } from "effect";
import * as Id from "../../src/identities.ts";
import { Reports } from "../../src/workflow/reports.ts";
import { ViteReportRenderer } from "../../src/workflow/report-build.ts";
import { ProcessRunner, type Runner } from "../../src/process.ts";
import { launchReportBrowser } from "../../templates/reporter/scripts/browser.ts";
import { fixture } from "../fixtures.ts";
import { run } from "../effects.ts";

test(
  "concurrent controller Vite builds isolate source/caches/output and retain movable offline sandbox reports",
  { timeout: 120000 },
  async (t) => {
    const f = await run(fixture);
    t.onTestFinished(() => run(f.close()));
    for (const path of [
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "LICENSE",
      "licenses",
      "templates/reporter",
      "src/workflow/report-build.ts",
    ])
      await cp(resolve(path), join(f.config.home, path), {
        recursive: true,
        filter: (path) => !/\/(?:node_modules|dist|\.vite)(?:\/|$)/.test(path),
      });
    await symlink(resolve("node_modules"), join(f.config.home, "node_modules"), "dir");
    await symlink(
      resolve("templates/reporter/node_modules"),
      join(f.config.home, "templates/reporter/node_modules"),
      "dir",
    );
    const parent = Id.SessionId.make("ses_visual-controller"),
      issue = Id.IssueId.make("concurrent-report");
    const hostile =
      '</ScRiPt><script>globalThis.reportExecuted=true</script><img src="https://example.invalid/asset" onerror="globalThis.reportExecuted=true">';
    f.work.add(issue);
    f.work.issues.get(issue)!.title = hostile;
    await run(f.controller.recordSupervisor(parent));
    const execution = await run(f.controller.start(issue, parent));
    await run(
      f.controller.workerReply(execution.explore_session_id!, {
        action: "finding",
        request_id: Id.RequestId.make("hostile-finding"),
        generation: execution.control_generation,
        body: hostile,
        evidence: [
          { base: execution.base_commit!, path: Id.RelativePath.make("source.txt"), line: 1 },
        ],
      }),
    );
    const nativeRunner = new ProcessRunner();
    let active = 0,
      peak = 0;
    const roots: string[] = [];
    const runner: Runner = {
      run: (file, args, cwd, env, options) =>
        Effect.acquireUseRelease(
          Effect.sync(() => {
            active++;
            peak = Math.max(peak, active);
            roots.push(args[1]!);
          }),
          () =>
            Effect.gen(function* () {
              assert.equal(options!.deadline_ms, 45000);
              assert.equal(options!.max_output_bytes, 262144);
              const config = yield* Effect.promise(() =>
                readFile(join(args[1]!, "vite.config.mts"), "utf8"),
              );
              assert.ok(config.includes(join(args[1]!, ".vite")));
              assert.ok(config.includes(f.config.home));
              yield* Effect.promise(() => assert.rejects(access(join(args[1]!, "src/report.tsx"))));
              return yield* nativeRunner.run(file, args, cwd, env, options);
            }),
          () =>
            Effect.sync(() => {
              active--;
            }),
        ),
    };
    const renderer = new ViteReportRenderer(f.config.home, runner),
      before = await run(renderer.fingerprint);
    const reports = () =>
      new Reports(
        f.config.home,
        f.records,
        f.git,
        f.locks,
        f.work,
        (...args) => f.runtime.notify(...args),
        renderer,
      );
    const results = await Promise.all(
      ["architecture", "verification"].map((id) =>
        run(reports().generate(parent, issue, { request_id: Id.RequestId.make(id) })),
      ),
    );
    assert.equal(peak, 2);
    assert.equal(new Set(roots).size, 2);
    assert.equal(await run(renderer.fingerprint), before);
    assert.notEqual(results[0]!.artifact!.path, results[1]!.artifact!.path);
    assert.deepEqual(await readdir(join(f.config.home, ".abracode/reports/.scratch")), []);
    for (const result of results) {
      assert.equal(result.status, "published");
      assert.equal(
        (await readFile(result.artifact!.path, "utf8")).includes("abracode-license-notices"),
        true,
      );
    }
    const moved = join(f.root, "portable-evidence");
    await mkdir(moved);
    const path = join(moved, "architecture.html");
    await copyFile(results[0]!.artifact!.path, path);
    const browser = await launchReportBrowser();
    t.onTestFinished(() => browser.close());
    const context = await browser.newContext({
        offline: true,
        viewport: { width: 375, height: 812 },
      }),
      page = await context.newPage();
    const requests: string[] = [],
      errors: string[] = [];
    page.on("request", (r) => {
      if (!r.isNavigationRequest() && !r.url().startsWith("data:")) requests.push(r.url());
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(pathToFileURL(path).href);
    assert.equal(await page.getByRole("heading", { level: 1 }).textContent(), hostile);
    assert.equal(await page.locator(".mermaid-diagram svg").count(), 2);
    assert.equal(await page.locator("img").count(), 0);
    assert.equal(await page.evaluate(() => Reflect.get(globalThis, "reportExecuted")), undefined);
    assert.match(await page.locator("main").innerText(), /static snapshot/);
    await page.getByRole("searchbox").fill("reportExecuted");
    assert.equal(await page.locator(".finding").count(), 1);
    await page.locator(".finding summary").focus();
    await page.locator(".finding summary").press("Enter");
    assert.match(await page.locator(".finding").innerText(), /Retained worker finding/);
    assert.equal(await page.evaluate("document.documentElement.scrollWidth <= innerWidth"), true);
    const content = await readFile(path, "utf8");
    await page.goto("about:blank");
    await page.setContent(
      '<iframe title="Retained report" sandbox="allow-scripts allow-popups allow-forms allow-modals" style="width:100%;height:800px;border:0"></iframe>',
    );
    await page.locator("iframe").evaluate((element, html) => {
      (element as HTMLIFrameElement).src = URL.createObjectURL(
        new Blob([html], { type: "text/html" }),
      );
    }, content);
    const frame = page.frameLocator("iframe");
    await frame.getByRole("heading", { level: 1 }).waitFor();
    assert.equal(await frame.locator(".mermaid-diagram svg").count(), 2);
    await frame
      .getByLabel("General comments", { exact: true })
      .fill("Inspect the retained evidence");
    await frame.getByRole("button", { name: "Prepare JSON", exact: true }).click();
    assert.equal(
      JSON.parse(await frame.getByLabel("Feedback export", { exact: true }).inputValue()).authority,
      "review-input-only",
    );
    assert.equal(
      await page
        .locator("iframe")
        .evaluate((e) => (e as HTMLIFrameElement).contentDocument === null),
      true,
    );
    assert.deepEqual(requests, []);
    assert.deepEqual(errors, []);
  },
);
