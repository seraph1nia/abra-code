import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { workspaceBrowserFixture } from "../helpers/workspace-browser.ts";
import { catalogId } from "../../src/web/catalog.ts";
import { validateSurface } from "../../src/web/surfaces.ts";

test("diagram views discard canceled revision responses and keep source after preparation loss", async (t) => {
  const f = await workspaceBrowserFixture();
  t.onTestFinished(f.close);
  const record = (revision: number) => ({
    session_id: f.source.sessionID,
    tool_call_id: "race",
    revision,
    at: f.source.value.at,
    snapshot: [],
    surface: validateSurface({
      version: "1.0",
      createSurface: {
        surfaceId: "diagram-race",
        catalogId,
        components: [
          { id: "root", component: "Column", children: ["heading", "diagram"] },
          { id: "heading", component: "Text", text: `Diagram revision ${revision}` },
          {
            id: "diagram",
            component: "Mermaid",
            title: `Evidence ${revision}`,
            description: "Exact retained relationships",
            source: `flowchart LR\nA --> Evidence${revision}`,
          },
        ],
      },
    }),
  });
  f.source.value = { ...f.source.value, surfaces: [record(1)] };
  f.source.surfaceHistory.set("diagram-race/1", record(1));
  const page = await f.browser.newPage({ viewport: { width: 390, height: 844 } });
  let release!: () => void, entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = new Promise<void>((resolve) => {
    entered = resolve;
  });
  t.onTestFinished(release);
  await page.route("**/api/diagrams/prepare", async (route) => {
    const selection = route.request().postDataJSON();
    if (selection.revision === 1) {
      entered();
      await waiting;
    }
    if (selection.revision === 3)
      return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
    await route.continue().catch(() => {});
  });
  await page.goto(f.origin);
  await page.getByText("Other retained views (1)", { exact: true }).click();
  await page.getByText("Diagram revision 1", { exact: true }).waitFor();
  await first;
  f.source.value = { ...f.source.value, surfaces: [record(2)] };
  await f.changed();
  await page.getByText("Diagram revision 2", { exact: true }).waitFor();
  await page.locator('[data-diagram-state="ready"]').waitFor();
  release();
  assert.match((await page.locator(".mermaid-diagram code").textContent())!, /Evidence2/);
  await page.getByRole("button", { name: "Expand diagram", exact: true }).click();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await page.getByRole("dialog").press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll("button")).some(
      (element) => element.textContent === "Expand diagram" && element === document.activeElement,
    ),
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Expand diagram", exact: true })
      .evaluate((element) => element === document.activeElement),
    true,
  );
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  f.source.value = { ...f.source.value, surfaces: [record(3)] };
  await f.changed();
  await page.getByText("Diagram revision 3", { exact: true }).waitFor();
  await page.getByRole("status").filter({ hasText: "Diagram rendering is unavailable" }).waitFor();
  assert.match((await page.locator(".mermaid-diagram code").textContent())!, /Evidence3/);
  assert.equal(await page.locator('[data-diagram-state="ready"]').count(), 0);
  await page.close();
  assert.equal(f.source.submissions, 0);
  assert.equal(f.source.stops, 0);
});
