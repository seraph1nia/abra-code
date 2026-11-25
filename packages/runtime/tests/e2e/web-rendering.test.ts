import { chooseAppearance } from "../helpers/workspace-browser.ts";
import { analysisCharts } from "../helpers/chart-fixtures.ts";
import { workspaceBrowserFixture } from "../helpers/workspace-browser.ts";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Effect, Exit, Scope } from "effect";
import { WorkspaceFixture } from "../helpers/web.ts";
import { workspaceServer } from "../../src/web/server.ts";
import {
  catalogId,
  workComponentNames,
  type WorkComponentName,
} from "@abracode/contracts/web/catalog";
import { validateSurface } from "@abracode/contracts/web/surfaces";
import { IssueId, ObligationKey } from "@abracode/contracts/identities";
import { launchReportBrowser } from "@abracode/report-export/browser";

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
  const chartData = [
    { label: "Open", value: 2 },
    { label: "Closed", value: 5 },
  ];
  function widgetProps(component: WorkComponentName) {
    switch (component) {
      case "Histogram":
      case "ScatterPlot":
      case "Heatmap":
      case "GanttChart":
        return analysisCharts[component];
      case "LineChart":
      case "BarChart":
        return { title: component, data: chartData };
      case "PieChart":
        return { title: component, data: chartData, orientation: "horizontal" };
      case "Mermaid":
        return { title: "Diagram", source: "flowchart LR\nA --> B" };
      case "ReportLink":
        return { issueId: "abra-web" };
      case "ResourceLink":
        return {
          label: "Inspect captured changes",
          target: { action: "open_changes", issue_id: "abra-web" },
        };
      case "ReportEvidence":
        return { section: "checks" };
      default:
        return { issueIds: ["abra-web", "abra-first"], mode: "snapshot" };
    }
  }
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
            children: [
              ...workComponentNames.map((_, i) => `widget${i}`),
              "horizontal",
              "stacked",
              "segments",
              "horizontalSegments",
              "identical",
            ],
          },
          ...workComponentNames.map((component, i) => ({
            ...widgetProps(component),
            component,
            id: `widget${i}`,
          })),
          {
            id: "horizontal",
            component: "BarChart",
            title: "Horizontal bars",
            data: chartData,
            orientation: "horizontal",
          },
          { id: "stacked", component: "PieChart", title: "Stacked pie", data: chartData },
          {
            ...analysisCharts.Histogram,
            id: "identical",
            title: "Identical times",
            data: [0, 0, 0],
          },
          analysisCharts.BarChart,
          {
            ...analysisCharts.BarChart,
            id: "horizontalSegments",
            title: "Horizontal backlog",
            orientation: "horizontal",
          },
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
  for (const title of ["LineChart", "BarChart", "PieChart", "Horizontal bars", "Stacked pie"]) {
    const figure = page.getByRole("figure", { name: title, exact: true });
    await figure.locator("svg").waitFor();
    if (title.includes("pie") || title === "PieChart") {
      assert.ok((await figure.locator("path[d]").count()) >= 2);
      assert.deepEqual(await figure.locator("dt").allTextContents(), ["Open", "Closed"]);
      assert.equal(await figure.locator(".chart-beside").count(), title === "PieChart" ? 1 : 0);
    } else if (title === "LineChart") {
      assert.equal(await figure.locator("circle").count(), 2);
    } else {
      const bars = await figure
        .locator("svg rect")
        .evaluateAll((nodes) =>
          nodes
            .filter((node) => node.getAttribute("fill") === "var(--primary)")
            .map((node) => node.getBoundingClientRect()),
        );
      assert.equal(bars.length, 2);
      assert.equal(bars[0].x === bars[1].x, title === "Horizontal bars");
    }
  }
  const figure = (name: string) => page.getByRole("figure", { name, exact: true });
  for (const [title, horizontal] of [
    ["Backlog", false],
    ["Horizontal backlog", true],
  ] as const) {
    const bars = figure(title).locator(".ts-chart__bar rect");
    await bars.first().waitFor();
    const [first, second, third] = await bars.evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect()),
    );
    assert.equal(horizontal ? first.y : first.x, horizontal ? second.y : second.x);
    assert.notEqual(horizontal ? first.y : first.x, horizontal ? third.y : third.x);
    assert.ok(Math.abs(horizontal ? first.right - second.left : first.top - second.bottom) < 1);
    assert.deepEqual(await figure(title).getByRole("listitem").allTextContents(), [
      "Open",
      "Blocked",
    ]);
  }
  const histogram = figure("Cycle times");
  await histogram.locator(".ts-chart__rect rect").first().waitFor();
  assert.equal(
    await histogram
      .locator("tbody tr td:last-child")
      .evaluateAll((nodes) => nodes.reduce((sum, node) => sum + Number(node.textContent), 0)),
    5,
  );
  const identical = figure("Identical times");
  await identical.locator(".ts-chart__bar rect").waitFor();
  assert.deepEqual(await identical.locator("tbody td").allTextContents(), ["0", "3"]);
  assert.equal(await figure("Review time").locator("svg circle").count(), 2);
  const cells = await figure("Failures")
    .locator(".ts-chart__rect rect")
    .evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).fill));
  assert.equal(cells.length, 3);
  assert.equal(new Set(cells).size, 3);
  const lanes = await figure("Task intervals")
    .locator(".ts-chart__rect rect")
    .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect()));
  assert.equal(lanes.length, 2);
  assert.ok(
    lanes[0].left < lanes[1].left &&
      lanes[1].left < lanes[0].right &&
      lanes[0].right < lanes[1].right,
  );
  assert.notEqual(lanes[0].y, lanes[1].y);
  assert.deepEqual(
    await page.locator(".topbar h1").evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.fontSize, style.fontWeight];
    }),
    ["14px", "600"],
  );
  assert.equal(await page.locator('[data-a2ui-renderer="upstream"]').count(), 1);
  assert.equal(await page.locator(".surface-widget").count(), 8);
  assert.deepEqual(await page.locator(".work-table thead th").allTextContents(), [
    "Task",
    "State",
    "Priority",
    "Latest update",
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
  for (const width of [1440, 375, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const theme of ["light", "dark"]) {
      await chooseAppearance(page, theme);
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
        // The transcript scrolls independently of the page. Capture the cards
        // in its visible reading area rather than the introduction above them.
        await page.locator(".kanban").scrollIntoViewIfNeeded();
        await page.screenshot({
          path: join(evidence, `catalog-widgets-${width}-${theme}.png`),
          fullPage: true,
        });
      }
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Inspect captured changes", exact: true }).click();
  await page.getByRole("button", { name: "Close inspector", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.getByRole("button", { name: "Close inspector", exact: true }).click();
  const originalRoot = await page
    .locator(".generated-surface a2ui-basic-column")
    .first()
    .elementHandle();
  assert.ok(originalRoot);
  backend.value = { ...backend.value, surfaces: [record(2)] };
  await page.getByText("Upstream revision 2", { exact: true }).waitFor();
  assert.equal(await originalRoot.evaluate((node) => node.isConnected), true);
  await originalRoot.dispose();
  assert.equal(await page.locator(".generated-surface").count(), 1);
  let bootstrapReads = 0;
  let releaseRecovery!: () => void;
  const recovery = new Promise<void>((resolve) => {
    releaseRecovery = resolve;
  });
  t.onTestFinished(() => releaseRecovery());
  await page.route("**/api/bootstrap", async (route) => {
    if (++bootstrapReads > 1) await recovery;
    if (!page.isClosed()) await route.continue();
  });
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
  await page.unroute("**/api/copilotkit/agent/abra/connect");
  releaseRecovery();
  await page
    .getByRole("alert")
    .filter({ hasText: "Workspace update unavailable. Showing the last valid state." })
    .waitFor({ state: "hidden" });
  assert.ok(bootstrapReads >= 2, "Malformed state must request a replacement baseline");
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

test("live generated widgets resolve off-page tasks, share queries and label stale or missing data", async (t) => {
  const f = await workspaceBrowserFixture();
  t.onTestFinished(f.close);
  const base = f.source.value.work.work[0]!;
  const rows = Array.from({ length: 60 }, (_, i) => ({
    ...base,
    issue_id: IssueId.make(`abra-closed-${String(i).padStart(2, "0")}`),
    title: `Closed task ${i}`,
    issue_status: "closed" as const,
  }));
  f.setDiscovery(rows);
  const id = rows[54]!.issue_id;
  f.source.value = {
    ...f.source.value,
    work: { ...f.source.value.work, work: rows.slice(0, 50) },
    surfaces: [
      {
        session_id: f.source.sessionID,
        tool_call_id: "offpage",
        revision: 1,
        at: f.source.value.at,
        snapshot: [{ ...rows[54]!, title: "Original captured task" }],
        surface: validateSurface({
          version: "1.0",
          createSurface: {
            surfaceId: "offpage",
            catalogId,
            components: [
              { id: "root", component: "Column", children: ["table", "count", "snapshot"] },
              { id: "table", component: "WorkTable", issueIds: [id], mode: "live" },
              { id: "count", component: "StatusSummary", issueIds: [id], mode: "live" },
              { id: "snapshot", component: "WorkTable", issueIds: [id], mode: "snapshot" },
            ],
          },
        }),
      },
    ],
  };
  const page = await f.browser.newPage({ viewport: { width: 1440, height: 1000 } });
  f.failedReads.add("binding");
  await page.goto(f.origin);
  await page.getByText("Other retained views (1)", { exact: true }).click();
  const publication = page.locator(".surface-publication");
  await page.getByText("Couldn’t load current work.").waitFor();
  assert.equal(await publication.locator(".metrics dd").count(), 0);
  await publication.locator("table").first().waitFor();
  assert.equal(await publication.locator("table").count(), 1, "Only the saved table is visible");
  f.failedReads.delete("binding");
  await page
    .getByRole("alert")
    .filter({ hasText: "Couldn’t load current work." })
    .getByRole("button", { name: "Retry", exact: true })
    .click();
  const live = page.locator('[data-work-widget="WorkTable"]').first();
  await live.getByRole("button", { name: "Closed task 54", exact: true }).waitFor();
  assert.equal(f.calls.filter((call) => call.name === "binding").length, 2);
  assert.match(await page.locator(".generated-surface").innerText(), /Original captured task/);
  const count = page.locator('[data-work-widget="StatusSummary"]');
  assert.match(await count.innerText(), /Complete selection/);
  rows[54] = { ...rows[54]!, title: "Refreshed off-page title" };
  f.setDiscovery(rows);
  f.source.value = {
    ...f.source.value,
    work: { ...f.source.value.work, work_revision: String(f.calls.length) },
  };
  await f.changed();
  await live.getByText("Refreshed off-page title", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Original captured task", exact: true }).waitFor();
  f.failedReads.add("binding");
  f.source.value = {
    ...f.source.value,
    work: { ...f.source.value.work, work_revision: String(f.calls.length) },
  };
  await f.changed();
  await live.getByText(/Stale data/).waitFor();
  await live.getByText("Refreshed off-page title", { exact: true }).waitFor();
  f.failedReads.delete("binding");
  f.setDiscovery(rows.filter((row) => row.issue_id !== id));
  f.source.value = {
    ...f.source.value,
    work: { ...f.source.value.work, work_revision: String(f.calls.length) },
  };
  await f.changed();
  await live.getByText(/Unavailable requested data/).waitFor();
  assert.equal(await live.locator("tbody tr").count(), 0);
  assert.match(await count.innerText(), /Unavailable/);
  for (const width of [375, 390]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
  }
  assert.equal(f.source.submissions, 0);
  const directory = process.env.ABRACODE_TEST_EVIDENCE_DIR;
  if (directory) {
    await mkdir(directory, { recursive: true });
    await page.screenshot({ path: join(directory, "offpage-bindings.png"), fullPage: true });
  }
});

test("replaced live selections ignore a late read and show pending counts without false zeroes", async (t) => {
  const f = await workspaceBrowserFixture();
  t.onTestFinished(f.close);
  const base = f.source.value.work.work[0]!;
  const rows = [54, 53].map((i) => ({
    ...base,
    issue_id: IssueId.make(`abra-history-${i}`),
    title: `Live selection ${i}`,
  }));
  f.setDiscovery(rows);
  const record = (revision: number, id: string) => ({
    session_id: f.source.sessionID,
    tool_call_id: `selection-${revision}`,
    revision,
    at: f.source.value.at,
    snapshot: rows,
    surface: validateSurface({
      version: "1.0",
      createSurface: {
        surfaceId: "selection",
        catalogId,
        components: [
          { id: "root", component: "Column", children: ["table", "counts"] },
          { id: "table", component: "WorkTable", mode: "live", issueIds: [id] },
          { id: "counts", component: "StatusSummary", mode: "live", issueIds: [id] },
        ],
      },
    }),
  });
  f.source.value = { ...f.source.value, surfaces: [record(1, rows[0]!.issue_id)] };
  const page = await f.browser.newPage();
  let release!: () => void, started!: () => void, finished!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    started = resolve;
  });
  const ended = new Promise<void>((resolve) => {
    finished = resolve;
  });
  t.onTestFinished(() => release());
  await page.route("**/api/work/binding?*", async (route) => {
    if (route.request().url().includes("abra-history-54")) {
      started();
      await gate;
      try {
        if (!page.isClosed()) await route.continue();
      } catch {
        /* canceled obsolete read */
      } finally {
        finished();
      }
    } else await route.continue();
  });
  await page.goto(f.origin);
  await page.getByText("Other retained views (1)", { exact: true }).click();
  await pending;
  await page.getByText("Loading current work…").waitFor();
  assert.equal(await page.locator(".metrics dd").count(), 0);
  f.source.value = { ...f.source.value, surfaces: [record(2, rows[1]!.issue_id)] };
  await f.changed();
  const table = page.locator('[data-work-widget="WorkTable"]');
  await table.getByRole("button", { name: "Live selection 53", exact: true }).waitFor();
  release();
  await ended;
  assert.equal(await table.getByText("Live selection 54", { exact: true }).count(), 0);
  assert.equal(await table.getByText("Live selection 53", { exact: true }).count(), 1);
  await page.close();
  assert.equal(f.source.stops, 0);
  assert.equal(f.source.submissions, 0);
});

test("work catalog renders the basic components, binds local inputs and prepares button events", async (t) => {
  const f = await workspaceBrowserFixture();
  t.onTestFinished(f.close);
  const field = { "@path": "/note" };
  const snippet = "if (ready) {\r\n\tlog('<b>😀</b>');\r\n}\r\n\r\n";
  const entries = [
    { id: "log", component: "CodeBlock", code: "  raw <b>output</b>\n", language: "Build log" },
    { id: "card", component: "Card", child: "table" },
    { id: "list", component: "List", children: { componentId: "item", path: "/items" } },
    { id: "facts", component: "KeyValueList", entries: [{ label: "Branch", value: "trunk" }] },
    { id: "details", component: "Disclosure", label: "View code", child: "code" },
    {
      id: "tabs",
      component: "Tabs",
      tabs: [
        { title: "First tab", child: "icon" },
        { title: "Second tab", child: "tabText" },
      ],
    },
    { id: "modal", component: "Modal", trigger: "trigger", content: "modalText" },
    { id: "line", component: "Divider" },
    {
      id: "image",
      component: "Image",
      url: "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
      description: "Catalog image",
    },
    { id: "video", component: "Video", url: "data:video/mp4;base64," },
    { id: "audio", component: "AudioPlayer", url: "data:audio/wav;base64,", description: "Sound" },
    { id: "entry", component: "TextField", label: "Change note", value: field },
    { id: "echo", component: "Text", text: field },
    { id: "check", component: "CheckBox", label: "Enabled", value: { "@path": "/enabled" } },
    {
      id: "choice",
      component: "ChoicePicker",
      value: { "@path": "/choices" },
      options: [{ label: "Alpha", value: "a" }],
    },
    { id: "slider", component: "Slider", value: { "@path": "/count" }, max: 10 },
    {
      id: "formatted",
      component: "Text",
      text: { "@call": "formatNumber", args: { value: { "@path": "/count" }, decimals: 2 } },
    },
    { id: "date", component: "DateTimeInput", value: { "@path": "/date" }, enableDate: true },
    {
      id: "link",
      component: "Button",
      child: "linkLabel",
      action: {
        functionCall: {
          "@call": "openUrl",
          args: { url: f.origin + "/catalog/work/v1/catalog.json" },
        },
      },
    },
    {
      id: "button",
      component: "Button",
      child: "actionLabel",
      action: { event: { name: "review", userMessage: field } },
    },
  ];
  const surface = validateSurface({
    version: "1.0",
    createSurface: {
      catalogId,
      surfaceId: "basic",
      dataModel: {
        note: "Initial note",
        count: 3,
        enabled: false,
        date: "2026-11-21",
        choices: [],
        items: [{ value: "List row" }],
      },
      components: [
        { id: "root", component: "Column", children: ["row"] },
        { id: "row", component: "Row", children: entries.map((entry) => entry.id) },
        ...entries,
        {
          id: "table",
          component: "Table",
          caption: "Option costs",
          columns: ["Option", "Cost"],
          rows: [["A", "Low"]],
        },
        { id: "item", component: "Text", text: { "@path": "value" } },
        { id: "code", component: "CodeBlock", code: snippet, language: "JS" },
        { id: "icon", component: "Icon", name: "settings" },
        { id: "tabText", component: "Text", text: "Other tab content" },
        { id: "trigger", component: "Text", text: "Open dialog" },
        { id: "modalText", component: "Text", text: "Dialog content" },
        { id: "linkLabel", component: "Text", text: "Inspect catalog" },
        { id: "actionLabel", component: "Text", text: "Prepare reply" },
      ],
    },
  });
  f.source.value = {
    ...f.source.value,
    surfaces: [
      {
        session_id: f.source.sessionID,
        tool_call_id: "basic",
        revision: 1,
        at: f.source.value.at,
        snapshot: [],
        surface,
      },
    ],
  };
  const page = await f.browser.newPage();
  await page.goto(f.origin);
  await page.getByText("Other retained views (1)", { exact: true }).click();
  const view = page.locator(".generated-surface");
  await view
    .getByRole("table", { name: "Option costs" })
    .getByRole("cell", { name: "Low" })
    .waitFor();
  await view.getByText("trunk").waitFor();
  await view.getByText("List row").waitFor();
  await view.getByText("View code").click();
  const highlighted = view.locator(".catalog-code").filter({ hasText: "JS" }).locator("code");
  const keyword = highlighted.locator("span").filter({ hasText: /^if\s*$/ });
  await keyword.waitFor();
  assert.equal(await highlighted.textContent(), snippet);
  assert.equal(await highlighted.locator("b").count(), 0);
  assert.ok(
    await keyword.evaluate(
      (el) => getComputedStyle(el).color !== getComputedStyle(el.parentElement!).color,
    ),
  );
  const log = view.locator(".catalog-code").filter({ hasText: "Build log" }).locator("code");
  assert.equal(await log.textContent(), "  raw <b>output</b>\n");
  assert.equal(await log.locator("*").count(), 0);
  await view.getByRole("img", { name: "settings" }).waitFor();
  await view.getByText("Second tab").click();
  await view.getByText("Other tab content").waitFor();
  await view.getByText("Open dialog").click();
  await view.getByRole("dialog").getByText("Dialog content").waitFor();
  await view.getByRole("button", { name: "Close" }).click();
  await view.getByRole("img", { name: "Catalog image" }).waitFor();
  assert.equal(await view.locator("audio[controls], video[controls]").count(), 2);
  await view.locator("input[type=date]").waitFor();
  await view.getByText("3.00", { exact: true }).waitFor();
  await view.getByRole("slider").press("ArrowRight");
  await view.getByText("4.00", { exact: true }).waitFor();
  await view.getByText("Enabled", { exact: true }).click();
  await view.getByText("Alpha", { exact: true }).click();
  await view.locator("input[type=text]").fill("Review the table");
  await view.getByText("Review the table", { exact: true }).waitFor();
  await page.evaluate(() => {
    window.open = (...args) => {
      document.documentElement.dataset.catalogNavigation = JSON.stringify(args);
      return null;
    };
  });
  await view.getByRole("button", { name: "Inspect catalog" }).click();
  assert.equal(
    await page.locator("html").getAttribute("data-catalog-navigation"),
    JSON.stringify([f.origin + "/catalog/work/v1/catalog.json", "_blank", "noopener,noreferrer"]),
  );
  await view.getByRole("button", { name: "Prepare reply" }).click();
  assert.equal(
    await page.getByRole("textbox", { name: "Message Abra" }).inputValue(),
    "Review the table",
  );
  assert.equal(f.source.submissions, 0);
});
