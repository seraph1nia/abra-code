import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "vite-plus/test";
import { pathToFileURL } from "node:url";
import { launchReportBrowser } from "../../templates/reporter/scripts/browser.ts";

const workspace = resolve("templates/reporter");
const vp = resolve("node_modules/.bin/vp");

// Only spawn owned, isolated process groups; never stop a pre-existing listener.
function command(args: string[], executable = vp, cwd = workspace) {
  const child = spawn(executable, args, {
    cwd,
    env: { ...process.env, NODE_ENV: args[0] === "build" ? "production" : "development" },
    detached: true,
    stdio: "pipe",
  });
  let output = "";
  child.stdout.setEncoding("utf8").on("data", (data: string) => (output += data));
  child.stderr.setEncoding("utf8").on("data", (data: string) => (output += data));
  const ended = once(child, "exit").then(([code]) => ({ code, output }));
  return {
    ended,
    async url() {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const url = output.match(/http:\/\/127\.0\.0\.1:\d+\//)?.[0];
        if (url) return url;
        assert.equal(child.exitCode, null, output);
        await delay(25);
      }
      assert.fail(`Report server did not start: ${output}`);
    },
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      assert.ok(child.pid);
      process.kill(-child.pid, "SIGTERM");
      const timer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null)
          process.kill(-child.pid!, "SIGKILL");
      }, 1000);
      try {
        await ended;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

test(
  "report build is portable and preview serves only its explicit output",
  { timeout: 60_000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "abracode-report-"));
    t.onTestFinished(() => rm(root, { recursive: true, force: true }));
    const outDir = join(root, "artifact");
    const build = command(["build", "--outDir", outDir]);
    t.onTestFinished(() => build.stop());
    const result = await build.ended;
    assert.equal(result.code, 0, result.output);
    assert.doesNotMatch(result.output, /Pre-transform error|\[Unhandled error\]/);
    assert.deepEqual(await readdir(outDir), ["index.html"]);
    const html = await readFile(join(outDir, "index.html"), "utf8");
    const notices = JSON.parse(
      /<script[^>]*id="abracode-license-notices"[^>]*>([\s\S]*?)<\/script>/.exec(html)![1],
    );
    assert.match(notices.project, /MIT License/);
    assert.ok(
      notices.dependencies.some(
        (p: { id: string; notices: string[] }) =>
          p.id.startsWith("solid-js@") && p.notices.some((text) => text.includes("Copyright")),
      ),
    );
    assert.equal(
      notices.dependencies.some((p: { id: string }) =>
        /(?:mermaid|elkjs|lightningcss)@/.test(p.id),
      ),
      false,
    );
    // Three prepared SVGs should stay small; bundling Mermaid used over 5 MB.
    assert.ok(Buffer.byteLength(html) < 150_000, `Report grew to ${Buffer.byteLength(html)} bytes`);
    assert.match(html, /A small report, ready to share/);
    assert.match(html, /<script\b[^>]*>[\s\S]+?<\/script>/);
    assert.match(html, /<style\b[^>]*>[\s\S]+?<\/style>/);
    // Exercise the actual artifact, including SVGs compiled during the build.
    const moved = join(root, "moved.html");
    await copyFile(join(outDir, "index.html"), moved);
    const browser = await launchReportBrowser();
    t.onTestFinished(() => browser.close());
    const context = await browser.newContext({
      offline: true,
      viewport: { width: 375, height: 812 },
    });
    const page = await context.newPage();
    const resourceRequests: string[] = [];
    const errors: string[] = [];
    page.on("request", (request) => {
      if (!request.isNavigationRequest() && !request.url().startsWith("data:"))
        resourceRequests.push(request.url());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(pathToFileURL(moved).href);
    await page.locator('[data-diagram-state="ready"]').nth(2).waitFor();
    assert.equal(await page.locator(".mermaid-diagram svg").count(), 3);
    assert.equal(await page.locator('[data-diagram-state="error"]').count(), 0);
    assert.equal(await page.evaluate("document.documentElement.scrollWidth <= innerWidth"), true);
    await page.getByRole("searchbox").fill("delivery");
    assert.equal(await page.locator(".finding").count(), 1);
    await page.getByText("Read evidence", { exact: true }).click();
    assert.equal(await page.locator(".finding details").getAttribute("open"), "");
    await page.getByText("Mermaid source", { exact: true }).first().click();
    assert.equal(await page.locator(".mermaid-diagram details").first().getAttribute("open"), "");

    // Use the native viewer's opaque-origin sandbox, with the exact same bytes.
    await page.goto("about:blank");
    await page.setContent(
      '<iframe title="Report" sandbox="allow-scripts allow-popups allow-forms allow-modals" referrerpolicy="no-referrer" style="width:100%;height:800px;border:0"></iframe>',
    );
    await page.locator("iframe").evaluate((frame, html) => {
      (frame as HTMLIFrameElement).src = URL.createObjectURL(
        new Blob([html], { type: "text/html" }),
      );
    }, html);
    const report = page.frameLocator("iframe");
    await report.locator('[data-diagram-state="ready"]').nth(2).waitFor();
    assert.equal(await report.locator(".mermaid-diagram svg").count(), 3);
    await report.getByRole("searchbox").fill("delivery");
    assert.equal(await report.locator(".finding").count(), 1);
    assert.equal(
      await page
        .locator("iframe")
        .evaluate((frame) => (frame as HTMLIFrameElement).contentDocument === null),
      true,
    );
    assert.deepEqual(resourceRequests, []);
    assert.deepEqual(errors, []);

    const missing = command(["preview", "--outDir", join(root, "missing"), "--port", "0"]);
    t.onTestFinished(() => missing.stop());
    const failure = await missing.ended;
    assert.notEqual(failure.code, 0);
    assert.match(failure.output, /does not exist|build/i);

    const preview = command(["preview", "--outDir", outDir, "--port", "0"]);
    t.onTestFinished(() => preview.stop());
    const url = await preview.url();
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/);
    assert.equal(await response.text(), html);
    await preview.stop();
    await assert.rejects(fetch(url));
    assert.equal(await readFile(join(outDir, "index.html"), "utf8"), html);

    const occupied = createServer();
    occupied.listen(0, "127.0.0.1");
    await once(occupied, "listening");
    t.onTestFinished(() => new Promise<void>((done) => occupied.close(() => done())));
    const address = occupied.address();
    assert.ok(address && typeof address !== "string");
    for (const action of ["preview", "dev"]) {
      const collision = command([
        action,
        ...(action === "preview" ? ["--outDir", outDir] : []),
        "--port",
        String(address.port),
      ]);
      t.onTestFinished(() => collision.stop());
      const failed = await collision.ended;
      assert.notEqual(failed.code, 0);
      assert.match(failed.output, /port .*already in use/i);
    }
  },
);

test(
  "diagram validator renders sources and reports syntax, rendering and file failures",
  { timeout: 60_000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "abracode-diagrams-"));
    t.onTestFinished(() => rm(root, { recursive: true, force: true }));
    const invalid = join(root, "invalid.mmd");
    const renderFailure = join(root, "render-failure.mmd");
    await writeFile(invalid, "flowchart TD\n A -->");
    await writeFile(renderFailure, "flowchart TD\n A@{ shape: nonexistent_shape }");
    const cli = resolve(workspace, "scripts/validate.ts");
    const tsx = resolve("node_modules/.bin/tsx");
    const valid = command([cli], tsx, process.cwd());
    t.onTestFinished(() => valid.stop());
    const result = await valid.ended;
    assert.equal(result.code, 0, result.output);
    assert.doesNotMatch(result.output, /Pre-transform error|\[Unhandled error\]/);
    for (const name of ["report-flow.mmd", "report-sequence.mmd", "report-state.mmd"])
      assert.ok(result.output.includes(name), result.output);

    const broken = command(
      [cli, invalid, renderFailure, resolve(workspace, "src/diagrams/report-state.mmd")],
      tsx,
      root,
    );
    t.onTestFinished(() => broken.stop());
    const failure = await broken.ended;
    assert.notEqual(failure.code, 0);
    assert.match(failure.output, /FAIL invalid\.mmd/);
    assert.match(failure.output, /Parse error on line/);
    assert.match(failure.output, /FAIL render-failure\.mmd/);
    assert.match(failure.output, /nonexistent_shape/);
    assert.match(failure.output, /OK .*report-state\.mmd/);

    const missing = command([cli, join(root, "missing.mmd")], tsx, process.cwd());
    t.onTestFinished(() => missing.stop());
    const absent = await missing.ended;
    assert.notEqual(absent.code, 0);
    assert.match(absent.output, /ENOENT.*missing\.mmd/);
  },
);

test("report dev serves its entry on the explicit loopback URL", async (t) => {
  const dev = command(["dev", "--port", "0"]);
  t.onTestFinished(() => dev.stop());
  const url = await dev.url();
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /\/src\/main.tsx/);
});

test(
  "Mermaid imports compile during dev, refresh on edits and gate builds on unused sources",
  { timeout: 60_000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "abracode-diagram-authoring-"));
    t.onTestFinished(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, "src"));
    await writeFile(
      join(root, "index.html"),
      '<!doctype html><html><body><div id="diagram"></div><script type="module" src="/main.ts"></script></body></html>',
    );
    await writeFile(
      join(root, "main.ts"),
      `
import diagram from "./src/diagram.mmd";
function show(diagram) { document.getElementById("diagram").innerHTML = diagram.svg; }
show(diagram);
if (import.meta.hot) import.meta.hot.accept("./src/diagram.mmd", (updated) => { if (updated) show(updated.default); });
`,
    );
    const diagram = join(root, "src/diagram.mmd");
    await writeFile(diagram, "flowchart TD\n A[Initial stage] --> B[Done]");
    const config = join(workspace, "vite.config.ts");
    const dev = command(["dev", root, "--config", config, "--port", "0"]);
    t.onTestFinished(() => dev.stop());
    const url = await dev.url();
    const browser = await launchReportBrowser();
    t.onTestFinished(() => browser.close());
    const page = await browser.newPage();
    const runtimeModules: string[] = [];
    page.on("request", (request) => runtimeModules.push(request.url()));
    await page.goto(url);
    await page.getByText("Initial stage", { exact: true }).waitFor();
    await writeFile(diagram, "flowchart TD\n A[Revised stage] --> B[Done]");
    await page.getByText("Revised stage", { exact: true }).waitFor();
    assert.equal(await page.locator("#diagram svg").count(), 1);
    assert.equal(
      runtimeModules.some((url) => /mermaid-engine|node_modules.*mermaid/.test(url)),
      false,
    );
    await dev.stop();

    // The malformed file is intentionally not imported by main.ts.
    await writeFile(join(root, "src/unused.mmd"), "flowchart TD\n A -->");
    const build = command(["build", root, "--config", config]);
    t.onTestFinished(() => build.stop());
    const result = await build.ended;
    assert.notEqual(result.code, 0);
    assert.match(result.output, /FAIL src\/unused\.mmd/);
    assert.match(result.output, /Parse error on line/);
  },
);
