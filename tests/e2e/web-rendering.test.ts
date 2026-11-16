/* oxlint-disable effecttsgo/unstable-api-usage -- Shipped browser assets and disposable Effect HTTP fixture. */
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Effect, Exit, Scope } from "effect";
import { WorkspaceFixture } from "../helpers/web.ts";
import { workspaceServer } from "../../src/web/server.ts";
import { catalogId, workComponentNames } from "../../src/web/catalog.ts";
import { validateSurface } from "../../src/web/surfaces.ts";
import { IssueId, ObligationKey } from "../../src/identities.ts";
import { launchReportBrowser } from "../../apps/report/scripts/browser.ts";

test("upstream A2UI renders every work widget, replaces revisions and retains valid state after malformed SSE", async (t) => {
  const backend = new WorkspaceFixture();
  const work = backend.value.work.work[0];
  backend.value = {
    ...backend.value,
    work: {
      ...backend.value.work,
      work: [
        {
          ...work,
          title: "Task with dependencies",
          dependencies: [IssueId.make("abra-first")],
          dependency_count: 1,
          blockers: ["Capacity wait, not a dependency"],
          progress: {
            generation: 0,
            session_id: backend.sessionID,
            at: 30,
            summary: "Latest captured progress",
            source: "worker",
          },
          decisions: [
            {
              key: ObligationKey.make("scope"),
              generation: 2,
              scope: "Task",
              question: "Retained scope question",
              owner: "user",
              session_id: backend.sessionID,
              opened_at: 20,
              status: "open",
            },
          ],
        },
        {
          ...work,
          issue_id: IssueId.make("abra-first"),
          title: "Earlier task",
          issue_status: "unavailable",
          progress: {
            generation: 0,
            session_id: backend.sessionID,
            at: 10,
            summary: "Earlier captured progress",
            source: "native",
          },
        },
      ],
    },
  };
  const scope = await Effect.runPromise(Scope.make());
  const web = await Effect.runPromise(
    workspaceServer({ port: 0, backend }).pipe(Effect.provideService(Scope.Scope, scope)),
  );
  const browser = await launchReportBrowser();
  t.onTestFinished(async () => {
    await browser.close();
    await Effect.runPromise(Scope.close(scope, Exit.void));
  });
  const record = (revision: number) => ({
    session_id: backend.sessionID,
    tool_call_id: "native-call",
    revision,
    at: backend.value.at,
    snapshot: backend.value.work.work,
    surface: validateSurface({
      version: "1.0",
      createSurface: {
        surfaceId: "board",
        catalogId,
        components: [
          { id: "root", component: "Column", children: ["heading", "widgets"] },
          { id: "heading", component: "Text", text: `Upstream revision ${revision}` },
          {
            id: "widgets",
            component: "Row",
            children: workComponentNames.map((_, i) => `widget${i}`),
          },
          ...workComponentNames.map((component, i) => ({
            id: `widget${i}`,
            component,
            ...(component === "ReportLink"
              ? { issueId: "abra-web" }
              : component === "ResourceLink"
                ? {
                    label: "Inspect captured changes",
                    target: { action: "open_changes", issue_id: "abra-web" },
                  }
                : component === "ReportEvidence"
                  ? { section: "checks" }
                  : { issueIds: ["abra-web", "abra-first"], mode: "snapshot" }),
          })),
        ],
      },
    }),
  });
  backend.value = { ...backend.value, surfaces: [record(1)] };
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(web.origin);
  await page.getByText("Other retained views (1)", { exact: true }).click();
  await page.getByText("Upstream revision 1", { exact: true }).waitFor();
  assert.equal(await page.locator('[data-a2ui-renderer="upstream"]').count(), 1);
  assert.equal(await page.locator(".surface-widget").count(), 8);
  assert.deepEqual(await page.locator(".work-table thead th").allTextContents(), [
    "Task",
    "State",
    "Priority",
    "Latest progress",
  ]);
  assert.equal(await page.locator(".work-table tbody tr").count(), 2);
  assert.deepEqual(
    await page
      .locator(".timeline time")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("datetime"))),
    [10, 20, 30].map((at) => new Date(at).toISOString()),
  );
  assert.equal(
    await page
      .locator(".dependency-graph > li")
      .first()
      .getByRole("button", { name: "Earlier task", exact: true })
      .count(),
    1,
  );
  assert.equal(
    await page
      .locator(".kanban > section")
      .last()
      .getByRole("button", { name: /Earlier task/ })
      .count(),
    1,
  );
  // Every widget must remain inside the conversation at narrow widths; tables
  // and boards scroll locally, while generated Row layouts wrap.
  for (const width of [375, 390]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    assert.equal(
      await page
        .locator(".surface-widget")
        .evaluateAll((nodes) =>
          nodes.some((node) => node.getBoundingClientRect().right > innerWidth + 1),
        ),
      false,
    );
    const evidence = process.env.ABRACODE_TEST_EVIDENCE_DIR;
    if (evidence) {
      await mkdir(evidence, { recursive: true });
      await page.screenshot({
        path: join(evidence, `catalog-widgets-${width}.png`),
        fullPage: true,
      });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Inspect captured changes", exact: true }).click();
  await page.getByRole("button", { name: "Close inspector", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.getByRole("button", { name: "Close inspector", exact: true }).click();
  backend.value = { ...backend.value, surfaces: [record(2)] };
  await page.getByText("Upstream revision 2", { exact: true }).waitFor();
  assert.equal(await page.locator(".generated-surface").count(), 1);
  await page.route("**/api/copilotkit/agent/abra/connect", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: `data: ${JSON.stringify({ type: "STATE_SNAPSHOT", snapshot: { workspace: { ...backend.value, busy: "invalid" } } })}\n\n`,
    }),
  );
  await page.reload();
  await page.getByText("Other retained views (1)", { exact: true }).click();
  await page.getByText("Upstream revision 2", { exact: true }).waitFor();
  await page
    .getByRole("alert")
    .filter({
      hasText: "Workspace update unavailable. Showing the last valid state.",
    })
    .waitFor();
  assert.equal(await page.locator(".surface-widget").count(), 8);
  const evidence = process.env.ABRACODE_TEST_EVIDENCE_DIR;
  if (evidence) {
    await mkdir(evidence, { recursive: true });
    await page.screenshot({
      path: join(evidence, "upstream-a2ui-state-recovery.png"),
      fullPage: true,
    });
  }
  assert.deepEqual(errors, []);
  await page.close();
  assert.equal(backend.stops, 0);
  assert.equal(backend.submissions, 0);
});
