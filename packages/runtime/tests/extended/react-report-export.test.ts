import { analysisCharts } from "../helpers/chart-fixtures.ts";
import { mixedDiagrams, denseFlowchart } from "../helpers/diagram-fixtures.ts";
import { validateReportDocument } from "@abracode/contracts/presentation/report-document";
import { spawn } from "node:child_process";
import { once } from "node:events";
import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { fixture } from "../fixtures.ts";
import { run } from "../effects.ts";
import { coveredReportDocument } from "../helpers/report-document.ts";
import { ReactDocumentRenderer } from "../../src/reporting/report-export.ts";
import { ProcessRunner } from "../../src/process.ts";
import { launchReportBrowser } from "@abracode/report-export/browser";
import { installSource } from "../e2e/install.ts";

test(
  "React exports reuse frozen catalog components with prepared diagrams and local feedback in an offline opaque frame",
  { timeout: 120000 },
  async (t) => {
    const f = await run(fixture);
    t.onTestFinished(() => run(f.close()));
    await installSource(f.config.home, { buildWeb: false });
    const renderer = new ReactDocumentRenderer(f.config.home, new ProcessRunner());
    await run(renderer.prepare);
    const bundle = await run(renderer.acquire);
    const baseline = coveredReportDocument(true);
    const fixtures = mixedDiagrams(30);
    fixtures[29] = { ...fixtures[29]!, source: fixtures[0]!.source };
    fixtures[28] = { title: "Dense workflow", source: denseFlowchart };
    const input = validateReportDocument({
      ...baseline,
      surface: {
        ...baseline.surface,
        createSurface: {
          ...baseline.surface.createSurface,
          components: baseline.surface.createSurface.components
            .map((component) =>
              component.id === "root"
                ? {
                    ...component,
                    children: [
                      ...(component.children as string[]),
                      "totals",
                      "details",
                      "media",
                      ...Object.values(analysisCharts).map((chart) => chart.id),
                      ...fixtures.map((_, i) => `inline${i}`),
                    ],
                  }
                : component,
            )
            .concat(fixtures.map((d, i) => ({ id: `inline${i}`, component: "Mermaid", ...d })))
            .concat(Object.values(analysisCharts))
            .concat([
              {
                id: "details",
                component: "Disclosure",
                label: "Captured snippet",
                child: "snippet",
              },
              { id: "snippet", component: "CodeBlock", code: "  retained()", language: "JS" },
              {
                id: "media",
                component: "Image",
                url: "https://example.invalid/live.png",
                description: "Live photo",
              },
            ])
            .concat({
              id: "totals",
              component: "PieChart",
              title: "Captured totals",
              data: [
                { label: "Completed", value: 4 },
                { label: "Remaining", value: 2 },
              ],
            }),
        },
      },
    });
    const html = await run(bundle.render(input));
    assert.ok(Buffer.byteLength(html) < 8 * 1024 * 1024);

    const altered = html.replace(
      /(id="abracode-report-diagrams" data-hash=")[a-f0-9]{64}/,
      "$1" + "0".repeat(64),
    );
    assert.notEqual(altered, html);
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
    const tampered = join(moved, "tampered.html");
    await writeFile(tampered, altered);
    await page.goto(pathToFileURL(tampered).href);
    await page.getByText(/Report integrity verification failed/).waitFor();
    assert.equal(await page.locator(".frozen-report").count(), 0);
    await page.goto(pathToFileURL(join(moved, "frame.html")).href);
    const report = page.frameLocator("iframe");
    await report.getByRole("heading", { name: "Saved evidence", exact: true }).waitFor();
    assert.equal(
      await report.locator('[data-diagram-state="ready"] .diagram-scroll svg').count(),
      32,
    );
    await report.getByText("Captured snippet", { exact: true }).click();
    const functionName = report
      .locator(".catalog-code code span")
      .filter({ hasText: /^retained$/ });
    await functionName.waitFor();
    const lightColor = await functionName.evaluate((el) => getComputedStyle(el).color);
    const darkTheme = report.getByRole("checkbox", { name: "Dark theme", exact: true });
    await darkTheme.check();
    assert.notEqual(await functionName.evaluate((el) => getComputedStyle(el).color), lightColor);
    await darkTheme.uncheck();
    assert.equal(await report.locator(".catalog-code code").textContent(), "  retained()");
    await report.getByText("Live photo · Media unavailable offline").waitFor();
    const chart = report.getByRole("figure", { name: "Captured totals" });
    await chart.locator("svg path[d]").first().waitFor();
    assert.deepEqual(await chart.locator("dd").allTextContents(), ["4", "2"]);
    for (const { title } of Object.values(analysisCharts)) {
      const figure = report.getByRole("figure", { name: title, exact: true });
      await figure.locator("svg").waitFor();
      assert.ok((await figure.locator("tbody tr").count()) > 0);
    }
    const dense = report.getByRole("img", { name: "Dense workflow", exact: true });
    assert.equal(
      await dense.evaluate((element) => element.scrollWidth > element.clientWidth),
      true,
    );
    await dense.focus();
    await dense.press("ArrowRight");
    await dense.evaluate(
      (element) =>
        new Promise<void>((resolve) => {
          const check = () => (element.scrollLeft > 0 ? resolve() : requestAnimationFrame(check));
          check();
        }),
    );
    const expand = report.getByRole("button", { name: "Expand diagram", exact: true }).first();
    await expand.click();
    await report.getByRole("button", { name: "Zoom in", exact: true }).click();
    assert.match(await report.getByRole("dialog").innerText(), /125%/);
    await report.getByRole("button", { name: "Reset zoom", exact: true }).click();
    await report.getByRole("dialog").press("Escape");
    assert.equal(await expand.evaluate((element) => element === document.activeElement), true);
    const svgIDs = await report
      .locator("svg [id],svg[id]")
      .evaluateAll((elements) => elements.map((element) => element.id));
    assert.equal(new Set(svgIDs).size, svgIDs.length);
    await report.getByText("Frozen task title", { exact: true }).waitFor();
    assert.ok(
      await report
        .locator(".work-card strong")
        .first()
        .evaluate((element) => element.getBoundingClientRect().width > 70),
      "offline Kanban title must use the available card width",
    );
    await report.getByText("Older snapshot task title", { exact: true }).first().waitFor();
    assert.match(
      await report.locator('[data-work-widget="StatusSummary"]').innerText(),
      /1 \(partial\)/,
    );
    assert.match(
      await report.locator('[data-work-widget="WorkTable"]').first().innerText(),
      /Partial data/,
    );
    assert.match(
      await report.locator('[data-work-widget="WorkTable"]').last().innerText(),
      /Coverage unknown/,
    );

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
    for (const width of [1440, 375, 390]) {
      await page.setViewportSize({ width, height: 844 });
      const theme = report.getByRole("checkbox", { name: "Dark theme", exact: true });
      const before = await theme.isChecked();
      await theme.focus();
      assert.equal(await theme.evaluate((element) => element === document.activeElement), true);
      await theme.press("Space");
      assert.equal(await theme.isChecked(), !before);
      await theme.setChecked(width === 390);
      assert.equal(
        await frame.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      for (const dark of [false, true]) {
        await theme.setChecked(dark);
        assert.equal(
          await frame.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false,
        );
        assert.ok(
          await report
            .locator(".work-card strong")
            .first()
            .evaluate((element) => element.getBoundingClientRect().width > 70),
        );
        assert.equal(
          await report
            .locator(".muted")
            .first()
            .evaluate(
              (element) =>
                getComputedStyle(element).color === getComputedStyle(element.parentElement!).color,
            ),
          false,
        );
        if (evidence) {
          await mkdir(evidence, { recursive: true });
          await page.screenshot({
            path: join(evidence, `portable-react-report-${width}-${dark ? "dark" : "light"}.png`),
            fullPage: true,
            animations: "disabled",
          });
        }
      }
    }
    if (evidence)
      await writeFile(
        join(evidence, "portable-react-report.json"),
        JSON.stringify(
          {
            bytes: Buffer.byteLength(html),
            exporter: bundle.fingerprint,
            network,
            errors,
            viewports: [375, 390],
            opaque: true,
          },
          null,
          2,
        ),
      );
    // Reopen the same document with a CSP that declines WebAssembly.
    const restricted = join(moved, "restricted.html");
    await writeFile(restricted, html.replace(" 'wasm-unsafe-eval'", ""));
    await page.goto(pathToFileURL(restricted).href);
    await page.getByText("Captured snippet", { exact: true }).click();
    assert.equal(await page.locator(".catalog-code code").textContent(), "  retained()");
    assert.equal(await page.locator(".catalog-code code span").count(), 0);
    // Preview is a foreground command with its own listener, started only here.
    const preview = spawn(
      resolve("node_modules/.bin/tsx"),
      [resolve("scripts/cli.ts"), "report", "preview", join(moved, "export.html"), "0"],
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
