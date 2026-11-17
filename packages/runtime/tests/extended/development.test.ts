/* oxlint-disable effecttsgo/unstable-api-usage -- Discover only the disposable native installation to exercise public development/HMR lifetimes. */
import { removeFixture } from "../helpers/resources.ts";
import { expect, test } from "vite-plus/test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { installSource, installationRoot, command } from "../e2e/install.ts";
import { launchReportBrowser } from "@abracode/report-export/browser";
import { Effect } from "effect";
import { NodeFileSystem } from "@effect/platform-node";
import { Service } from "@opencode/client/effect/service";
import { OpenCode } from "@opencode/client";
import { runtimePaths } from "../../src/config/identity.ts";
import { AbsolutePath } from "../../src/identities.ts";

async function unusedPort() {
  const server = createServer();
  return new Promise<number>((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as import("node:net").AddressInfo).port;
      server.close(() => resolve(port));
    }),
  );
}

test(
  "pnpm dev serves TanStack Router, preserves React state through HMR and reloads the Effect backend",
  { timeout: 180000 },
  async () => {
    const root = await installationRoot("abracode-development-");
    const home = join(root, "installation");
    await mkdir(home);
    const port = await unusedPort(),
      backendPort = await unusedPort();
    const origin = `http://127.0.0.1:${port}`;
    const env = {
      ...process.env,
      ABRACODE_HOME: home,
      ABRACODE_CONFIG: "personal.yaml",
      XDG_CONFIG_HOME: join(root, "config"),
      XDG_DATA_HOME: join(root, "data"),
      XDG_STATE_HOME: join(root, "state"),
      XDG_CACHE_HOME: join(root, "cache"),
    };
    let child: ReturnType<typeof spawn> | undefined;
    let logs = "",
      result: Record<string, unknown> = { result: "failed" };
    const run = (script: string) =>
      command(join(home, "node_modules/.bin/tsx"), [join(home, "scripts", script)], {
        cwd: home,
        env,
        timeout: 30000,
      });
    let exited: Promise<void>;
    const stop = async () => {
      if (!child || child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGTERM");
      const timer = setTimeout(() => child?.kill("SIGKILL"), 8000);
      try {
        await exited;
      } finally {
        clearTimeout(timer);
      }
    };
    try {
      await installSource(home, { buildWeb: false });
      await writeFile(
        join(home, "personal.yaml"),
        "version: 1\nmodels: {default: {providerID: example, id: example}}\n",
      );
      // Use the public pnpm entry point, including both owned process lifetimes.
      child = spawn(
        "pnpm",
        ["dev", "--port", String(port), "--backend-port", String(backendPort)],
        { cwd: home, env, stdio: ["ignore", "pipe", "pipe"] },
      );
      child.stdout!.on("data", (chunk) => {
        logs += chunk.toString();
      });
      child.stderr!.on("data", (chunk) => {
        logs += chunk.toString();
      });
      exited = new Promise<void>((resolve) => child!.once("exit", () => resolve()));
      const deadline = Date.now() + 45000;
      while (true) {
        if (child.exitCode !== null || Date.now() > deadline)
          throw new Error(`Development startup failed: ${logs.slice(-5000)}`);
        const response = await fetch(`${origin}/api/bootstrap`).catch(() => undefined);
        if (response?.ok) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const first = await (await fetch(`${origin}/api/bootstrap`)).json();
      const endpoint = await Effect.runPromise(
        Service.discover({
          file: runtimePaths(AbsolutePath.make(home)).service,
          version: "2.3.0",
        }).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      assert.ok(endpoint);
      const native = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) });
      const nativeForm = await native.session.form.create({
        sessionID: first.session_id,
        title: "Development retained edits",
        metadata: { source: "fixture" },
        fields: [
          { type: "string", key: "text", title: "Retained form text", required: true },
          {
            type: "multiselect",
            key: "choices",
            title: "Retained custom choices",
            options: [],
            custom: true,
          },
        ],
      });
      assert.equal(
        (await fetch(`${origin}/api/bootstrap`, { headers: { origin: "http://evil.example" } }))
          .status,
        403,
      );
      assert.equal(
        (
          await fetch(`${origin}/api/abra/stop`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          })
        ).status,
        403,
      );
      const browser = await launchReportBrowser();
      try {
        const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
        const errors: string[] = [];
        let infoReads = 0;
        const observers = new Set<object>();
        // Scope request accounting to the current document; prior deliberate
        // full navigations retire their entire browser/network owner.
        page.on("framenavigated", (frame) => {
          if (frame === page.mainFrame()) observers.clear();
        });
        page.on("request", (request) => {
          if (request.url().endsWith("/api/copilotkit/info")) infoReads++;
          if (request.url().endsWith("/api/copilotkit/agent/abra/connect")) observers.add(request);
        });
        page.on("requestfinished", (request) => observers.delete(request));
        page.on("requestfailed", (request) => observers.delete(request));
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(origin);
        await page.getByRole("textbox", { name: "Message Abra" }).waitFor({ timeout: 30000 });
        await page.goto(`${origin}/unknown-page`);
        await page.getByRole("heading", { name: "Page not found" }).waitFor();
        await page.getByRole("link", { name: "Return to AbraCode" }).click();
        await page.goto(`${origin}/?issue=development-unavailable&tab=Plan`);
        await page.getByRole("heading", { name: "Selected task", exact: true }).waitFor();
        await page
          .getByRole("textbox", { name: "Message Abra" })
          .fill("Keep this draft through HMR");
        await page
          .getByLabel("Retained form text", { exact: false })
          .fill("Keep native form edits");
        await page
          .getByLabel("Additional choices, one per line", { exact: true })
          .fill("alpha\n\nbeta");
        const infoBeforeHmr = infoReads;
        await page.locator(".workspace").evaluate((element) => {
          element.dataset.hmrMount = "same";
        });
        const source = join(home, "apps/web/src/workspace.tsx");
        await writeFile(
          source,
          (await readFile(source, "utf8")).replace(
            "What would you like to build?",
            "React hot reload is working",
          ),
        );
        await page
          .getByRole("heading", { name: "React hot reload is working" })
          .waitFor({ timeout: 20000 });
        assert.equal(
          await page.getByRole("textbox", { name: "Message Abra" }).inputValue(),
          "Keep this draft through HMR",
        );
        assert.equal(await page.locator(".workspace").getAttribute("data-hmr-mount"), "same");
        assert.equal(
          await page.getByLabel("Retained form text", { exact: false }).inputValue(),
          "Keep native form edits",
        );
        assert.equal(
          await page.getByLabel("Additional choices, one per line", { exact: true }).inputValue(),
          "alpha\n\nbeta",
        );
        assert.match(page.url(), /issue=development-unavailable/);
        assert.match(page.url(), /tab=Plan/);
        assert.ok(infoBeforeHmr > 0);
        assert.equal(infoReads, infoBeforeHmr, "HMR must not reconnect the SDK info owner");
        await expect.poll(() => observers.size, { timeout: 5000 }).toBe(1);
        assert.equal(
          (await native.session.form.get({ sessionID: first.session_id, formID: nativeForm.id }))
            .state.status,
          "pending",
        );
        const backend = join(home, "packages/runtime/src/web/server.ts");
        await writeFile(
          backend,
          (await readFile(backend, "utf8")).replace(
            '"referrer-policy": "no-referrer"',
            '"referrer-policy": "same-origin"',
          ),
        );
        const backendDeadline = Date.now() + 20000;
        let changed = false;
        while (Date.now() < backendDeadline) {
          const response = await fetch(`${origin}/api/bootstrap`).catch(() => undefined);
          if (response?.ok && response.headers.get("referrer-policy") === "same-origin") {
            assert.equal((await response.json()).session_id, first.session_id);
            changed = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        assert.equal(changed, true, logs.slice(-5000));
        assert.equal(
          await page.getByRole("textbox", { name: "Message Abra" }).inputValue(),
          "Keep this draft through HMR",
        );
        assert.deepEqual(errors, []);
        result = {
          result: "pass",
          frontend_hmr_preserved_draft: true,
          frontend_hmr_preserved_form: true,
          frontend_hmr_preserved_selection: "unavailable retained Plan bookmark",
          development_diagnostics: "StrictMode; one active observer; no native form reply",
          backend_reload_observed: true,
          native_session_preserved: true,
          native_session_id: first.session_id,
          router: "tanstack",
          url: origin,
        };
      } finally {
        await browser.close();
      }
      await stop();
      assert.equal(await fetch(`${origin}/api/bootstrap`).catch(() => undefined), undefined);
      assert.equal(
        await fetch(`http://127.0.0.1:${backendPort}/api/bootstrap`).catch(() => undefined),
        undefined,
      );
      assert.equal((await run("start.ts")).stdout.match(/Abra: (ses_\S+)/)?.[1], first.session_id);
    } finally {
      await stop();
      try {
        await run("stop.ts");
      } finally {
        await removeFixture(root);
      }
      if (process.env.ABRACODE_TEST_EVIDENCE_DIR) {
        const evidence = process.env.ABRACODE_TEST_EVIDENCE_DIR;
        await mkdir(evidence, { recursive: true });
        await writeFile(
          join(evidence, "development.json"),
          JSON.stringify({ ...result, cleanup_complete: true }, null, 2),
        );
      }
    }
  },
);
