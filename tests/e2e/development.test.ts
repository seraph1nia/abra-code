import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { join } from "node:path";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { installSource, installationRoot, command } from "./install.ts";
import { launchReportBrowser } from "../../templates/reporter/scripts/browser.ts";

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
      await installSource(home);
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
        const page = await browser.newPage();
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(origin);
        await page.getByRole("textbox", { name: "Message Abra" }).waitFor({ timeout: 30000 });
        await page.goto(`${origin}/unknown-page`);
        await page.getByRole("heading", { name: "Page not found" }).waitFor();
        await page.getByRole("link", { name: "Return to AbraCode" }).click();
        await page
          .getByRole("textbox", { name: "Message Abra" })
          .fill("Keep this draft through HMR");
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
        const backend = join(home, "src/web/server.ts");
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
        await rm(root, { recursive: true, force: true });
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
