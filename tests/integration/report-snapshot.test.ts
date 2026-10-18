import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import {
  cp,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  symlink,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ProcessRunner } from "../../src/process.ts";
import * as Id from "../../src/identities.ts";
import { run } from "../effects.ts";
import { snapshotJSON } from "../../templates/reporter/src/snapshot-data.ts";
import { launchReportBrowser } from "../../templates/reporter/scripts/browser.ts";

test(
  "validated snapshot builds remain inert, portable and usable offline in an opaque sandbox",
  { timeout: 60000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "abra-report-data-"));
    t.onTestFinished(() => rm(root, { recursive: true, force: true }));
    const workspace = resolve("templates/reporter");
    await cp(join(workspace, "src"), join(root, "src"), { recursive: true });
    await symlink(join(workspace, "node_modules"), join(root, "node_modules"), "dir");
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ name: "abracode-report-data-fixture", private: true, type: "module" }),
    );
    const hostile =
      '</ScRiPt><script>globalThis.snapshotExecuted=true</script><img src="https://example.invalid/attack" onerror="globalThis.snapshotExecuted=true"><!--\u2028\u2029';
    const snapshot = {
      schema_version: 1,
      issue_id: "snapshot-fixture",
      execution_id: "execution-fixture",
      title: hostile,
      summary: "Read-only fixture evidence",
      observed_at: "2026-10-18T00:00:00.000Z",
      provenance: "Disposable fixture only; no production evidence",
      status: "unknown",
      findings: [
        {
          title: "Needle source finding",
          category: "Evidence",
          summary: "Untrusted repository content",
          evidence: hostile,
          references: [
            {
              path: hostile,
              commit: "1".repeat(40),
              line: 1,
              url: "https://example.invalid/evidence",
            },
          ],
        },
        {
          title: "Missing evidence",
          category: "Limitation",
          summary: "No invented proof",
          evidence: "Unavailable",
          references: [],
        },
      ],
      checks: [{ name: "Fixture verification", status: "not_run" }],
      events: [],
      excerpts: [
        {
          title: "Untrusted source excerpt",
          kind: "code",
          text: hostile,
          provenance: "Repository text, not executable report code",
        },
        {
          title: "Untrusted diff",
          kind: "diff",
          text: `- before\n+ ${hostile}`,
          provenance: "Fixture comparison",
        },
      ],
      limitations: ["No successful checks were supplied"],
    };
    const index = (await readFile(join(workspace, "index.html"), "utf8"))
      .replace("/src/main.tsx", "/src/snapshot-entry.tsx")
      .replace(
        "</body>",
        `<script type="application/json" id="abracode-report-data">${snapshotJSON(snapshot)}</script>\n</body>`,
      );
    await writeFile(join(root, "index.html"), index);
    await writeFile(
      join(root, "vite.config.mts"),
      `import base from ${JSON.stringify(join(workspace, "vite.config.ts"))}; export default {...base,root:${JSON.stringify(root)},cacheDir:${JSON.stringify(join(root, ".vite"))},build:{...base.build,outDir:${JSON.stringify(join(root, "dist"))},emptyOutDir:true}};`,
    );
    await run(
      new ProcessRunner().run(
        Id.Executable.make(resolve("node_modules/.bin/vp")),
        ["build", root, "--config", join(root, "vite.config.mts")],
        Id.AbsolutePath.make(workspace),
        { NODE_ENV: "production" },
        { deadline_ms: 45000 },
      ),
    );
    assert.deepEqual(await readdir(join(root, "dist")), ["index.html"]);
    const html = await readFile(join(root, "dist/index.html"), "utf8");
    assert.match(html, /abracode-license-notices/);
    assert.ok(
      Buffer.byteLength(html) < 150000,
      `Snapshot runtime grew to ${Buffer.byteLength(html)} bytes`,
    );
    assert.doesNotMatch(html, /Report snapshot exceeds 512 KiB/);
    const moved = join(root, "moved");
    await mkdir(moved);
    await copyFile(join(root, "dist/index.html"), join(moved, "snapshot.html"));
    const browser = await launchReportBrowser();
    t.onTestFinished(() => browser.close());
    const context = await browser.newContext({
      offline: true,
      viewport: { width: 375, height: 812 },
    });
    const page = await context.newPage();
    const requests: string[] = [],
      errors: string[] = [];
    page.on("request", (request) => {
      if (!request.isNavigationRequest() && !request.url().startsWith("data:"))
        requests.push(request.url());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(pathToFileURL(join(moved, "snapshot.html")).href);
    assert.equal(await page.getByRole("heading", { level: 1 }).textContent(), hostile);
    assert.equal(await page.locator("img").count(), 0);
    assert.equal(await page.evaluate(() => Reflect.get(globalThis, "snapshotExecuted")), undefined);
    assert.match(await page.locator("main").innerText(), /Snapshot observed:.*2026-10-18/);
    assert.match(
      await page.getByRole("region", { name: "Snapshot checks" }).innerText(),
      /not run.*Unavailable/s,
    );
    assert.equal(await page.locator(".code-panel pre").first().textContent(), hostile);
    await page.getByRole("searchbox").fill("needle");
    assert.equal(await page.locator(".finding").count(), 1);
    const evidence = page.locator(".finding summary");
    await evidence.focus();
    await evidence.press("Enter");
    assert.equal(await page.locator(".source-reference code").first().textContent(), hostile);
    assert.equal(
      await page.locator(".source-reference a").getAttribute("href"),
      "https://example.invalid/evidence",
    );
    assert.equal(await page.evaluate("document.documentElement.scrollWidth <= innerWidth"), true);
    await page.goto("about:blank");
    await page.setContent(
      '<iframe sandbox="allow-scripts allow-popups allow-forms allow-modals" title="Snapshot" style="width:100%;height:800px;border:0"></iframe>',
    );
    await page.locator("iframe").evaluate((frame, content) => {
      (frame as HTMLIFrameElement).src = URL.createObjectURL(
        new Blob([content], { type: "text/html" }),
      );
    }, html);
    const frame = page.frameLocator("iframe");
    await frame.getByRole("heading", { level: 1 }).waitFor();
    await frame.getByRole("searchbox").fill("missing evidence");
    assert.equal(await frame.locator(".finding").count(), 1);
    await frame.getByLabel("General comments", { exact: true }).fill("Inspect source provenance");
    await frame.getByRole("button", { name: "Prepare JSON", exact: true }).click();
    assert.equal(
      JSON.parse(await frame.getByLabel("Feedback export", { exact: true }).inputValue()).authority,
      "review-input-only",
    );
    assert.equal(
      await page
        .locator("iframe")
        .evaluate((element) => (element as HTMLIFrameElement).contentDocument === null),
      true,
    );
    assert.equal(
      await frame.locator("main").evaluate(() => Reflect.get(globalThis, "snapshotExecuted")),
      undefined,
    );
    assert.deepEqual(requests, []);
    assert.deepEqual(errors, []);
  },
);
