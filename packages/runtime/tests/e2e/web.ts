/* oxlint-disable effecttsgo/unstable-api-usage -- Real pinned native service discovery in a disposable source installation. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { Effect } from "effect";
import { NodeFileSystem } from "@effect/platform-node";
import { Service } from "@opencode/client/effect/service";
import { OpenCode } from "@opencode/client";
import { Permission } from "@opencode/schema/permission";
import { launchReportBrowser } from "@abracode/report-export/browser";
import { runtimePaths } from "../../src/config/identity.ts";
import { AbsolutePath } from "../../src/identities.ts";

/** Drive the shipped CopilotKit v2 UI against one disposable, retained native Abra. */
export async function webJourney(
  home: string,
  env: NodeJS.ProcessEnv,
  sessionID: string,
  restart: () => Promise<unknown>,
) {
  const native = async () => {
    const endpoint = await Effect.runPromise(
      Service.discover({
        file: runtimePaths(AbsolutePath.make(home)).service,
        version: "2.3.0",
      }).pipe(Effect.provide(NodeFileSystem.layer)),
    );
    assert.ok(endpoint);
    return OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) });
  };
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
    const deadline = Date.now() + 30000;
    while (!logs.includes("Abra web:")) {
      if (child.exitCode !== null || Date.now() >= deadline)
        throw new Error(`Web launcher did not become ready: ${logs}`);
      await new Promise((done) => setTimeout(done, 100));
    }
    const client = await native();
    const browser = await launchReportBrowser();
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(origin, { waitUntil: "domcontentloaded" });
      await page.getByRole("textbox", { name: "Message Abra" }).waitFor({ timeout: 30000 });
      assert.equal((await (await fetch(`${origin}/api/bootstrap`)).json()).session_id, sessionID);
      assert.equal((await fetch(`${origin}/api/session/${sessionID}`)).status, 404);
      assert.equal(await page.locator('input[type="password"]').count(), 0);
      const form = await client.session.form.create({
        sessionID,
        title: "Workspace field types",
        metadata: { source: "fixture" },
        fields: [
          {
            type: "boolean",
            key: "include",
            title: "Include details",
            required: true,
            default: false,
          },
          {
            type: "string",
            key: "hidden",
            title: "Hidden default",
            required: true,
            hidden: true,
            default: "retained-default",
          },
          { type: "string", key: "label", title: "Work label", required: true, minLength: 2 },
          {
            type: "number",
            key: "estimate",
            title: "Estimate",
            minimum: 0,
            maximum: 5,
            default: 1.5,
          },
          { type: "integer", key: "count", title: "Count", minimum: 0, maximum: 5, default: 1 },
          {
            type: "string",
            key: "choice",
            title: "Destination",
            options: [
              { value: "local", label: "Local" },
              { value: "remote", label: "Remote" },
            ],
            custom: false,
            default: "local",
          },
          {
            type: "multiselect",
            key: "views",
            title: "Views",
            options: [
              { value: "board", label: "Board" },
              { value: "table", label: "Table" },
            ],
            minItems: 1,
            maxItems: 2,
            default: ["board"],
          },
          {
            type: "string",
            key: "details",
            title: "Additional details",
            required: true,
            when: [{ key: "include", op: "eq", value: true }],
          },
          {
            type: "external",
            key: "docs",
            title: "Open documentation",
            url: "https://example.com/docs",
          },
        ],
      });
      await page.getByRole("button", { name: "Review next" }).click();
      await page.getByRole("heading", { name: "Workspace field types" }).waitFor();
      await page.getByLabel("Work label").fill("Planning");
      assert.equal(await page.getByLabel("Additional details").count(), 0);
      await page.getByRole("checkbox", { name: /Include details/ }).check();
      await page.getByLabel("Additional details").fill("One session");
      await page.getByLabel("Count", { exact: false }).fill("2");
      await page.getByLabel("Destination").selectOption("remote");
      await page.getByRole("checkbox", { name: "Table", exact: true }).check();
      await page
        .getByRole("checkbox", { name: "I have completed: Open documentation", exact: true })
        .check();
      const replyResponse = page.waitForResponse(
        (response) => response.url() === `${origin}/api/form/reply`,
      );
      await page.getByRole("button", { name: "Submit answer", exact: true }).click();
      const reply = await replyResponse;
      assert.equal(reply.status(), 200, await reply.text());
      await page
        .getByRole("heading", { name: "Workspace field types" })
        .waitFor({ state: "hidden" });
      const answered = await client.session.form.get({ sessionID, formID: form.id });
      assert.equal(answered.state.status, "answered");
      if (answered.state.status === "answered")
        assert.deepEqual(answered.state.answer, {
          include: true,
          hidden: "retained-default",
          label: "Planning",
          estimate: 1.5,
          count: 2,
          choice: "remote",
          views: ["board", "table"],
          details: "One session",
          docs: true,
        });
      const stale = await client.session.form.create({
        sessionID,
        title: "Unbound controller checkpoint",
        metadata: { source: "abracode", fingerprint: "unbound" },
        fields: [{ type: "boolean", key: "authorize", title: "Authorize", default: false }],
      });
      await page.getByRole("heading", { name: "Unbound controller checkpoint" }).waitFor();
      assert.equal(
        await page.getByRole("button", { name: "Submit answer", exact: true }).isDisabled(),
        true,
      );
      await client.session.form.cancel({ sessionID, formID: stale.id });
      // Restrict these synthetic fixture actions to native human permission.
      const originalPermissions = (await client.session.get({ sessionID })).permissions ?? [];
      await client.session.update({
        sessionID,
        permissions: [
          ...originalPermissions,
          ...(["once", "reject", "always"] as const).map((decision) => ({
            action: `workspace-fixture-${decision}`,
            resource: "*",
            effect: "ask" as const,
          })),
        ],
      });
      for (const decision of ["once", "reject", "always"] as const) {
        const id = Permission.ID.create();
        const action = `workspace-fixture-${decision}`;
        const pending = client.permission
          .create({
            sessionID,
            id,
            action,
            resources: ["disposable-fixture-resource"],
            save: ["disposable-fixture-resource"],
          })
          .then(
            (value) => ({ value }),
            (error: unknown) => ({ error }),
          );
        const card = page
          .locator(".attention-card")
          .filter({ has: page.getByRole("heading", { name: action, exact: true }) });
        await card.waitFor();
        const staleReply = await fetch(`${origin}/api/permission/reply`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: origin },
          body: JSON.stringify({ id, binding: "superseded-binding", decision }),
        });
        assert.notEqual(staleReply.status, 200);
        assert.ok(
          (await client.permission.list({ sessionID })).some((request) => request.id === id),
        );
        const response = page.waitForResponse(
          (reply) => reply.url() === `${origin}/api/permission/reply`,
        );
        await card
          .getByRole("button", {
            name:
              decision === "once"
                ? "Allow once"
                : decision === "always"
                  ? "Always allow"
                  : "Reject",
            exact: true,
          })
          .click();
        assert.equal((await response).status(), 200);
        const result = await pending;
        assert.deepEqual(result, { value: { id, effect: "ask" } });
        await card.waitFor({ state: "hidden" });
        assert.equal(
          (await client.permission.list({ sessionID })).some((request) => request.id === id),
          false,
        );
      }
      await client.session.update({ sessionID, permissions: originalPermissions });
      await page.reload();
      await page.getByRole("textbox", { name: "Message Abra" }).waitFor();
      const evidence = process.env.ABRACODE_TEST_EVIDENCE_DIR;
      if (evidence) {
        await mkdir(evidence, { recursive: true });
        await page.screenshot({ path: join(evidence, "workspace-desktop.png"), fullPage: true });
      }
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
        false,
      );
      await page.getByRole("button", { name: "Toggle work finder" }).click();
      await page.getByRole("button", { name: "Close work finder" }).click();
      if (evidence)
        await page.screenshot({ path: join(evidence, "workspace-narrow.png"), fullPage: true });
      await restart();
      assert.equal((await (await native()).session.get({ sessionID })).agent, "abra");
      await page.reload();
      await page.getByRole("textbox", { name: "Message Abra" }).waitFor();
      assert.equal((await (await fetch(`${origin}/api/bootstrap`)).json()).session_id, sessionID);
      assert.deepEqual(errors, []);
      const storage = await page.context().storageState();
      assert.ok(storage.cookies.every((cookie) => !cookie.name.startsWith("opencode_session")));
      assert.doesNotMatch(JSON.stringify(storage), /"password":"[^"\s]+"/);
    } finally {
      await browser.close();
    }
    await stop();
    assert.equal(await fetch(`${origin}/api/bootstrap`).catch(() => undefined), undefined);
    assert.equal((await (await native()).session.get({ sessionID })).agent, "abra");
  } finally {
    await stop();
  }
}
