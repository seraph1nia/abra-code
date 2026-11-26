import { FixtureViewSchema } from "../../helpers/web.ts";
import { chooseAppearance } from "../../helpers/workspace-browser.ts";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { reportDocument, coveredReportDocument } from "../../helpers/report-document.ts";
import { Effect, Schema } from "effect";
import { CrewError } from "../../../src/domain.ts";
import { SurfaceRecordSchema } from "@abracode/contracts/web/workspace-wire";
import { catalogId } from "@abracode/contracts/web/catalog";
import { ContentHash } from "@abracode/contracts/identities";
import { test, fixture, screenshot } from "../../helpers/coherence-browser.ts";
test("unstarted and unpublished Markdown reports are empty states and refresh into published evidence", async (t) => {
  const f = await fixture();
  t.onTestFinished(f.close);
  let report: { unavailable: "not_started" | "not_published" } | { content: string } = {
    unavailable: "not_started",
  };
  const page = await f.browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.route("**/api/work/report?*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(report) }),
  );
  await page.route("**/api/reviews?*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ reviews: [], diagnostics: [] }),
    }),
  );
  await page.goto(`${f.origin}/?issue=abra-web&tab=Reports`);
  await page
    .getByRole("status")
    .filter({ hasText: "No Markdown report is available because this task has not started." })
    .waitFor();
  assert.equal(await page.getByRole("alert").count(), 0);
  report = { unavailable: "not_published" };
  await f.changed();
  await page
    .getByText("No Markdown report has been published for this task.", { exact: true })
    .waitFor();
  assert.equal(await page.getByRole("alert").count(), 0);
  report = { content: "# Newly published report" };
  await f.changed();
  await page.getByRole("heading", { name: "Newly published report", exact: true }).waitFor();
  assert.equal(
    await page.getByText("No Markdown report has been published for this task.").count(),
    0,
  );
  assert.equal(f.source.submissions, 0);
});

test("export mutation status retries the same document and cannot populate another selection", async (t) => {
  const f = await fixture();
  t.onTestFinished(f.close);
  const saved = coveredReportDocument();
  const targets = ["first-export", "second-export"].map((id) => {
    const json = JSON.stringify({ ...saved, document_id: id });
    const hash = createHash("sha256").update(json).digest("hex");
    f.documentArtifacts.set(id, { json, hash, bytes: Buffer.byteLength(json), title: id });
    return { action: "open_artifact" as const, issue_id: "abra-web", request_id: id, hash };
  });
  let fail = true,
    delay = false,
    release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  t.onTestFinished(release);
  const calls: string[] = [];
  f.source.exportDocument = (input) =>
    Effect.gen(function* () {
      calls.push(input.request_id);
      if (fail) return yield* new CrewError("EXPORT_FIXTURE", "Temporary export failure");
      if (delay) yield* Effect.promise(() => waiting);
      return {
        document_hash: input.hash,
        exporter_hash: ContentHash.make("e".repeat(64)),
        hash: ContentHash.make("f".repeat(64)),
        bytes: 200,
      };
    });
  const page = await f.browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto(`${f.origin}/?${new URLSearchParams({ resource: JSON.stringify(targets[0]) })}`);
  await page.getByRole("button", { name: "Export offline HTML", exact: true }).click();
  await page.getByText(/HTML export was unavailable/).waitFor();
  assert.equal(
    await page.getByRole("link", { name: "Download selected JSON", exact: true }).count(),
    1,
  );
  fail = false;
  await page.getByRole("button", { name: "Export offline HTML", exact: true }).click();
  const download = page.getByRole("link", { name: "Download exported HTML", exact: true });
  await download.waitFor();
  assert.match((await download.getAttribute("href"))!, /first-export/);
  await page.getByRole("button", { name: "Preview exported HTML", exact: true }).click();
  const preview = page.getByTitle("Offline HTML export", { exact: true });
  assert.equal(await preview.getAttribute("sandbox"), "allow-scripts");
  assert.ok(await preview.evaluate((element) => element.getBoundingClientRect().height >= 320));
  await page.getByRole("button", { name: "Close HTML preview", exact: true }).click();
  assert.equal(await preview.count(), 0);
  delay = true;
  await page.getByRole("button", { name: "Verify HTML export", exact: true }).click();
  await page.getByRole("button", { name: "Exporting HTML…", exact: true }).waitFor();
  await page.getByRole("button", { name: "Other reports" }).click();
  await page
    .locator(".report-revision")
    .filter({ hasText: "second-export" })
    .getByRole("button", { name: "Preview", exact: true })
    .click();
  await page.getByRole("button", { name: "Export offline HTML", exact: true }).waitFor();
  release();
  assert.equal(await download.count(), 0);
  assert.equal(await preview.count(), 0);
  assert.deepEqual(calls, ["first-export", "first-export", "first-export"]);
  assert.equal(f.source.submissions, 0);
});

test("exact saved reports use frozen catalog bindings, preserve pending checks and isolate unsupported documents", async (t) => {
  const f = await fixture();
  t.onTestFinished(f.close);
  const savedDocument = coveredReportDocument(true);
  const add = (id: string, value: unknown, title: string) => {
    const json = JSON.stringify(value),
      hash = createHash("sha256").update(json).digest("hex");
    f.documentArtifacts.set(id, { json, hash, bytes: Buffer.byteLength(json), title });
    return { action: "open_artifact" as const, issue_id: "abra-web", request_id: id, hash };
  };
  const selected = add("frozen-report", savedDocument, "Saved evidence");
  add(
    "future-report",
    { ...savedDocument, document_id: "future-report", format_version: 2 },
    "Future evidence",
  );
  add(
    "broken-report",
    { ...savedDocument, document_id: "broken-report", data: {} },
    "Broken evidence",
  );
  add(
    "future-catalog",
    { ...savedDocument, document_id: "future-catalog", catalog_version: 99 },
    "Future catalog",
  );
  const page = await f.browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto(`${f.origin}/?${new URLSearchParams({ resource: JSON.stringify(selected) })}`);
  await page.locator(".frozen-report").waitFor();
  assert.equal(await page.locator(".frozen-report [data-report-section]").count(), 7);
  await page
    .locator(".frozen-report")
    .getByRole("button", { name: "Older snapshot task title", exact: true })
    .first()
    .waitFor();
  await page
    .locator(".frozen-report")
    .getByRole("button", { name: "Frozen task title", exact: true })
    .waitFor();
  assert.match(await page.locator('[data-report-section="checks"]').innerText(), /pending/);
  assert.doesNotMatch(await page.locator('[data-report-section="checks"]').innerText(), /passed/);
  assert.deepEqual(
    await page.locator('[data-report-section="events"] .timeline strong').allTextContents(),
    ["Earlier event", "Later event", "Untimed evidence"],
  );
  assert.equal(await page.locator(".frozen-report script").count(), 0);
  assert.match(
    await page.locator('[data-work-widget="StatusSummary"]').innerText(),
    /1 \(partial\)/,
  );
  assert.match(
    await page.locator('[data-work-widget="WorkTable"]').first().innerText(),
    /Partial data/,
  );
  assert.match(
    await page.locator('[data-work-widget="WorkTable"]').last().innerText(),
    /Coverage unknown/,
  );
  assert.equal(f.calls.filter((call) => call.name === "binding").length, 0);
  for (const width of [1600, 375, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of ["light", "dark"]) {
      await chooseAppearance(page, theme);
      if (width <= 760) {
        await page.locator(".frozen-report").waitFor();
      }
      assert.ok(
        await page
          .locator(".frozen-report .work-card strong")
          .first()
          .evaluate((element) => element.getBoundingClientRect().width > 70),
      );
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
    }
  }
  await page.setViewportSize({ width: 1600, height: 1000 });

  const findings = page.getByLabel("Filter captured findings");
  await findings.fill("no match");
  await page.getByText("0 of 1 findings", { exact: true }).waitFor();
  await findings.fill("");
  f.source.value = {
    ...f.source.value,
    work: {
      ...f.source.value.work,
      work: [
        {
          ...f.source.value.work.work[0],
          title: "New live title",
          phase: "completed",
          issue_status: "closed",
        },
      ],
    },
  };
  await f.changed();
  await page
    .locator(".frozen-report")
    .getByRole("button", { name: "Frozen task title", exact: true })
    .waitFor();
  assert.equal(
    await page.locator(".frozen-report").getByText("New live title", { exact: true }).count(),
    0,
  );
  const download = page.getByRole("link", { name: "Download selected JSON", exact: true });
  const response = await fetch(new URL((await download.getAttribute("href"))!, f.origin));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-disposition")!, /attachment.*\.json/);
  assert.equal(await response.text(), f.documentArtifacts.get("frozen-report")!.json);
  const desktopDraft = page.getByRole("textbox", { name: "Message Abra" });
  await desktopDraft.fill("Keep this draft while reading saved evidence");
  await page.getByRole("button", { name: "Expand report", exact: true }).click();
  await page.getByRole("dialog", { name: /Report canvas/ }).waitFor();
  assert.ok(
    await page
      .locator(".report-canvas")
      .evaluate((node) => node.getBoundingClientRect().width > 1500),
  );
  await page.reload();
  await page.getByRole("dialog", { name: /Report canvas/ }).waitFor();
  await page
    .locator(".frozen-report")
    .getByRole("button", { name: "Older snapshot task title", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Return to inspector", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(await desktopDraft.inputValue(), "Keep this draft while reading saved evidence");
  for (const width of [375, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page
      .locator('.phone-navigation a[aria-current="page"]')
      .filter({ hasText: "Chat" })
      .waitFor();
    await page.locator('.inspector [data-report-section="checks"]').waitFor();
    await page.locator('[data-report-section="checks"]').scrollIntoViewIfNeeded();
    const checks = page.getByRole("region", { name: "Captured checks", exact: true });
    await checks.focus();
    await checks.press("ArrowRight");
    await page.waitForFunction(
      () =>
        (globalThis.document.querySelector<HTMLElement>('[aria-label="Captured checks"]')
          ?.scrollLeft ?? 0) > 0,
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    assert.equal(
      await page
        .locator(".report-evidence")
        .evaluateAll((nodes) =>
          nodes.some((node) => node.getBoundingClientRect().right > innerWidth + 1),
        ),
      false,
    );
    await screenshot(page, `frozen-report-${width}.png`);
  }
  await page.getByRole("button", { name: "Other reports" }).click();
  await page
    .locator(".report-revision")
    .filter({ hasText: "Future evidence" })
    .getByRole("button", { name: "Preview", exact: true })
    .click();
  await page
    .getByText("This report format version is not supported by this viewer.", { exact: true })
    .waitFor();
  await page.goBack();
  await page.locator(".frozen-report").waitFor();
  await page.reload();
  await page.locator(".frozen-report").waitFor();
  await page.getByRole("button", { name: "Other reports" }).click();
  await page
    .locator(".report-revision")
    .filter({ hasText: "Future catalog" })
    .getByRole("button", { name: "Preview", exact: true })
    .click();
  await page
    .getByText("This report requires an unsupported catalog or renderer version.", { exact: true })
    .waitFor();
  await page.goBack();
  await page.locator(".frozen-report").waitFor();
  await page.getByRole("button", { name: "Other reports" }).click();
  await page
    .locator(".report-revision")
    .filter({ hasText: "Broken evidence" })
    .getByRole("button", { name: "Preview", exact: true })
    .click();
  await page
    .getByText(
      "This retained document is malformed. Its original JSON remains available for download.",
      { exact: true },
    )
    .waitFor();
  await page.goBack();
  await page.locator(".frozen-report").waitFor();
  await page.getByRole("button", { name: "Close inspector", exact: true }).click();
  assert.equal(
    await page.getByRole("textbox", { name: "Message Abra" }).inputValue(),
    "Keep this draft while reading saved evidence",
  );
  assert.equal(f.source.submissions, 0);
  assert.equal(f.source.stops, 0);
});

test("artifact pages keep exact off-page documents reachable without preloading other bodies", async (t) => {
  const f = await fixture();
  t.onTestFinished(f.close);
  const saved = reportDocument();
  for (let index = 0; index < 10; index++) {
    const id = `report-page-${index}`;
    const json = JSON.stringify({ ...saved, document_id: id, title: `Captured report ${index}` });
    f.documentArtifacts.set(id, {
      json,
      hash: createHash("sha256").update(json).digest("hex"),
      bytes: Buffer.byteLength(json),
      title: `Captured report ${index}`,
    });
  }
  const exact = f.documentArtifacts.get("report-page-9")!;
  const target = {
    action: "open_artifact",
    issue_id: "abra-web",
    request_id: "report-page-9",
    hash: exact.hash,
  };
  const page = await f.browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto(`${f.origin}/?${new URLSearchParams({ resource: JSON.stringify(target) })}`);
  await page.locator('[data-report-document="report-page-9"]').waitFor();
  await page.getByRole("button", { name: "Other reports" }).click();
  await page.locator(".report-revision").first().waitFor();
  assert.equal(await page.locator(".report-revision").count(), 8);
  assert.equal(
    await page.locator(".report-revision").filter({ hasText: "Captured report 9" }).count(),
    0,
  );
  await page.getByRole("button", { name: "Next reports", exact: true }).click();
  await page.locator(".report-revision").filter({ hasText: "Captured report 9" }).waitFor();
  assert.equal(await page.locator(".report-revision").count(), 2);
  await page.reload();
  await page.locator('[data-report-document="report-page-9"]').waitFor();
  await page.getByRole("button", { name: "Other reports" }).click();
  await page.locator(".report-revision").filter({ hasText: "Captured report 9" }).waitFor();
  assert.equal(await page.locator(".report-revision").count(), 2);
  const download = page.getByRole("link", { name: "Download selected JSON", exact: true });
  assert.equal(
    await (await fetch(new URL((await download.getAttribute("href"))!, f.origin))).text(),
    exact.json,
  );
  await page.getByRole("button", { name: "Previous reports", exact: true }).click();
  await page.locator(".report-revision").filter({ hasText: "Captured report 0" }).waitFor();
  await page.locator('[data-report-document="report-page-9"]').waitFor();
  assert.ok(
    f.calls
      .filter((call) => call.name === "artifactDocument")
      .every((call) => call.input.request_id === "report-page-9"),
  );
  assert.equal(f.source.submissions, 0);
});

test("chat previews and the full canvas render the same lazy immutable document", async (t) => {
  const f = await fixture();
  t.onTestFinished(f.close);
  const saved = reportDocument(),
    json = JSON.stringify(saved);
  const hash = createHash("sha256").update(json).digest("hex");
  f.documentArtifacts.set(saved.document_id, {
    json,
    hash,
    bytes: Buffer.byteLength(json),
    title: saved.title,
  });
  f.source.value = Schema.decodeSync(FixtureViewSchema)({
    ...f.source.value,
    messages: [
      {
        id: "msg_inline_report",
        role: "assistant",
        text: "A saved report is attached.",
        at: f.source.value.at,
      },
    ],
    presentations: {
      truncated: false,
      entries: [
        {
          session_id: f.source.sessionID,
          message_id: "msg_inline_report",
          source: "notice",
          target: { kind: "artifact", issue_id: "abra-web", request_id: saved.document_id, hash },
        },
      ],
    },
  });
  const page = await f.browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto(f.origin);
  await page.getByText("Preview saved report", { exact: true }).waitFor();
  assert.equal(f.calls.filter((call) => call.name === "artifactDocument").length, 0);
  await page.getByText("Preview saved report", { exact: true }).click();
  await page.locator(".artifact-inline-preview .frozen-report").waitFor();
  assert.equal(f.calls.filter((call) => call.name === "artifactDocument").length, 1);
  await page.getByRole("button", { name: "Open report", exact: true }).click();
  await page.locator(".inspector .frozen-report").waitFor();
  assert.equal(
    await page
      .locator(".artifact-inline-preview [data-report-document]")
      .getAttribute("data-report-document"),
    await page.locator(".inspector [data-report-document]").getAttribute("data-report-document"),
  );
  await page.getByRole("button", { name: "Expand report", exact: true }).click();
  await page.getByRole("dialog", { name: /Report canvas/ }).waitFor();
  await page.locator(".report-canvas .frozen-report").waitFor();
  assert.match(
    await page.locator('.report-canvas [data-report-section="checks"]').innerText(),
    /pending/,
  );
  assert.equal(f.source.submissions, 0);
  assert.equal(f.source.stops, 0);
});

test("an uncertain snapshot save survives reload and retries its original identity without another capture", async (t) => {
  const f = await fixture();
  t.onTestFinished(f.close);
  const document = reportDocument();
  f.source.value = {
    ...f.source.value,
    surfaces: [
      Schema.decodeSync(SurfaceRecordSchema)({
        session_id: f.source.sessionID,
        tool_call_id: "saved-layout-call",
        revision: 1,
        at: f.source.value.at,
        snapshot: f.source.value.work.work,
        surface: {
          version: "1.0",
          createSurface: {
            surfaceId: "saveView",
            catalogId,
            components: [{ id: "root", component: "WorkTable", issueIds: ["abra-web"] }],
          },
        },
      }),
    ],
  };
  let captures = 0;
  f.source.saveSurface = (input) =>
    Effect.sync(() => {
      let artifact = f.documentArtifacts.get(input.request_id);
      if (!artifact) {
        captures++;
        const json = JSON.stringify({ ...document, document_id: input.request_id });
        artifact = {
          json,
          hash: createHash("sha256").update(json).digest("hex"),
          bytes: Buffer.byteLength(json),
          title: "Saved evidence",
        };
        f.documentArtifacts.set(input.request_id, artifact);
      }
      return {
        request_id: input.request_id,
        title: artifact.title,
        format: "a2ui-snapshot" as const,
        status: "published" as const,
        generation: 2,
        hash: ContentHash.make(artifact.hash),
        bytes: artifact.bytes,
      };
    });
  const page = await f.browser.newPage();
  let loseResponse = true;
  await page.route("**/api/report/save-surface", async (route) => {
    if (!loseResponse) return route.continue();
    loseResponse = false;
    const response = await route.fetch();
    assert.equal(response.status(), 200);
    return route.abort("failed");
  });
  await page.addInitScript(() => {
    const write = Storage.prototype.setItem.bind(localStorage);
    const sessionWrite = Storage.prototype.setItem.bind(sessionStorage);
    Storage.prototype.setItem = function (key, value) {
      const block = sessionStorage.getItem("block-save");
      if (
        key.startsWith("abra-report-save-") &&
        (block === "all" || (block === "result" && JSON.parse(value).result))
      )
        throw new DOMException("Storage unavailable", "QuotaExceededError");
      if (this === localStorage) write(key, value);
      else sessionWrite(key, value);
    };
  });
  await page.goto(f.origin);
  await page.getByText("Other retained views (1)", { exact: true }).click();
  await page.evaluate(() => sessionStorage.setItem("block-save", "all"));
  await page.getByRole("button", { name: "Save snapshot", exact: true }).click();
  await page.getByText(/Enable browser storage before saving/).waitFor();
  assert.equal(f.saves.length, 0);
  await page.evaluate(() => sessionStorage.removeItem("block-save"));
  await page.getByRole("button", { name: "Save snapshot", exact: true }).click();
  await page.getByRole("button", { name: "Retry same save", exact: true }).waitFor();
  assert.equal(f.saves.length, 1);
  const request = f.saves[0];
  await page.reload();
  await page.getByText("Other retained views (1)", { exact: true }).click();
  await page.getByRole("button", { name: "Retry same save", exact: true }).waitFor();
  assert.equal(f.saves.length, 1, "Reload must not replay an uncertain artifact mutation");
  await page.evaluate(() => sessionStorage.setItem("block-save", "result"));
  await page.getByRole("button", { name: "Retry same save", exact: true }).click();
  await page.getByText(/Enable browser storage before saving/).waitFor();
  await page.reload();
  await page.getByText("Other retained views (1)", { exact: true }).click();
  await page.evaluate(() => sessionStorage.removeItem("block-save"));
  await page.getByRole("button", { name: "Retry same save", exact: true }).click();
  await page.getByRole("button", { name: "Open saved report", exact: true }).waitFor();
  assert.deepEqual(f.saves, [request, request, request]);
  assert.equal(captures, 1);
  await page.getByRole("button", { name: "Save another snapshot" }).click();
  await page.getByRole("button", { name: "Save snapshot", exact: true }).click();
  await page.getByRole("button", { name: "Open saved report" }).waitFor();
  assert.equal(captures, 2);
  assert.notDeepEqual(f.saves.at(-1), request);
  await page.getByRole("button", { name: "Open saved report", exact: true }).click();
  await page.locator(".frozen-report").waitFor();
  assert.equal(f.source.submissions, 0);
});
