import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { OpenCode } from "@opencode/client";
import { launchReportBrowser } from "../../templates/reporter/scripts/browser.ts";

/** Drive the shipped browser UI with fresh storage and this fixture's retained Abra. */
export async function webJourney(
  home: string,
  env: NodeJS.ProcessEnv,
  sessionID: string,
  restart: () => Promise<unknown>,
) {
  const port = await new Promise<number>((done) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as import("node:net").AddressInfo).port;
      server.close(() => done(port));
    });
  });
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(
    join(home, "node_modules/.bin/tsx"),
    [join(home, "scripts/web.ts"), "--port", String(port), "--no-open"],
    { cwd: home, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let logs = "";
  child.stdout.on("data", (chunk) => {
    logs += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    logs += chunk.toString();
  });
  const exited = new Promise<void>((done) => child.once("exit", () => done()));
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    const timeout = setTimeout(() => child.kill("SIGKILL"), 5000);
    try {
      await exited;
    } finally {
      clearTimeout(timeout);
    }
  };
  try {
    const deadline = Date.now() + 30_000;
    while (!logs.includes("Abra web:")) {
      if (child.exitCode !== null || Date.now() >= deadline)
        throw new Error(`Web launcher did not become ready: ${logs}`);
      await new Promise((done) => setTimeout(done, 100));
    }
    const client = OpenCode.make({ baseUrl: origin });
    assert.equal((await client.session.get({ sessionID })).agent, "abra");
    const browser = await launchReportBrowser();
    try {
      const page = await browser.newPage();
      const failedAuth: number[] = [];
      page.on("response", (response) => {
        if (response.url().startsWith(origin) && response.status() === 401)
          failedAuth.push(response.status());
      });
      await page.goto(origin, { waitUntil: "domcontentloaded" });
      await page.locator('[contenteditable="true"]').first().waitFor({ timeout: 30000 });
      assert.ok(page.url().endsWith(`/session/${sessionID}`), page.url());
      assert.equal(await page.locator('input[type="password"]').count(), 0);
      const form = await client.session.form.create({
        sessionID,
        title: "Local web fixture decision",
        metadata: { source: "abracode", fingerprint: "fixture-exact-checkpoint" },
        fields: [{ type: "boolean", key: "approved", title: "Approve fixture", required: true }],
      });
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByText("Local web fixture decision", { exact: true }).first().waitFor();
      await page.getByRole("switch").first().press("Space");
      await page.getByRole("button", { name: /submit/i }).click();
      await page
        .getByText("Local web fixture decision", { exact: true })
        .first()
        .waitFor({ state: "hidden" });
      assert.equal(
        (await client.session.form.get({ sessionID, formID: form.id })).state.status,
        "answered",
      );
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator('[contenteditable="true"]').first().waitFor();
      const liveForm = await client.session.form.create({
        sessionID,
        title: "Live web fixture decision",
        metadata: { source: "abracode", kind: "mcp-elicitation" },
        fields: [
          { type: "boolean", key: "approved", title: "Approve live fixture", required: true },
        ],
      });
      await page.getByText("Live web fixture decision", { exact: true }).first().waitFor();
      await page.getByRole("switch").first().press("Space");
      await page.getByRole("button", { name: /submit/i }).click();
      await page
        .getByText("Live web fixture decision", { exact: true })
        .first()
        .waitFor({ state: "hidden" });
      assert.equal(
        (await client.session.form.get({ sessionID, formID: liveForm.id })).state.status,
        "answered",
      );
      await restart();
      assert.equal((await client.session.get({ sessionID })).agent, "abra");
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator('[contenteditable="true"]').first().waitFor();
      assert.ok(page.url().endsWith(`/session/${sessionID}`));
      assert.deepEqual(failedAuth, []);
      const storage = await page.context().storageState();
      assert.ok(storage.cookies.every((cookie) => !cookie.name.startsWith("opencode_session")));
      assert.doesNotMatch(JSON.stringify(storage), /"password":"[^"\s]+"/);
    } finally {
      await browser.close();
    }
    await stop();
    assert.equal(await fetch(`${origin}/api/info`).catch(() => undefined), undefined);
  } finally {
    await stop();
  }
}
