import { spawn } from "node:child_process";
import { once } from "node:events";
import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { cp, symlink, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { fixture } from "../fixtures.ts";
import { run } from "../effects.ts";
import { reportDocument } from "../helpers/report-document.ts";
import { ReactDocumentRenderer } from "../../src/workflow/report-export.ts";
import { ProcessRunner } from "../../src/process.ts";
import { launchReportBrowser } from "../../apps/report/scripts/browser.ts";

test(
  "React exports reuse frozen catalog components with prepared diagrams and local feedback in an offline opaque frame",
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
    await symlink(resolve("node_modules"), join(f.config.home, "node_modules"), "dir");
    await symlink(
      resolve("apps/report/node_modules"),
      join(f.config.home, "apps/report/node_modules"),
      "dir",
    );
    await symlink(
      resolve("apps/web/node_modules"),
      join(f.config.home, "apps/web/node_modules"),
      "dir",
    );
    const renderer = new ReactDocumentRenderer(f.config.home, new ProcessRunner());
    const fingerprint = await run(renderer.fingerprint);
    const html = await run(renderer.render(reportDocument(), fingerprint));
    assert.ok(Buffer.byteLength(html) < 8 * 1024 * 1024);

    const moved = join(f.root, "relocated");
    await mkdir(moved);
    await writeFile(join(moved, "export.html"), html);
    const escaped = html
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
    await writeFile(
      join(moved, "frame.html"),
      `<!doctype html><meta charset="UTF-8"><iframe style="width:100%;height:100vh;border:0" sandbox="allow-scripts" srcdoc="${escaped}"></iframe>`,
    );
    const browser = await launchReportBrowser();
    t.onTestFinished(() => browser.close());
    const context = await browser.newContext({
      offline: true,
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    const network: string[] = [],
      errors: string[] = [];
    page.on("request", (request) => {
      if (/^https?:/.test(request.url())) network.push(request.url());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(pathToFileURL(join(moved, "frame.html")).href);
    const report = page.frameLocator("iframe");
    await report.getByRole("heading", { name: "Saved evidence", exact: true }).waitFor();
    assert.equal(await report.locator('[data-diagram-state="ready"] svg').count(), 1);
    assert.match(await report.locator('[data-report-section="checks"]').innerText(), /pending/);
    assert.equal(await report.locator("script[src],link[rel=stylesheet]").count(), 0);
    assert.equal(
      await report.getByRole("button", { name: "Frozen task title", exact: true }).count(),
      0,
    );
    await report.getByLabel("Filter captured findings", { exact: true }).fill("absent finding");
    await report.getByText("0 of 1 findings", { exact: true }).waitFor();
    await report
      .getByLabel("General comments", { exact: true })
      .fill("Retain the pending check as pending.");
    await report.getByRole("button", { name: "Prepare JSON", exact: true }).click();
    const feedback = JSON.parse(
      await report.getByLabel("Feedback export", { exact: true }).inputValue(),
    );
    assert.equal(feedback.authority, "review-input-only");
    assert.equal(feedback.comments, "Retain the pending check as pending.");
    await report.getByRole("button", { name: "Prepare Markdown", exact: true }).click();
    assert.match(
      await report.getByLabel("Feedback export", { exact: true }).inputValue(),
      /does not approve work/,
    );
    const frame = page.frames().find((frame) => frame.parentFrame());
    assert.ok(frame);
    assert.equal(
      await frame.evaluate(() => {
        try {
          void parent.document;
          return true;
        } catch {
          return false;
        }
      }),
      false,
    );
    assert.equal(
      await frame.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    const evidence = process.env.ABRACODE_TEST_EVIDENCE_DIR;
    for (const width of [375, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await report.getByLabel("Dark theme", { exact: true }).setChecked(width === 390);
      assert.equal(
        await frame.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      if (evidence) {
        await mkdir(evidence, { recursive: true });
        await page.screenshot({
          path: join(evidence, `portable-react-report-${width}.png`),
          fullPage: true,
          animations: "disabled",
        });
      }
    }
    if (evidence)
      await writeFile(
        join(evidence, "portable-react-report.json"),
        JSON.stringify(
          {
            bytes: Buffer.byteLength(html),
            exporter: fingerprint,
            network,
            errors,
            viewports: [375, 390],
            opaque: true,
          },
          null,
          2,
        ),
      );
    // Preview is a foreground command with its own listener, started only here.
    const preview = spawn(
      resolve("node_modules/.bin/tsx"),
      [resolve("scripts/report.ts"), "preview", join(moved, "export.html"), "0"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    t.onTestFinished(() => {
      if (preview.exitCode === null) preview.kill("SIGTERM");
    });
    const address = await new Promise<string>((resolve, reject) => {
      let output = "";
      preview.stdout.on("data", (chunk) => {
        output += String(chunk);
        const match = output.match(/http:\/\/127\.0\.0\.1:\d+\//);
        if (match) resolve(match[0]);
      });
      preview.once("error", reject);
      preview.once("exit", (code) => reject(new Error(`Preview exited before listening: ${code}`)));
    });
    const response = await fetch(address);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), html);
    assert.match(response.headers.get("content-security-policy") ?? "", /sandbox allow-scripts/);
    const closed = once(preview, "exit");
    preview.kill("SIGTERM");
    await closed;
    await assert.rejects(fetch(address));
    assert.deepEqual(network, []);
    assert.deepEqual(errors, []);
  },
);
