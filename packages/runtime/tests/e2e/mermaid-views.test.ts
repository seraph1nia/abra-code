import { createHash } from "node:crypto";
import { coveredReportDocument } from "../helpers/report-document.ts";
import assert from "node:assert/strict";
import { expect, test } from "vite-plus/test";
import { workspaceBrowserFixture } from "../helpers/workspace-browser.ts";
import { catalogId } from "@abracode/contracts/web/catalog";
import { validateSurface } from "@abracode/contracts/web/surfaces";
import { Schema } from "effect";
import { WorkspaceSnapshotSchema } from "@abracode/contracts/web/workspace-wire";

function diagramRecord(
  source: Awaited<ReturnType<typeof workspaceBrowserFixture>>["source"],
  revision: number,
) {
  return {
    session_id: source.sessionID,
    tool_call_id: "race",
    revision,
    at: source.value.at,
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
  };
}

test("diagram views discard canceled revision responses and keep source after preparation loss", async (t) => {
  const f = await workspaceBrowserFixture();
  t.onTestFinished(f.close);
  const record = (revision: number) => diagramRecord(f.source, revision);
  const reference = (revision: number) => ({
    surface_id: "diagram-race",
    revision,
    at: f.source.value.at,
  });
  f.source.value = { ...f.source.value, surfaces: [reference(1)] };
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
  let recovered = false;
  let thirdRequests = 0;
  await page.route("**/api/diagrams/prepare", async (route) => {
    const selection = route.request().postDataJSON();
    if (selection.revision === 1) {
      entered();
      await waiting;
    }
    if (selection.revision === 3) thirdRequests++;
    if (selection.revision === 3 && !recovered)
      return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
    await route.continue().catch(() => {});
  });
  await page.goto(f.origin);
  await page.getByText("Other retained views (1)", { exact: true }).click();
  await page.getByText("Diagram revision 1", { exact: true }).waitFor();
  await first;
  f.source.surfaceHistory.set("diagram-race/2", record(2));
  f.source.value = { ...f.source.value, surfaces: [reference(2)] };
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
      (element) =>
        element.textContent?.trim() === "Expand diagram" && element === document.activeElement,
    ),
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Expand diagram", exact: true })
      .evaluate((element) => element === document.activeElement),
    true,
  );
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  f.source.surfaceHistory.set("diagram-race/3", record(3));
  f.source.value = { ...f.source.value, surfaces: [reference(3)] };
  await f.changed();
  await page.getByText("Diagram revision 3", { exact: true }).waitFor();
  await page.getByRole("status").filter({ hasText: "Diagram rendering is unavailable" }).waitFor();
  assert.match((await page.locator(".mermaid-diagram code").textContent())!, /Evidence3/);
  assert.equal(await page.locator('[data-diagram-state="ready"]').count(), 0);
  recovered = true;
  await page.getByRole("button", { name: "Refresh retained evidence", exact: true }).click();
  await page.locator('[data-diagram-state="ready"]').waitFor({ timeout: 10_000 });
  assert.equal(thirdRequests, 2);
  recovered = false;
  await page.getByRole("button", { name: "Retry diagrams", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Diagram rendering is unavailable" }).waitFor();
  recovered = true;
  await page.getByRole("button", { name: "Retry diagrams", exact: true }).click();
  await page.locator('[data-diagram-state="ready"]').waitFor();
  assert.equal(thirdRequests, 4);
  await page.close();
  assert.equal(f.source.submissions, 0);
  assert.equal(f.source.stops, 0);
});

test("duplicate diagram placements share exact preparation and detach independently", async (t) => {
  const f = await workspaceBrowserFixture();
  let releaseFirst!: () => void, releaseSecond!: () => void, entered!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const secondGate = new Promise<void>((resolve) => {
    releaseSecond = resolve;
  });
  const firstRequest = new Promise<void>((resolve) => {
    entered = resolve;
  });
  t.onTestFinished(async () => {
    releaseFirst();
    releaseSecond();
    await f.close();
  });
  const report = coveredReportDocument(true);
  const json = JSON.stringify(report),
    hash = createHash("sha256").update(json).digest("hex");
  f.documentArtifacts.set(report.document_id, {
    json,
    hash,
    bytes: Buffer.byteLength(json),
    title: report.title,
  });
  const target = {
    kind: "artifact" as const,
    issue_id: report.provenance.issue_id,
    request_id: report.document_id,
    hash,
  };
  f.source.value = Schema.decodeSync(WorkspaceSnapshotSchema)({
    ...f.source.value,
    messages: [
      {
        id: "msg_shared_report",
        role: "assistant",
        text: "Retained report placements",
        at: f.source.value.at,
      },
    ],
    presentations: {
      entries: [
        {
          session_id: f.source.sessionID,
          source: "notice",
          message_id: "msg_shared_report",
          target,
        },
      ],
      truncated: false,
    },
  });
  const page = await f.browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const requests: unknown[] = [];
  await page.route("**/api/diagrams/prepare", async (route) => {
    requests.push(route.request().postDataJSON());
    entered();
    await (requests.length === 1 ? firstGate : secondGate);
    await route.continue().catch(() => {});
  });
  await page.goto(
    `${f.origin}/?${new URLSearchParams({ resource: JSON.stringify({ action: "open_artifact", ...target, kind: undefined }) })}`,
  );
  await firstRequest;
  await page.getByText("Preview saved report", { exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".generated-surface").length === 2);
  assert.equal(requests.length, 1);
  // Detach by closing a placement. Removing a message from the native recent
  // window intentionally retains its already-loaded historical reader.
  await page.getByText("Preview saved report", { exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".generated-surface").length === 1);
  assert.equal(requests.length, 1);
  releaseFirst();
  await page.locator('[data-diagram-state="ready"]').first().waitFor();
  await page.getByRole("button", { name: "Retry diagrams", exact: true }).click();
  await expect.poll(() => requests.length).toBe(2);
  assert.equal(
    await page.getByRole("button", { name: "Retry diagrams", exact: true }).isDisabled(),
    true,
  );
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1], requests[0]);
  const aborted = page.waitForEvent("requestfailed", {
    predicate: (request) => request.url().includes("/api/diagrams/prepare"),
  });
  await page.getByRole("button", { name: "Close inspector", exact: true }).click();
  await aborted;
  releaseSecond();
  assert.equal(f.source.submissions, 0);
  assert.equal(f.source.stops, 0);
  assert.equal(f.saves.length, 0);
});
