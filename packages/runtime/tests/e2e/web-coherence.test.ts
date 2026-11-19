import { feedbackFixture } from "../helpers/review-evidence.ts";
/* oxlint-disable effecttsgo/unstable-api-usage -- Disposable browser/HTTP/stream fixtures exercise the shipped frontend. */
import { test as baseTest, beforeAll, afterAll } from "vite-plus/test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { reportDocument, coveredReportDocument } from "../helpers/report-document.ts";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import { CrewError } from "../../src/domain.ts";
import {
  TranscriptMessageSchema,
  SurfaceRecordSchema,
  WorkspaceSnapshotSchema,
} from "../../src/web/workspace-wire.ts";

import { catalogId } from "../../src/web/catalog.ts";
import { WorkItemSchema } from "../../src/web/wire.ts";
import { Form } from "@opencode/schema/form";

import {
  IssueId,
  Timestamp,
  ContentHash,
  RepositoryId,
  SpecSchemaName,
} from "../../src/identities.ts";
import type { AttentionForm } from "../../src/web/contracts.ts";

import { launchReportBrowser } from "@abracode/report-export/browser";

import { workspaceBrowserFixture } from "../helpers/workspace-browser.ts";
import { fleetCounts } from "../../src/visibility/fleet.ts";

const test = baseTest.concurrent;
let browser: Awaited<ReturnType<typeof launchReportBrowser>>;
beforeAll(async () => {
  browser = await launchReportBrowser();
});
afterAll(async () => {
  await browser?.close();
});
const fixture = () => workspaceBrowserFixture(browser);

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

test("mounted review age changes at its deadline without another resource poll", async (t) => {
  const f = await fixture();
  t.onTestFinished(f.close);
  const page = await f.browser.newPage();
  const now = Date.now();
  const evidence = feedbackFixture(false);
  f.feedbackPages.set(0, {
    ...evidence,
    observation: { ...evidence.observation!, next_check_at: now + 60_000 },
  });
  await page.clock.install({ time: now });
  await page.goto(`${f.origin}/?issue=abra-web&tab=Activity&activity=checks`);
  await page
    .getByText(/Recheck due/)
    .first()
    .waitFor();
  assert.equal(await page.getByText(/Stale retained observation/).count(), 0);
  const reads = f.calls.filter((call) => call.name === "feedback").length;
  await page.clock.fastForward(61_000);
  await page.getByText(/Stale retained observation/).waitFor();
  assert.equal(f.calls.filter((call) => call.name === "feedback").length, reads);
  await page.getByRole("button", { name: "Close inspector", exact: true }).click();
  await page.clock.fastForward(61_000);
  assert.equal(f.calls.filter((call) => call.name === "feedback").length, reads);
});

test("theme resolves before application loading and follows system changes without losing edits", async (t) => {
  const f = await fixture();
  t.onTestFinished(f.close);
  const page = await f.browser.newPage({
    colorScheme: "light",
    viewport: { width: 390, height: 844 },
  });
  await page.addInitScript(() => localStorage.setItem("abra-theme", "dark"));
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  t.onTestFinished(() => release());
  await page.route("**/assets/*.js", async (route) => {
    if (!route.request().url().endsWith("/theme-init.js")) await held;
    await route.continue().catch(() => {});
  });
  await page.goto(f.origin, { waitUntil: "commit" });
  await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
  assert.equal(await page.locator("#root > *").count(), 0);
  release();
  const draft = page.getByRole("textbox", { name: "Message Abra" });
  await draft.fill("Keep theme edits");
  await page.getByLabel("Color theme", { exact: true }).selectOption("system");
  await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
  assert.equal(await draft.inputValue(), "Keep theme edits");
  await page.getByRole("button", { name: "Toggle work finder" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  assert.equal(
    await dialog.evaluate((element) => getComputedStyle(element).fontFamily),
    await page.locator("body").evaluate((element) => getComputedStyle(element).fontFamily),
  );
  await page.keyboard.press("Escape");
  assert.equal(await draft.inputValue(), "Keep theme edits");
  const unavailable = await f.browser.newPage({ colorScheme: "dark" });
  await unavailable.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error("storage unavailable");
    };
    Storage.prototype.setItem = () => {
      throw new Error("storage unavailable");
    };
  });
  await unavailable.goto(f.origin);
  await unavailable.getByRole("textbox", { name: "Message Abra" }).fill("Mounted without storage");
  await unavailable.getByLabel("Color theme", { exact: true }).selectOption("light");
  await unavailable.waitForFunction(() => document.documentElement.dataset.theme === "light");
  assert.equal(
    await unavailable.getByRole("textbox", { name: "Message Abra" }).inputValue(),
    "Mounted without storage",
  );
});

test("legacy report previews fit their host and retain opaque script sandboxing", async (t) => {
  const f = await fixture();
  t.onTestFinished(f.close);
  const hash = "c".repeat(64);
  const target = {
    kind: "artifact" as const,
    issue_id: IssueId.make("abra-web"),
    request_id: "legacy-report",
    hash,
  };
  f.documentArtifacts.set(target.request_id, {
    json: "",
    hash,
    bytes: 42,
    title: "Legacy evidence",
    legacy: true,
  });
  f.source.value = Schema.decodeSync(WorkspaceSnapshotSchema)({
    ...f.source.value,
    messages: [
      { id: "msg_legacy", role: "assistant", text: "Retained attachment", at: f.source.value.at },
    ],
    presentations: {
      entries: [
        { session_id: f.source.sessionID, source: "notice", message_id: "msg_legacy", target },
      ],
      diagnostics: [],
      truncated: false,
    },
  });
  const page = await f.browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto(f.origin);
  await page.getByText("Preview saved report", { exact: true }).click();
  const inline = page.locator(".artifact-attachment iframe");
  await inline.waitFor();
  const assertFrame = async (selector: string) => {
    const frame = page.locator(selector);
    await page.waitForFunction((selector) => {
      const box = document.querySelector(selector)?.getBoundingClientRect();
      return box && box.width > 200 && box.height >= 320 && box.right <= innerWidth + 1;
    }, selector);
    assert.equal(await frame.getAttribute("sandbox"), "allow-scripts");
  };
  await assertFrame(".artifact-attachment iframe");
  await page.goto(
    `${f.origin}/?${new URLSearchParams({ resource: JSON.stringify({ action: "open_artifact", ...target, kind: undefined }) })}`,
  );
  await page.locator(".inspector iframe").waitFor();
  for (const width of [1600, 375, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await assertFrame(".inspector iframe");
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
  }
  await page.getByRole("button", { name: "Expand report", exact: true }).click();
  await page.getByRole("dialog", { name: /Report canvas/ }).waitFor();
  await assertFrame(".inspector iframe");
  await page.getByRole("button", { name: "Return to inspector", exact: true }).click();
  assert.equal(await page.locator(".report-canvas").count(), 0);
  await page.getByRole("button", { name: "Close inspector", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(f.source.submissions, 0);
  assert.equal(f.source.stops, 0);
});

test("custom native choices retain raw lines across refresh and normalize only on submit", async (t) => {
  const f = await fixture();
  t.onTestFinished(f.close);
  f.source.value = {
    ...f.source.value,
    forms: [
      {
        active: true,
        binding: "custom-lines",
        form: {
          id: Form.ID.make("frm_custom"),
          sessionID: f.source.sessionID,
          title: "Custom choices",
          fields: [
            {
              type: "multiselect",
              key: "choices",
              custom: true,
              options: [{ label: "Predefined", value: "preset" }],
              default: ["preset"],
            },
          ],
        },
      },
    ],
  };
  const page = await f.browser.newPage();
  await page.goto(f.origin);
  const text = page.getByRole("textbox", { name: "Additional choices, one per line" });
  await text.pressSequentially("alpha\nbeta");
  assert.equal(await text.inputValue(), "alpha\nbeta");
  await text.fill("alpha\n\nbeta\nalpha");
  await text.press("Home");
  await text.pressSequentially("middle ");
  const raw = await text.inputValue();
  assert.equal(raw, "alpha\n\nbeta\nmiddle alpha");
  await f.changed();
  await page.getByRole("button", { name: /^Attention/ }).click();
  await page.getByRole("button", { name: /^Attention/ }).click();
  assert.equal(await text.inputValue(), raw);
  await text.fill("alpha\n\nbeta\nalpha\npreset");
  await page.getByRole("button", { name: "Submit answer", exact: true }).click();
  await text.waitFor({ state: "hidden" });
  assert.deepEqual(f.replies[0].answer, { choices: ["preset", "alpha", "beta"] });
  f.source.value = {
    ...f.source.value,
    forms: [
      {
        active: true,
        binding: "replacement",
        form: {
          id: Form.ID.make("frm_custom"),
          sessionID: f.source.sessionID,
          title: "Replacement choices",
          fields: [
            { type: "multiselect", key: "choices", custom: true, options: [], default: ["reset"] },
          ],
        },
      },
    ],
  };
  await f.changed();
  await text.waitFor();
  assert.equal(await text.inputValue(), "reset");
});

test("native date-time defaults display their instant and round-trip untouched", async (t) => {
  const f = await fixture();
  t.onTestFinished(f.close);
  for (const timezoneId of ["UTC", "Europe/Amsterdam"]) {
    for (const original of [
      "2026-11-16T10:00:00Z",
      "2026-11-16T15:30:00+05:30",
      "2026-11-16T10:00",
    ]) {
      f.source.value = {
        ...f.source.value,
        forms: [
          {
            active: true,
            binding: timezoneId,
            form: {
              id: Form.ID.make("frm_date"),
              sessionID: f.source.sessionID,
              title: "Schedule",
              fields: [
                {
                  type: "string",
                  key: "when",
                  title: "When",
                  format: "date-time",
                  default: original,
                  required: true,
                },
              ],
            },
          },
        ],
      };
      const page = await f.browser.newPage({ timezoneId });
      await page.goto(f.origin);
      const input = page.getByLabel(/^When/);
      await input.waitFor();
      assert.equal(
        await input.inputValue(),
        timezoneId === "UTC" || original === "2026-11-16T10:00"
          ? "2026-11-16T10:00"
          : "2026-11-16T11:00",
      );
      await page.getByText(`Timezone: ${timezoneId}`, { exact: true }).waitFor();
      await page.getByRole("button", { name: "Submit answer", exact: true }).click();
      await input.waitFor({ state: "hidden" });
      assert.deepEqual(f.replies.at(-1)?.answer, { when: original });
      await page.close();
    }
  }
});

test("native date-time edits refuse Amsterdam's DST gap and serialize valid local edits", async (t) => {
  const f = await fixture();
  t.onTestFinished(f.close);
  f.source.value = {
    ...f.source.value,
    forms: [
      {
        active: true,
        binding: "dst",
        form: {
          id: Form.ID.make("frm_dst"),
          sessionID: f.source.sessionID,
          title: "Local schedule",
          fields: [
            { type: "string", key: "when", title: "When", format: "date-time", required: true },
            { type: "string", key: "date", title: "Date", format: "date", default: "2026-03-29" },
          ],
        },
      },
    ],
  };
  const page = await f.browser.newPage({ timezoneId: "Europe/Amsterdam" });
  await page.goto(f.origin);
  await page.getByLabel(/^When/).fill("2026-03-29T02:30");
  await page.getByRole("button", { name: "Submit answer", exact: true }).click();
  await page.getByText(/this time may not exist/).waitFor();
  assert.equal(f.replies.length, 0);
  assert.equal(await page.getByLabel("Date", { exact: true }).inputValue(), "2026-03-29");
  await page.getByLabel(/^When/).fill("2026-03-29T03:30");
  await page.getByRole("button", { name: "Submit answer", exact: true }).click();
  await page.getByLabel(/^When/).waitFor({ state: "hidden" });
  assert.deepEqual(f.replies[0].answer, { when: "2026-03-29T01:30:00.000Z", date: "2026-03-29" });
});

test("owned typography survives vendor reset in workspace and inspector", async (t) => {
  const f = await fixture();
  t.onTestFinished(f.close);
  const page = await f.browser.newPage();
  await page.goto(f.origin);
  await page.locator(".conversation-header h1").waitFor();
  assert.deepEqual(
    await page.locator(".conversation-header h1").evaluate((element) => {
      const style = getComputedStyle(element);
      return { size: style.fontSize, weight: style.fontWeight };
    }),
    { size: "25px", weight: "550" },
  );
});

type BrowserPage = Awaited<ReturnType<Awaited<ReturnType<typeof launchReportBrowser>>["newPage"]>>;
async function screenshot(page: BrowserPage, name: string) {
  const evidence = process.env.ABRACODE_TEST_EVIDENCE_DIR;
  if (!evidence) return;
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: join(evidence, name), fullPage: true, animations: "disabled" });
}

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
    { ...savedDocument, document_id: "future-catalog", catalog_version: 3 },
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
      await page.getByLabel("Color theme", { exact: true }).selectOption(theme);
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
  const download = page
    .locator(".report-revision")
    .filter({ hasText: "Saved evidence" })
    .getByRole("link", { name: "Download JSON", exact: true });
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
    await page.locator(".inspector-sheet").waitFor();
    await page.locator('.inspector-sheet [data-report-section="checks"]').waitFor();
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
  f.source.value = Schema.decodeSync(WorkspaceSnapshotSchema)({
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
  await page.goto(f.origin);
  await page.getByText("Other retained views (1)", { exact: true }).click();
  await page.getByRole("button", { name: "Save snapshot", exact: true }).click();
  await page.getByRole("button", { name: "Retry same save", exact: true }).waitFor();
  assert.equal(f.saves.length, 1);
  const request = f.saves[0];
  await page.reload();
  await page.getByText("Other retained views (1)", { exact: true }).click();
  await page.getByRole("button", { name: "Retry same save", exact: true }).waitFor();
  assert.equal(f.saves.length, 1, "Reload must not replay an uncertain artifact mutation");
  await page.getByRole("button", { name: "Retry same save", exact: true }).click();
  await page.getByRole("button", { name: "Open saved report", exact: true }).waitFor();
  assert.deepEqual(f.saves, [request, request]);
  assert.equal(captures, 1);
  await page.getByRole("button", { name: "Open saved report", exact: true }).click();
  await page.locator(".frozen-report").waitFor();
  assert.equal(f.source.submissions, 0);
});

test("typed inspector URLs render Pierre, preserve navigation and theme across responsive panels", async (t) => {
  const f = await fixture();
  t.onTestFinished(f.close);
  f.source.value = {
    ...f.source.value,
    messages: [
      {
        id: "assistant-one",
        role: "assistant",
        text: "A **coherent** workspace.\n\n- Typed queries\n- Shared controls",
        at: f.source.value.at,
      },
    ],
  };
  const page = await f.browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let bootstrapReads = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/bootstrap") bootstrapReads++;
  });
  await page.goto(`${f.origin}/?issue=abra-web&tab=Diff&file=source.ts`);
  await page.locator('[data-diff-renderer="pierre"]').waitFor();
  assert.equal(
    (await page
      .locator('[data-diff-renderer="pierre"]')
      .getByText("newValue", { exact: false })
      .count()) > 0,
    true,
  );
  assert.equal(
    await page.locator('.message-text [data-streamdown="strong"]').textContent(),
    "coherent",
  );
  assert.equal(await page.getByLabel("Diff layout").count(), 0);
  assert.equal(await page.locator(".file-list").count(), 0);
  await page.getByRole("searchbox", { name: "Search changes" }).fill("");
  await page.waitForURL((url) => !url.searchParams.has("file"));
  assert.equal(await page.locator("[data-diff-renderer] diffs-container").count(), 2);
  await page.getByRole("searchbox", { name: "Search changes" }).fill("does-not-exist");
  await page.getByRole("status").filter({ hasText: "No matching changes" }).waitFor();
  await page.getByRole("searchbox", { name: "Search changes" }).fill("newValue");
  assert.equal(await page.locator("[data-diff-renderer] diffs-container").count(), 2);
  await page.getByRole("searchbox", { name: "Search changes" }).fill("second.ts");
  await page.waitForURL(/file=second.ts/);
  await page.waitForFunction(
    () => document.querySelectorAll("[data-diff-renderer] diffs-container").length === 1,
  );
  assert.equal(await page.getByRole("button", { name: /second.ts/ }).count(), 0);
  await page.getByRole("tab", { name: "Plan", exact: true }).click();
  await page.getByRole("button", { name: "proposal.md", exact: true }).click();
  await page.getByRole("heading", { name: "Retained proposal", exact: true }).waitFor();
  await page.goBack();
  await page.getByRole("button", { name: "proposal.md", exact: true }).waitFor();
  await page.goBack();
  await page.locator('[data-diff-renderer="pierre"]').waitFor();
  assert.match(page.url(), /file=second.ts/);
  await page.getByLabel("Color theme").selectOption("dark");
  await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
  await screenshot(page, "frontend-coherence-desktop-dark.png");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("dialog").waitFor();
  assert.equal(await page.getByLabel("Diff layout").count(), 0);
  assert.ok(
    await page
      .locator("[data-diff-renderer]")
      .evaluate((element) =>
        [...element.querySelectorAll("diffs-container")].every((file) =>
          file.shadowRoot?.querySelector('[data-diff-type="split"]'),
        ),
      ),
  );
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await screenshot(page, "frontend-coherence-mobile-diff.png");
  await page.getByRole("button", { name: "Close inspector", exact: true }).click();
  await page.getByRole("button", { name: "Toggle work finder" }).click();
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  // Native snapshot fallback must not cause a second browser bootstrap polling loop.
  await page.waitForTimeout(5500);
  assert.equal(bootstrapReads, 1);
  assert.equal(f.source.submissions, 0);
  assert.equal(f.source.stops, 0);
  assert.deepEqual(errors, []);
});

test("form bindings reset values and concurrent native replies retain their own results", async (t) => {
  const f = await fixture();
  t.onTestFinished(f.close);
  const form = (id: string, binding: string, value: string): AttentionForm => ({
    binding,
    active: true,
    form: {
      id: Form.ID.make(id),
      sessionID: f.source.sessionID,
      title: id,
      fields: [
        {
          type: "string" as const,
          key: "name",
          title: `Name ${id}`,
          required: true,
          default: value,
        },
      ],
    },
  });
  f.source.value = {
    ...f.source.value,
    forms: [form("frm_slow", "first", "old"), form("frm_fast", "fast", "fast")],
  };
  const page = await f.browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(f.origin);
  await page.getByLabel("Name frm_slow").fill("unsaved");
  f.source.value = {
    ...f.source.value,
    forms: [form("frm_slow", "replacement", "new"), form("frm_fast", "fast", "fast")],
  };
  await f.changed();
  await page.waitForFunction(
    () => document.querySelector<HTMLInputElement>('[id="frm_slow-name"]')?.value === "new",
  );
  await page
    .locator(".attention-card")
    .filter({ hasText: "frm_slow" })
    .getByRole("button", { name: "Submit answer" })
    .click();
  await page
    .locator(".attention-card")
    .filter({ hasText: "frm_fast" })
    .getByRole("button", { name: "Submit answer" })
    .click();
  await page.getByLabel("Name frm_fast").waitFor({ state: "hidden" });
  await page.getByLabel("Name frm_slow").waitFor({ state: "hidden" });
  assert.equal(f.replies.length, 2);
  assert.deepEqual(
    f.replies.find((reply) => reply.id === "frm_slow"),
    { id: "frm_slow", binding: "replacement", answer: { name: "new" } },
  );
  assert.deepEqual(f.replies.find((reply) => reply.id === "frm_fast")?.answer, { name: "fast" });
  assert.equal(await page.getByRole("alert").count(), 0);
});

test("lost submission responses survive reload without automatic replay and reconcile the same identity", async (t) => {
  const f = await fixture();
  t.onTestFinished(f.close);
  const page = await f.browser.newPage();
  await page.route("**/api/copilotkit/agent/abra/run", (route) => route.abort());
  await page.goto(f.origin);
  await page.getByRole("textbox", { name: "Message Abra" }).fill("Keep this exact submission");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.getByRole("button", { name: "Reconcile submission" }).waitFor();
  const before = await page.evaluate(() => localStorage.getItem("abra-pending-ses_webfixture"));
  assert.ok(before);
  await page.reload();
  await page.getByRole("button", { name: "Reconcile submission" }).waitFor();
  assert.equal(f.source.submissions, 0);
  assert.equal(
    await page.evaluate(() => localStorage.getItem("abra-pending-ses_webfixture")),
    before,
  );
  await page.unroute("**/api/copilotkit/agent/abra/run");
  await page.getByRole("button", { name: "Reconcile submission" }).click();
  await page.getByRole("button", { name: "Reconcile submission" }).waitFor({ state: "hidden" });
  assert.equal(f.source.submissions, 1);
  assert.equal(f.source.value.receipts.at(-1)?.delivery, "queue");
  assert.equal(f.source.value.receipts[0].request_id, JSON.parse(before).request_id);
  assert.equal(f.source.value.receipts[0].text, "Keep this exact submission");
  await page.waitForFunction(() => localStorage.getItem("abra-pending-ses_webfixture") === null);
});

test("a restored tab clears an exact admission beyond recent history without losing its draft or replaying", async (t) => {
  const f = await fixture();
  t.onTestFinished(f.close);
  const pending = {
    request_id: "suspended-tab",
    text: "Original submitted input",
    delivery: "queue" as const,
  };
  const original = await Effect.runPromise(f.source.submit(pending));
  for (let index = 0; index < 101; index++)
    await Effect.runPromise(
      f.source.submit({
        ...pending,
        request_id: `other-tab-${index}`,
        text: `Later input ${index}`,
      }),
    );
  f.source.value = { ...f.source.value, receipts: f.source.value.receipts.slice(-100) };
  assert.equal(
    f.source.value.receipts.some((receipt) => receipt.request_id === pending.request_id),
    false,
  );
  const before = f.source.submissions;
  const context = await f.browser.newContext();
  await context.addInitScript(
    ({ pending, key }) => {
      localStorage.setItem(key, JSON.stringify(pending));
      localStorage.setItem("abra-draft-ses_webfixture", "Keep the unsent draft");
    },
    { pending, key: "abra-pending-ses_webfixture" },
  );
  const tab = await context.newPage();
  let replayed = 0;
  tab.on("request", (request) => {
    if (request.url().endsWith("/agent/abra/run")) replayed++;
  });
  await tab.goto(f.origin);
  await tab.waitForFunction(() => localStorage.getItem("abra-pending-ses_webfixture") === null);
  assert.equal(
    await tab.getByRole("textbox", { name: "Message Abra", exact: true }).inputValue(),
    "Keep the unsent draft",
  );
  assert.equal(await tab.getByRole("button", { name: "Reconcile submission" }).count(), 0);
  assert.equal(f.source.submissions, before);
  assert.equal(replayed, 0);
  assert.equal(
    (await Effect.runPromise(f.source.receipt(pending.request_id)))!.message_id,
    original.message_id,
  );
  await screenshot(tab, "exact-old-admission-restored-tab.png");
  await context.close();
});

test("late inspector responses cannot replace a new selection and live updates invalidate its typed query", async (t) => {
  const f = await fixture();
  t.onTestFinished(f.close);
  const original = f.source.value.work.work[0];
  f.source.value = {
    ...f.source.value,
    work: {
      ...f.source.value.work,
      work: [
        { ...original, issue_id: IssueId.make("abra-slow"), title: "Slow issue" },
        { ...original, title: "Another issue" },
      ],
    },
  };
  const page = await f.browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const request = page.waitForRequest(
    (request) => request.url().includes("/api/work/detail") && request.url().includes("abra-slow"),
  );
  await page.goto(`${f.origin}/?issue=abra-slow&tab=Overview`);
  await request;
  await page.getByRole("button", { name: "Toggle work finder" }).click();
  await page.getByRole("button", { name: /Another issue/ }).click();
  await page.getByText("Details for Another issue", { exact: true }).waitFor();
  await page.waitForTimeout(700);
  assert.equal(await page.getByText("Details for Slow issue", { exact: true }).count(), 0);
  f.source.value = {
    ...f.source.value,
    work: {
      ...f.source.value.work,
      work: [f.source.value.work.work[0], { ...original, title: "Updated issue" }],
    },
  };
  await f.changed();
  await page
    .getByRole("heading", { name: "Updated issue", exact: true })
    .waitFor({ timeout: 3000 });
  await page.getByText("Details for Updated issue", { exact: true }).waitFor();
  assert.ok(
    f.calls.filter((call) => call.name === "detail" && call.input.issue_id === "abra-web").length >=
      2,
  );
  assert.equal(f.source.submissions, 0);
});

test("native tool cards use CopilotKit render-only hooks, preserve order and inspect without prompts", async (t) => {
  const f = await fixture();
  t.onTestFinished(f.close);
  const task = f.source.value.work.work[0];
  const at = f.source.value.at;
  const presentations = [
    { kind: "tasks", tasks: [task], total: 1, limited: false },
    {
      kind: "decision",
      issue_id: task.issue_id,
      decision: {
        key: "database",
        generation: 0,
        scope: "Storage",
        question: "Choose storage",
        owner: "user",
        status: "open",
        session_id: "ses_worker",
        opened_at: 1,
      },
    },
    {
      kind: "communication",
      issue_id: task.issue_id,
      entries: [
        {
          request_id: "request-one",
          generation: 0,
          role: "apply",
          body: "Please report the result",
          status: "admitted",
          response: "answer",
          created_at: at,
          recovery: "admitted",
          native_state: "idle",
        },
      ],
      total: 1,
      outstanding: 1,
      limited: false,
    },
    {
      kind: "sessions",
      issue_id: task.issue_id,
      sessions: [
        {
          id: "ses_worker",
          role: "apply",
          model: { providerID: "fixture", id: "coding-model" },
          native_activity: "queued",
          observed_at: at,
          note: "A retained native prompt is queued",
        },
      ],
      total: 1,
    },
    {
      kind: "findings",
      issue_id: task.issue_id,
      findings: [
        {
          id: "finding-one",
          head: "a".repeat(40),
          kind: "check",
          text: "Validation is pending",
          blocking: true,
        },
      ],
      total: 1,
      limited: false,
    },
    {
      kind: "artifacts",
      issue_id: task.issue_id,
      artifacts: [
        {
          request_id: "report-one",
          title: "Captured report",
          status: "published",
          generation: 0,
          hash: "a".repeat(40),
          captured_at: at,
        },
      ],
      total: 1,
    },
  ];
  const message = Schema.decodeUnknownSync(TranscriptMessageSchema)({
    id: "msg_ordered",
    role: "assistant",
    at,
    text: "Before cards.After cards.",
    tools: [
      ...presentations.map((presentation, index) => ({
        id: `call-${index}`,
        name: `native_observation_${index}`,
        status: "completed",
        presentation,
      })),
      { id: "call-fallback", name: "unknown_native_tool", status: "streaming", input: '{"file":' },
    ],
    parts: [
      { type: "text", text: "Before cards." },
      { type: "tool", tool_id: "call-0" },
      { type: "text", text: "After cards." },
      ...presentations.slice(1).map((_, index) => ({ type: "tool", tool_id: `call-${index + 1}` })),
      { type: "tool", tool_id: "call-fallback" },
    ],
  });
  f.source.value = { ...f.source.value, messages: [message] };
  const page = await f.browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(f.origin);
  for (const kind of ["task", "decision", "communication", "session", "finding", "artifact"]) {
    await page.locator(`[data-presentation="${kind}"]`).waitFor();
  }
  const article = page.locator('[data-native-message-id="msg_ordered"]');
  await article.getByText("Before cards.", { exact: true }).waitFor();
  await article.getByText("After cards.", { exact: true }).waitFor();
  const order = await article
    .locator(".message-text, [data-tool-call-id]")
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-tool-call-id") ?? node.textContent),
    );
  assert.deepEqual(order.slice(0, 3), ["Before cards.", "call-0", "After cards."]);
  assert.equal(await article.locator('[data-native-renderer="copilotkit"]').count(), 7);
  assert.equal(await article.locator("[data-presentation] code:visible").count(), 0);
  const taskCard = article.locator('[data-presentation="task"]');
  await taskCard.getByText("Evidence & provenance", { exact: true }).click();
  assert.equal(await taskCard.locator("code:visible").textContent(), task.issue_id);
  await taskCard.getByText("Evidence & provenance", { exact: true }).click();
  await page.getByText("Admitted; awaiting response", { exact: true }).waitFor();
  await page.getByText("Queued", { exact: true }).waitFor();
  await page.getByText("Blocking", { exact: true }).waitFor();
  await page
    .getByRole("textbox", { name: "Message Abra" })
    .fill("Retain this draft while inspecting");
  await article.getByRole("button", { name: "Inspect task", exact: true }).click();
  await page.getByRole("heading", { name: task.title, exact: true }).waitFor();
  assert.equal(
    await page.getByRole("textbox", { name: "Message Abra" }).inputValue(),
    "Retain this draft while inspecting",
  );
  assert.equal(f.source.submissions, 0);
  assert.equal(f.source.replies, 0);
  await page.getByRole("button", { name: "Close inspector", exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.textContent === "Inspect task");
  await page.setViewportSize({ width: 390, height: 844 });
  await article.getByRole("button", { name: "Inspect task", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.waitForFunction(() => document.activeElement?.textContent === "Inspect task");
  assert.equal(
    await page.getByRole("textbox", { name: "Message Abra" }).inputValue(),
    "Retain this draft while inspecting",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const status of ["running", "error"] as const) {
    f.source.value = {
      ...f.source.value,
      messages: [
        {
          ...message,
          tools: message.tools!.map((tool) =>
            tool.id === "call-fallback"
              ? {
                  ...tool,
                  status,
                  result: status === "error" ? "Native observation failed" : undefined,
                }
              : tool,
          ),
        },
      ],
    };
    await f.changed();
    await page
      .locator(`[data-tool-call-id="call-fallback"][data-tool-state="${status}"]`)
      .waitFor();
  }
  await page.reload();
  await page.locator('[data-tool-call-id="call-fallback"][data-tool-state="error"]').waitFor();
  await page.locator('[data-tool-call-id="call-fallback"] summary').first().click();
  await page.getByText("Native observation failed", { exact: true }).waitFor();
  assert.equal(await page.locator('[data-tool-call-id="call-0"]').count(), 1);
  await screenshot(page, "chat-cards-desktop.png");
  assert.equal(f.source.submissions, 0);
});

function leadFixtures() {
  const at = "2026-11-16T01:00:00Z";
  const summary = {
    id: "frontend-lead",
    revision: 3,
    repositories: ["another-project"],
    enabled: false,
    state: "disabled",
    session_available: false,
    session_id: "ses_lead_new",
    observed_at: at,
    model: { providerID: "fixture", id: "management-model" },
    request_count: 21,
    outstanding_count: 0,
    proposal_count: 6,
    pending_proposal_count: 5,
    scope: "retained_history",
  };
  const base = {
    issue_id: "abra-web",
    repository_id: "fixture",
    observed_at: at,
    entries: [summary],
    total: 1,
    offset: 0,
    diagnostics: [],
  };
  const requests = Array.from({ length: 21 }, (_, index) => ({
    issue_id: "abra-web",
    request_id: `lead-request-${index}`,
    generation: 1,
    recipient_session_id: "ses_lead_old",
    body: `Historical lead request ${index}`,
    response: "answer",
    status: "answered",
    created_at: at,
    acknowledged_at: at,
    reply: { body: `Historical lead answer ${index}`, evidence: [], at },
  }));
  const proposals = Array.from({ length: 6 }, (_, index) => ({
    request_id: `proposal-${index}`,
    revision: 1,
    accepted: index === 0,
    tasks: [
      {
        key: "one",
        title: `Captured lead proposal ${index}`,
        description: `Captured proposal context ${index}`,
        repository_id: "fixture",
        policy: "research-only",
        dependencies: [],
        ...(index === 0 ? { accepted_issue_id: "accepted-follow-up" } : {}),
        limited: false,
      },
    ],
  }));
  const page = (requestOffset = 0, proposalOffset = 0) => ({
    ...base,
    detail: {
      lead_id: "frontend-lead",
      retired_sessions: ["ses_lead_old"],
      requests: requests.slice(requestOffset, requestOffset + 10),
      request_limit: 10,
      request_total: 21,
      request_offset: requestOffset,
      request_next: requestOffset + 10 < 21 ? requestOffset + 10 : undefined,
      proposals: proposals.slice(proposalOffset, proposalOffset + 5),
      proposal_total: 6,
      proposal_offset: proposalOffset,
      proposal_next: proposalOffset + 5 < 6 ? proposalOffset + 5 : undefined,
      related_work: [
        { issue_id: "accepted-follow-up", title: "Accepted follow-up", issue_status: "open" },
      ],
      related_total: 1,
    },
  });
  return { base, page };
}

test("Activity consolidates legacy routes and preserves disabled lead request/proposal history and accepted-work links", async (t) => {
  const f = await fixture();
  t.onTestFinished(f.close);
  const { base, page: leadPage } = leadFixtures();
  f.leadPages.set("/0/0", base);
  for (const requests of [0, 10, 20])
    for (const proposals of [0, 5])
      f.leadPages.set(`frontend-lead/${requests}/${proposals}`, leadPage(requests, proposals));
  f.setDiscovery([
    f.source.value.work.work[0],
    {
      ...f.source.value.work.work[0],
      issue_id: IssueId.make("accepted-follow-up"),
      title: "Accepted follow-up",
    },
  ]);
  const page = await f.browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${f.origin}/?issue=abra-web&tab=Workers`);
  await page.getByRole("tablist", { name: "Work details" }).getByRole("tab").first().waitFor();
  assert.deepEqual(
    await page.getByRole("tablist", { name: "Work details" }).getByRole("tab").allTextContents(),
    ["Overview", "Plan", "Diff", "Activity", "Reports"],
  );
  const composer = page.locator('[aria-label="Message Abra"]');
  await page.getByRole("button", { name: "Close inspector", exact: true }).click();
  await composer.fill("Retain this draft while inspecting leads");
  await page.goto(`${f.origin}/?issue=abra-web&tab=Activity&activity=leads`);
  await page.locator('[data-lead-id="frontend-lead"]').waitFor();
  assert.equal(await composer.inputValue(), "Retain this draft while inspecting leads");
  await page.getByText("Disabled", { exact: true }).waitFor();
  await page.getByText(/Retained history; this repository is outside/).waitFor();
  await page.getByRole("button", { name: "Inspect lead history", exact: true }).click();
  await page.getByRole("region", { name: "Retained lead history" }).waitFor();
  await page.getByRole("button", { name: "Next lead requests", exact: true }).click();
  await page
    .getByText("Historical lead request 10", { exact: true })
    .waitFor({ state: "attached" });
  await page.getByRole("button", { name: "Next lead requests", exact: true }).click();
  await page
    .getByText("Historical lead request 20", { exact: true })
    .waitFor({ state: "attached" });
  await page
    .getByRole("region", { name: "Retained lead history" })
    .locator("summary")
    .filter({ hasText: /Request & reply/ })
    .first()
    .click();
  await page.getByText("Historical lead answer 20", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Next proposals", exact: true }).click();
  await page.getByText("Captured lead proposal 5", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Previous proposals", exact: true }).click();
  await page.getByText("Captured lead proposal 0", { exact: true }).click();
  await page.getByRole("button", { name: "Inspect accepted work", exact: true }).click();
  await page.getByRole("heading", { name: "Accepted follow-up", exact: true }).waitFor();
  await page.goBack();
  await page.getByRole("heading", { name: "Project leads & proposals", exact: true }).waitFor();
  assert.equal(await composer.inputValue(), "Retain this draft while inspecting leads");
  assert.equal(f.source.submissions, 0);
  assert.equal(f.replies.length, 0);
  assert.equal(await page.locator('[aria-label="Message Abra"]').count(), 1);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await screenshot(page, "typed-leads-390.png");
});

test("lead proposal attention is lazy and accessible without creating a task", async (t) => {
  const f = await fixture();
  t.onTestFinished(f.close);
  const { base, page: leadPage } = leadFixtures();
  const emptySummary = {
    ...base.entries[0],
    repositories: ["fixture"],
    enabled: true,
    state: "running",
    session_available: true,
    request_count: 0,
    proposal_count: 1,
    pending_proposal_count: 1,
    scope: "configured_repository",
  };
  f.leadPages.set("/0/0", { ...base, issue_id: undefined, entries: [emptySummary] });
  f.leadPages.set("frontend-lead/0/0", {
    ...leadPage(),
    issue_id: undefined,
    entries: [emptySummary],
    detail: {
      ...leadPage().detail,
      requests: [],
      request_total: 0,
      request_next: undefined,
      proposals: [leadPage().detail.proposals[1]],
      proposal_total: 1,
      proposal_next: undefined,
      related_work: [],
      related_total: 0,
    },
  });
  f.source.value = Schema.decodeSync(WorkspaceSnapshotSchema)({
    ...f.source.value,
    work: {
      ...f.source.value.work,
      work: [],
      management: {
        entries: [
          {
            lead_id: "frontend-lead",
            repository_id: "fixture",
            state: "running",
            unanswered: 0,
            proposals: 1,
          },
        ],
        total: 1,
        truncated: false,
        diagnostic_count: 0,
      },
    },
  });
  const page = await f.browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(f.origin);
  await page.locator("[data-management-attention]").waitFor();
  assert.equal(f.calls.filter((call) => call.name === "leads").length, 0);
  await page.locator("[data-management-attention] > summary").click();
  await page.getByRole("region", { name: "Retained lead history" }).waitFor();
  assert.ok(
    f.calls
      .filter((call) => call.name === "leads")
      .every((call) => call.input.repository_id === "fixture" && !call.input.issue_id),
  );
  assert.equal(f.source.value.work.work.length, 0);
  assert.equal(f.source.submissions, 0);
  assert.equal(f.replies.length, 0);
  assert.equal(f.source.stops, 0);
  await screenshot(page, "lead-attention-without-work.png");
});

test("typed reviews and external validation keep pending evidence distinct and paginate retained results", async (t) => {
  const f = await fixture();
  t.onTestFinished(f.close);
  const head = "a".repeat(40);
  const findings = Array.from({ length: 21 }, (_, index) => ({
    id: `finding-${index}`,
    source_id: `check-${index}`,
    revision: "attempt-one",
    head,
    kind: "check",
    text: `Pending validation ${index}`,
    blocking: true,
    logs: "Native check has not completed",
  }));
  const limits = Object.fromEntries(
    ["intent", "rebase", "review", "test", "document", "lint", "push", "pr", "ci"].map((step) => [
      step,
      1,
    ]),
  );
  const external = {
    schema_version: 1,
    generation: 0,
    nonce: "current-external",
    validation_generation: "generation-one",
    submitted_head: head,
    intent: "Verify retained patch",
    intent_digest: "digest",
    branch: "fixture/work",
    custody: "external",
    status: "gated",
    preflight: {
      schema_version: 1,
      version: "1.84.0",
      bin: "validation-engine",
      home: "/fixture",
      fix_limits: limits,
      config_digest: "config-digest",
    },
    created_at: 1,
    observed_at: 2,
    next_check_at: 3,
    responses: [],
    observation: {
      gate: {
        step: "test",
        status: "awaiting_approval",
        summary: "An existing native approval is needed",
        findings: [],
      },
    },
  };
  const common = {
    observation: {
      head,
      pr: "https://github.com/fixture/project/pull/1",
      target: "main",
      observed_at: 2,
      next_check_at: 3,
      complete: false,
    },
    finding_total: 21,
    external_validation: external,
    external_history_total: 2,
  };
  f.feedbackPages.set(0, {
    ...common,
    findings: findings.slice(0, 20),
    external_history: [
      {
        ...external,
        nonce: "past-external-one",
        status: "aborted",
        custody: "uncertain",
        error: "Retained validation was interrupted",
      },
    ],
  });
  f.feedbackPages.set(1, {
    ...common,
    findings: findings.slice(20),
    external_history: [
      {
        ...external,
        nonce: "past-external-two",
        status: "aborted",
        custody: "uncertain",
        error: "Earlier retained validation was interrupted",
      },
    ],
  });
  const page = await f.browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${f.origin}/?issue=abra-web&tab=Feedback`);
  await page.getByRole("heading", { name: "Reviews & checks", exact: true }).waitFor();
  assert.equal(await page.locator('[data-presentation="finding"]').count(), 20);
  await page.getByText(/Feedback observation incomplete/).waitFor();
  assert.equal(await page.getByText("No terminal outcome recorded", { exact: true }).count(), 2);
  await page.getByRole("button", { name: "Next evidence", exact: true }).click();
  await page
    .locator('[data-slot="card-description"]')
    .filter({ hasText: /^Pending validation 20$/ })
    .waitFor();
  await page.getByText("Earlier retained validation was interrupted", { exact: true }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Next evidence", exact: true }).isDisabled(),
    true,
  );
  assert.equal(f.source.submissions, 0);
  assert.equal(f.source.stops, 0);
  assert.equal(f.replies.length, 0);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await screenshot(page, "typed-reviews-390.png");
});

test("native observation outages retain data and the server fallback recovers missed events without browser polling", async (t) => {
  const f = await fixture();
  t.onTestFinished(f.close);
  const page = await f.browser.newPage({ viewport: { width: 1440, height: 1000 } });
  let bootstrapReads = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/bootstrap") bootstrapReads++;
  });
  await page.goto(`${f.origin}/?issue=abra-web&tab=Overview`);
  const composer = page.getByRole("textbox", { name: "Message Abra" });
  await composer.fill("Preserve my draft through native reconnect");
  await page.getByText("Details for Build a single workspace", { exact: true }).waitFor();
  f.setObservationOffline(true);
  await f.changed();
  await page
    .getByRole("alert")
    .filter({ hasText: "Native observation unavailable" })
    .waitFor({ timeout: 3000 });
  await page.getByText("Details for Build a single workspace", { exact: true }).waitFor();
  assert.equal(await composer.inputValue(), "Preserve my draft through native reconnect");
  f.source.value = {
    ...f.source.value,
    at: "2026-11-16T01:00:00Z",
    work: {
      ...f.source.value.work,
      work: [{ ...f.source.value.work.work[0], title: "Recovered through server fallback" }],
    },
  };
  f.setObservationOffline(false);
  // Intentionally omit a change notification: the existing server fallback must recover it.
  await page
    .getByText("Details for Recovered through server fallback", { exact: true })
    .waitFor({ timeout: 8000 });
  await page.getByRole("alert").waitFor({ state: "hidden" });
  f.source.value = {
    ...f.source.value,
    at: "2026-11-15T10:00:00Z",
    work: {
      ...f.source.value.work,
      work: [{ ...f.source.value.work.work[0], title: "Old observation" }],
    },
  };
  await f.changed();
  // Sequence, rather than wall time, orders this fresh observation.
  await page.getByRole("heading", { name: "Old observation", exact: true }).waitFor();
  assert.equal(await page.getByRole("alert").count(), 0);
  assert.equal(bootstrapReads, 1);
  assert.equal(f.source.submissions, 0);
  assert.equal(await composer.inputValue(), "Preserve my draft through native reconnect");
});

test("owned session bookmarks render paginated tools and refresh queued/unknown activity without a worker composer", async (t) => {
  const f = await fixture();
  t.onTestFinished(f.close);
  const original = f.source.value.work.work[0];
  const work = {
    ...original,
    active_role: "apply" as const,
    sessions: [
      { id: "ses_past", role: "explore" as const },
      { id: "ses_current", role: "apply" as const },
    ],
  };
  f.source.value = Schema.decodeSync(WorkspaceSnapshotSchema)({
    ...f.source.value,
    work: { ...f.source.value.work, work: [work] },
  });
  f.workerStates.set("ses_past", {
    native_activity: "queued",
    configured_model: { providerID: "fixture", id: "planning-model" },
  });
  f.workerStates.set("ses_current", {
    native_activity: "running",
    model: { providerID: "fixture", id: "implementation-model" },
  });
  const at = f.source.value.at;
  const past = {
    id: "msg_past",
    role: "assistant",
    text: "Before a retained check.After a retained check.",
    at,
    limited: false,
    tools: [
      {
        id: "call_retained_check",
        name: "check",
        status: "error",
        input: '{"command":"test"}',
        result: "The retained check failed",
      },
    ],
    parts: [
      { type: "text", text: "Before a retained check." },
      { type: "tool", tool_id: "call_retained_check" },
      { type: "text", text: "After a retained check." },
    ],
  };
  f.workerPages.set("ses_past/", {
    session_id: "ses_past",
    observed_at: at,
    messages: [past],
    older: "native-issued-older",
  });
  f.workerPages.set("ses_past/native-issued-older", {
    session_id: "ses_past",
    observed_at: at,
    messages: [
      { id: "msg_earlier", role: "user", text: "Original retained assignment", at, limited: false },
    ],
  });
  f.workerPages.set("ses_current/", {
    session_id: "ses_current",
    observed_at: at,
    messages: [
      {
        id: "msg_current",
        role: "assistant",
        text: "Current worker observation",
        at,
        limited: false,
      },
    ],
  });
  const page = await f.browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(`${f.origin}/?issue=abra-web&tab=Workers`);
  await page.getByText("Current worker observation", { exact: true }).waitFor();
  await page
    .getByLabel("Retained worker sessions")
    .locator('[data-presentation="session"]')
    .first()
    .getByRole("button", { name: "Inspect session", exact: true })
    .click();
  await page.locator('[data-worker-message-id="msg_past"]').waitFor();
  assert.equal(await page.getByLabel("Read-only worker session").inputValue(), "ses_past");
  assert.match(page.url(), /ses_past/);
  const message = page.locator('[data-worker-message-id="msg_past"]');
  await message.locator('[data-tool-call-id="call_retained_check"]').waitFor();
  assert.deepEqual(
    await message
      .locator(".prose, [data-tool-call-id]")
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-tool-call-id") ?? node.textContent),
      ),
    ["Before a retained check.", "call_retained_check", "After a retained check."],
  );
  await message.locator("summary").first().click();
  await message.getByText("The retained check failed", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Earlier worker messages", exact: true }).click();
  await page.getByText("Original retained assignment", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Latest worker messages", exact: true }).click();
  await message.waitFor();
  await page.reload();
  await message.waitFor();
  f.workerStates.set("ses_past", {
    native_activity: "unknown",
    note: "Native activity is unknown",
  });
  await f.changed();
  await page
    .getByLabel("Retained worker sessions")
    .locator('[data-presentation="session"]')
    .first()
    .getByText("Unknown", { exact: true })
    .waitFor({ timeout: 3000 });
  assert.equal(await page.getByRole("textbox").count(), 1);
  assert.equal(f.source.submissions, 0);
  assert.equal(f.replies.length, 0);
  await screenshot(page, "typed-worker-transcript.png");
});

test("typed communication retains response obligations, pages and exact decision/native-form navigation", async (t) => {
  const f = await fixture();
  t.onTestFinished(f.close);
  const at = f.source.value.at;
  const decision = {
    schema_version: 1,
    key: "storage",
    generation: 2,
    scope: "Persistence",
    question: "Which storage should we retain?",
    owner: "user",
    session_id: "ses_worker",
    opened_at: 1,
    status: "open",
    form_id: "frm_existing",
  };
  const entries = Array.from({ length: 21 }, (_, index) => ({
    record: {
      schema_version: 1,
      request_id: `request-${index}`,
      prompt_id: `msg_request_${index}`,
      assignment_id: `msg_assignment_${index}`,
      generation: 2,
      sender_session_id: "ses_supervisor",
      recipient_session_id: "ses_worker",
      role: "apply",
      prompt: "PRIVATE NATIVE REPLAY MATERIAL",
      body: `Retained request ${index}`,
      response: "answer",
      delivery: "queue",
      created_at: at,
      status: index === 1 ? "acknowledged" : index === 2 ? "answered" : "admitted",
      ...(index === 0
        ? {
            source: { type: "decision", key: "storage" },
            response_recovery: {
              prompt_id: "msg_recovery",
              prompt: "PRIVATE RECOVERY PROMPT",
              created_at: at,
              completion_id: "msg_completed",
              completed_at: at,
              status: "admitted",
            },
          }
        : {}),
      ...(index === 1 || index === 2 ? { acknowledged_at: at } : {}),
      ...(index === 2
        ? {
            reply: {
              body: "An exact retained answer",
              evidence: [{ url: "https://example.com/retained-evidence" }],
              at,
            },
          }
        : {}),
    },
    native_state: "unknown",
    native_outcome: "failed",
    ...(index === 0 ? { decision, recovery_native: "consumed" } : {}),
  }));
  f.setCommunications(entries);
  f.setObligations({
    decisions: [decision],
    waits: [
      {
        schema_version: 1,
        key: "dependency",
        generation: 2,
        kind: "dependency",
        reference: "abra-dependency",
        condition: "Dependency must finish",
        owner: "deployment owner",
        expires_in_ms: 1000,
        session_id: "ses_worker",
        started_at: 1,
        expires_at: 1001,
        next_check_at: 1001,
        status: "expired",
      },
    ],
  });
  f.source.value = {
    ...f.source.value,
    forms: [
      {
        binding: "existing-native-binding",
        active: true,
        form: {
          id: Form.ID.make("frm_existing"),
          sessionID: f.source.sessionID,
          title: "Existing storage decision",
          fields: [{ key: "answer", title: "Storage answer", type: "string", required: true }],
        },
      },
    ],
  };
  const page = await f.browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${f.origin}/?issue=abra-web&tab=Communication`);
  await page.locator('[data-presentation="communication"]').first().waitFor();
  assert.equal(await page.locator('[data-presentation="communication"]').count(), 20);
  await page.getByText("Acknowledged; awaiting answer", { exact: true }).waitFor();
  assert.equal(await page.getByText("PRIVATE NATIVE REPLAY MATERIAL", { exact: false }).count(), 0);
  await page.reload();
  await page.getByText("Acknowledged; awaiting answer", { exact: true }).waitFor();
  const answered = page.locator('[data-presentation="communication"]').nth(2);
  await answered.getByText("Request body & replies", { exact: true }).click();
  await answered
    .locator("details[open]")
    .getByText("An exact retained answer", { exact: true })
    .waitFor();
  const first = page.locator('[data-presentation="communication"]').first();
  await first.getByText("Request body & replies", { exact: true }).click();
  await first.getByText(/A recovery admission does not establish an answer/).waitFor();
  await screenshot(page, "typed-communication-390.png");
  await page.getByRole("button", { name: "Next communication", exact: true }).click();
  await page
    .locator('[data-slot="card-description"]')
    .filter({ hasText: /^Retained request 20$/ })
    .waitFor();
  await page.getByRole("button", { name: "Previous communication", exact: true }).click();
  await first.getByText("Request body & replies", { exact: true }).click();
  await first.getByRole("button", { name: "Open existing decision", exact: true }).click();
  await page.locator('[data-decision-key="storage"]').waitFor();
  assert.match(page.url(), /open_decision/);
  await page.getByText("Dependency must finish", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Answer in native form", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.waitForFunction(
    () => document.activeElement?.getAttribute("data-native-form-id") === "frm_existing",
  );
  assert.equal(f.source.submissions, 0);
  assert.equal(f.replies.length, 0);
  await page.getByLabel("Storage answer").fill("Retain SQLite");
  await page.getByRole("button", { name: "Submit answer", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('[data-native-form-id="frm_existing"]').length === 0,
  );
  assert.equal(f.replies.length, 1);
  assert.deepEqual(f.replies[0].answer, { answer: "Retain SQLite" });
  await page.goto(`${f.origin}/?issue=abra-web&tab=Decisions`);
  await page.getByText(/The current native answer form is unavailable/).waitFor();
  f.setObligations({
    decisions: [{ ...decision, status: "answered", answer: "Retain SQLite", resolved_at: 2 }],
    waits: [],
  });
  await f.changed();
  await page.getByText(/Resolved decision history/).click();
  await page
    .locator('[data-decision-key="storage"]')
    .getByText("Answered", { exact: true })
    .waitFor({ timeout: 3000 });
  assert.equal(
    await page.getByRole("button", { name: "Answer in native form", exact: true }).count(),
    0,
  );
  assert.equal(f.source.submissions, 0);
});

test("policy-specific planning and independent outcomes remain usable when a document fails", async (t) => {
  const f = await fixture();
  t.onTestFinished(f.close);
  const base = f.source.value.work.work[0];
  const work = [
    {
      ...base,
      issue_id: IssueId.make("abra-full"),
      title: "Archived full task",
      policy: "full-openspec" as const,
      phase: "completed" as const,
    },
    {
      ...base,
      issue_id: IssueId.make("abra-fix"),
      title: "Scoped fix",
      policy: "lightweight-fix" as const,
    },
    {
      ...base,
      issue_id: IssueId.make("abra-research"),
      title: "Scoped research",
      policy: "research-only" as const,
    },
  ];
  f.setDiscovery([
    Schema.decodeSync(WorkItemSchema)({
      ...work[0],
      outcome: {
        execution_id: "execution-archived",
        generation: 0,
        observed_at: 1,
        approval: { kind: "plan", state: "recorded" },
        delivery: { kind: "branch", state: "verified" },
        cleanup: { state: "in_progress", generated_paths: [] },
        closure: "open",
        next_action: "Clean up retained resources",
      },
    }),
    ...work.slice(1),
  ]);
  f.detailOverrides.set("abra-full", {
    planning: { source: "archive", commit: "a".repeat(40), limited: false },
    errors: ["One retained document is unavailable"],
    proposal: undefined,
  });
  f.detailOverrides.set("abra-fix", { proposal: "# Recorded fix scope", documents: undefined });
  f.detailOverrides.set("abra-research", {
    proposal: "# Recorded research contract",
    documents: undefined,
  });
  const page = await f.browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto(`${f.origin}/?issue=abra-full&tab=Plan`);
  await page.getByText(/Retained archive at/).waitFor();
  await page.getByText("One retained document is unavailable", { exact: true }).waitFor();
  await page.getByRole("button", { name: "proposal.md", exact: true }).click();
  await page.getByRole("heading", { name: "Retained proposal", exact: true }).waitFor();
  await page.getByRole("tab", { name: "Overview", exact: true }).click();
  await page.getByRole("region", { name: "Independent work outcomes" }).waitFor();
  assert.deepEqual(
    await page
      .getByRole("region", { name: "Independent work outcomes" })
      .locator("dd")
      .allTextContents(),
    ["Recorded", "Verified", "In progress", "Open"],
  );
  for (const [issue, title] of [
    ["abra-fix", "Recorded fix scope"],
    ["abra-research", "Recorded research contract"],
  ]) {
    await page.goto(`${f.origin}/?issue=${issue}&tab=Plan`);
    await page.getByRole("heading", { name: title, exact: true }).waitFor();
    assert.equal(await page.getByText(/implementation tasks complete/).count(), 0);
    assert.equal(await page.getByRole("button", { name: "proposal.md", exact: true }).count(), 0);
  }
  await page.getByRole("tab", { name: "Reports", exact: true }).click();
  await page.getByRole("heading", { name: "Retained report", exact: true }).waitFor();
  assert.equal(f.source.submissions, 0);
});

test("selected off-page tasks refresh without bootstrap membership or a second polling loop", async (t) => {
  const f = await fixture();
  t.onTestFinished(f.close);
  const original = f.source.value.work.work[0];
  const outside = {
    ...original,
    issue_id: IssueId.make("abra-outside"),
    title: "Retained off-page task",
  };
  f.setDiscovery([original, outside]);
  const page = await f.browser.newPage({ viewport: { width: 1600, height: 1000 } });
  let bootstrapReads = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/bootstrap") bootstrapReads++;
  });
  await page.goto(`${f.origin}/?issue=abra-outside&tab=Overview`);
  await page.getByText("Details for Retained off-page task", { exact: true }).waitFor();
  f.setDiscovery([original, { ...outside, title: "Updated off-page task" }]);
  await f.changed();
  await page
    .getByText("Details for Updated off-page task", { exact: true })
    .waitFor({ timeout: 3000 });
  assert.equal(
    f.source.value.work.work.some((work) => work.issue_id === outside.issue_id),
    false,
  );
  assert.equal(bootstrapReads, 1);
  f.failedReads.add("detail");
  await f.changed();
  await page.getByRole("alert").filter({ hasText: "Request could not be confirmed" }).waitFor();
  await page.getByText("Showing the last successful observation.", { exact: true }).waitFor();
  await page.getByText("Details for Updated off-page task", { exact: true }).waitFor();
  f.failedReads.delete("detail");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await page.getByRole("alert").waitFor({ state: "hidden" });
  assert.equal(f.source.submissions, 0);
});

test("chat stays mounted while the finder searches retained pages, preserving draft, scroll and native queue/Stop", async (t) => {
  const f = await fixture();
  t.onTestFinished(f.close);
  const current = f.source.value.work.work[0];
  f.setDiscovery([
    current,
    ...Array.from({ length: 56 }, (_, index) => ({
      ...current,
      issue_id: IssueId.make(`closed-${String(index).padStart(2, "0")}`),
      title: `Closed task ${String(index).padStart(2, "0")}`,
      issue_status: "closed" as const,
    })),
  ]);
  f.source.value = {
    ...f.source.value,
    busy: true,
    messages: Array.from({ length: 35 }, (_, index) => ({
      id: `msg_reading_${index}`,
      role: "assistant" as const,
      text: `Retained message ${index}. ${"A useful observation remains available while you inspect work. ".repeat(12)}`,
      at: f.source.value.at,
    })),
  };
  const page = await f.browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto(f.origin);
  const composer = page.getByRole("textbox", { name: "Message Abra" });
  await composer.fill("Composition guard");
  await composer.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true });
  assert.equal(f.source.submissions, 0);
  await composer.press("Shift+Enter");
  assert.ok((await composer.inputValue()).includes("\n"));
  await composer.fill("Keep this draft while I inspect work");
  await composer.evaluate((element) => {
    element.dataset.mountIdentity = "same-composer";
  });
  await page.getByRole("log").evaluate((element) => {
    element.dataset.mountIdentity = "same-chat";
  });
  assert.equal(await page.getByRole("button", { name: /Work views/ }).count(), 0);
  await page.getByText(/^Retained message 34\./).waitFor();
  await page.locator(".conversation-scroll").evaluate(async (element) => {
    element.scrollTop = 600;
    // Measure a painted reading position, after offscreen estimates become visible content.
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  const anchor = await page.locator(".conversation-scroll").evaluate((element) => {
    const top = element.getBoundingClientRect().top;
    const message = [...element.querySelectorAll<HTMLElement>("[data-native-message-id]")].find(
      (message) => message.getBoundingClientRect().bottom > top,
    )!;
    return {
      id: message.dataset.nativeMessageId!,
      offset: message.getBoundingClientRect().top - top,
    };
  });
  // Freeze the initial search debounce until pagination has already advanced.
  // An unchanged empty search must not send the reader back to page one.
  await page.clock.install();
  await page.clock.pauseAt(Date.now() + 100);
  f.setFleetObservation({ state: "unavailable" });
  await page.getByRole("button", { name: "Toggle work finder" }).click();
  await page.getByText("Fleet totals are temporarily unavailable.", { exact: true }).waitFor();
  f.setFleetObservation({ state: "stale", observed_at: f.source.value.work.at });
  f.source.value = {
    ...f.source.value,
    work: {
      ...f.source.value.work,
      fleet: {
        counts: { ...fleetCounts([]), completed: 56, waiting: 1 },
        total: 57,
        native_observed: 0,
        native_total: 0,
        completed_today: 0,
        day_start: f.source.value.work.at,
        day_end: f.source.value.work.at,
        timezone: "UTC",
        attention: [],
        repositories: [],
      },
    },
  };
  await page.getByRole("button", { name: "Closed", exact: true }).click();
  await page.getByText(/56 matching tasks/).waitFor();
  await page.getByText("Fleet across all projects · 57 tasks · Stale", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByText("51–56 of 56", { exact: true }).waitFor();
  await page.clock.runFor(250);
  await page.getByRole("button", { name: /Closed task 55/ }).waitFor({ timeout: 1000 });
  await page.clock.resume();
  await page.getByRole("button", { name: /Closed task 55/ }).click();
  await page.getByRole("heading", { name: "Closed task 55", exact: true }).waitFor();
  assert.equal(await composer.getAttribute("data-mount-identity"), "same-composer");
  assert.equal(await page.getByRole("log").getAttribute("data-mount-identity"), "same-chat");
  assert.equal(await composer.inputValue(), "Keep this draft while I inspect work");
  const offset = await page
    .locator(`[data-native-message-id="${anchor.id}"]`)
    .evaluate(
      (element) =>
        element.getBoundingClientRect().top -
        document.querySelector(".conversation-scroll")!.getBoundingClientRect().top,
    );
  assert.ok(
    Math.abs(offset - anchor.offset) < 4,
    `Reading position moved from ${anchor.offset} to ${offset}`,
  );
  assert.equal(f.source.submissions, 0);
  await page.getByRole("button", { name: "Close inspector", exact: true }).click();
  for (const width of [375, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByLabel("Color theme").selectOption(width === 375 ? "dark" : "light");
    await page.getByRole("button", { name: "Toggle work finder" }).click();
    await page.getByRole("dialog").waitFor();
    await screenshot(page, `chat-primary-finder-${width}.png`);
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.equal(
      await page.evaluate(() => document.activeElement?.getAttribute("aria-label")),
      "Toggle work finder",
    );
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.equal(await composer.inputValue(), "Keep this draft while I inspect work");
    const stop = await page
      .getByRole("button", { name: "Stop current Abra turn", exact: false })
      .boundingBox();
    assert.ok(stop && stop.x >= 0 && stop.x + stop.width <= width, "Stop must remain reachable");
  }
  await composer.fill("Queue this message for Abra");
  await composer.press("Enter");
  await page.getByText("I can help you build that.", { exact: true }).waitFor();
  assert.equal(f.source.submissions, 1);
  assert.equal(f.source.value.receipts.at(-1)?.delivery, "queue");
  const stopped = page.waitForResponse((response) => response.url().endsWith("/api/abra/stop"));
  await page.getByRole("button", { name: "Stop current Abra turn", exact: false }).click();
  await stopped;
  assert.equal(f.source.stops, 1);
  assert.equal(f.source.value.work.work.length, 1);
  assert.equal(f.source.replies, 0);
});

test("historical generated cards reopen exact revisions and repair-response attachments without tool replay", async (t) => {
  const f = await fixture();
  t.onTestFinished(f.close);
  const record = (revision: number, title: string, message: string) =>
    Schema.decodeSync(SurfaceRecordSchema)({
      session_id: f.source.sessionID,
      message_id: message,
      tool_call_id: `${message}/call-view-${revision}`,
      history: "immutable",
      revision,
      at: f.source.value.at,
      snapshot: f.source.value.work.work,
      surface: {
        version: "1.0",
        createSurface: {
          surfaceId: "retained-board",
          catalogId,
          components: [
            { id: "root", component: "Column", children: ["heading", "work"] },
            { id: "heading", component: "Text", text: title },
            { id: "work", component: "WorkTable", issueIds: ["abra-web"], mode: "snapshot" },
          ],
        },
      },
    });
  const first = record(1, "Original generated layout", "msg_view_one"),
    second = record(2, "Revised generated layout", "msg_view_two");
  f.source.surfaceHistory.set("retained-board/1", first);
  f.source.surfaceHistory.set("retained-board/2", second);
  const oldMessage = Schema.decodeSync(TranscriptMessageSchema)({
    id: "msg_view_one",
    role: "assistant",
    at: f.source.value.at,
    text: "",
    tools: [
      {
        id: "call-view-1",
        name: "abra_render_ui",
        status: "error",
        result: "Publication response was lost",
      },
    ],
    parts: [{ type: "tool", tool_id: "call-view-1" }],
  });
  const value = Schema.decodeSync(WorkspaceSnapshotSchema)({
    ...f.source.value,
    surfaces: [second],
    older: "older-view",
    messages: [
      {
        id: "msg_view_two",
        role: "assistant",
        at: f.source.value.at,
        text: "",
        tools: [
          {
            id: "call-view-2",
            name: "abra_render_ui",
            status: "completed",
            presentation: {
              kind: "surface",
              surface_id: "retained-board",
              revision: 2,
              version: "1.0",
            },
          },
        ],
        parts: [{ type: "tool", tool_id: "call-view-2" }],
      },
    ],
    presentations: {
      entries: [
        {
          session_id: f.source.sessionID,
          message_id: "msg_view_two",
          tool_call_id: "call-view-2",
          source: "tool",
          target: { kind: "surface", surface_id: "retained-board", revision: 2 },
        },
      ],
      truncated: false,
    },
  });
  f.source.value = value;
  const association = {
    ...value.presentations!.entries[0],
    message_id: first.message_id!,
    tool_call_id: "call-view-1",
    target: { kind: "surface" as const, surface_id: "retained-board", revision: 1 },
  };
  f.backend.history = () =>
    Effect.succeed({
      messages: [oldMessage],
      presentations: { entries: [association], truncated: false },
    });
  const page = await f.browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(f.origin);
  await page.getByText("Revised generated layout", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Load earlier messages", exact: true }).click();
  await page.getByText("Original generated layout", { exact: true }).waitFor();
  assert.equal(await page.locator('[data-surface-reference="retained-board/1"]').count(), 1);
  assert.equal(await page.locator('[data-surface-reference="retained-board/2"]').count(), 1);
  f.source.value = {
    ...f.source.value,
    work: {
      ...f.source.value.work,
      work: [{ ...f.source.value.work.work[0], title: "Live work changed" }],
    },
  };
  await f.changed();
  assert.doesNotMatch(
    await page.locator('[data-surface-reference="retained-board/1"]').innerText(),
    /Live work changed/,
  );
  await screenshot(page, "chat-primary-exact-revisions.png");
  await page.reload();
  await page.getByText("Revised generated layout", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Load earlier messages", exact: true }).click();
  await page.getByText("Original generated layout", { exact: true }).waitFor();
  assert.equal(await page.locator('[data-tool-call-id="call-view-1"]').count(), 1);
  assert.equal(f.source.submissions, 0);
  assert.equal(f.source.replies, 0);
  assert.equal(f.source.stops, 0);
});

test("fleet and project totals distinguish native queue, capacity and dependency waits across history pages", async (t) => {
  const f = await fixture();
  t.onTestFinished(f.close);
  const current = f.source.value.work.work[0];
  const counts = {
    running: 1,
    native_queued: 1,
    ready: 0,
    capacity_wait: 1,
    dependency_wait: 1,
    human_wait: 1,
    supervisor_wait: 0,
    recovery_required: 0,
    paused: 0,
    waiting: 0,
    completed: 56,
    unknown: 0,
  };
  f.source.value = {
    ...f.source.value,
    work: {
      ...f.source.value.work,
      fleet: {
        counts,
        total: 61,
        native_observed: 2,
        native_total: 2,
        repositories: [{ repository_id: RepositoryId.make("fixture"), counts, attention_total: 1 }],
        completed_today: 7,
        day_start: Timestamp.make("2026-11-15T00:00:00Z"),
        day_end: Timestamp.make("2026-11-16T00:00:00Z"),
        timezone: "UTC",
        attention: [
          {
            issue_id: current.issue_id,
            title: current.title,
            key: "plan-approval",
            reason: "Plan approval required",
            owner: "user",
            next_action: "Review the existing plan approval",
          },
        ],
        attention_total: 1,
        attention_truncated: false,
      },
    },
  };
  f.setDiscovery([
    {
      ...current,
      repository_id: RepositoryId.make("fixture"),
      title: "Capacity pending task",
      capacity_wait: {
        role: "apply",
        reasons: ["Execution slots are occupied"],
        consuming: [],
        next_check_at: 0,
      },
      blockers: ["Execution slots are occupied"],
    },
    ...Array.from({ length: 56 }, (_, index) => ({
      ...current,
      issue_id: IssueId.make(`history-${index}`),
      repository_id: RepositoryId.make("fixture"),
      title: `Historical task ${index}`,
      issue_status: "closed" as const,
    })),
  ]);
  const page = await f.browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(f.origin);
  await page
    .getByRole("button", { name: /Build a single workspace.*Plan approval required/ })
    .waitFor();
  await page.getByRole("button", { name: "Toggle work finder" }).click();
  await page.getByRole("button", { name: /Capacity pending task/ }).waitFor();
  assert.match(
    await page.getByRole("button", { name: /Capacity pending task/ }).innerText(),
    /Waiting for capacity.*Execution slots are occupied/,
  );
  const fleet = page.locator(".fleet-summary");
  await fleet.locator(":scope > summary").click();
  await page
    .getByRole("region", { name: "Fleet by project" })
    .getByText("Fixture project", { exact: true })
    .click();
  const project = page.getByRole("region", { name: "Fleet by project" });
  assert.match(await project.innerText(), /Native queued\s+1/);
  assert.match(await project.innerText(), /Waiting for capacity\s+1/);
  assert.match(await project.innerText(), /Dependency blocked\s+1/);
  assert.match(await project.innerText(), /1 attention item/);
  await page.getByRole("button", { name: "Closed", exact: true }).click();
  await page.getByText(/56 matching tasks/).waitFor();
  assert.match(await fleet.innerText(), /61 tasks/);
  assert.match(await fleet.innerText(), /Completed today: 7 \(UTC\)/);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByText("Historical task 55", { exact: true }).waitFor();
  assert.match(await fleet.innerText(), /Completed today: 7 \(UTC\)/);
  const search = page.getByRole("textbox", { name: "Search work" });
  await search.fill("Historical task 55");
  await page.getByText(/1 matching task/).waitFor();
  assert.equal(await search.inputValue(), "Historical task 55");
  assert.equal(f.source.submissions, 0);
  assert.equal(f.source.stops, 0);
  assert.equal(f.source.replies, 0);
  await screenshot(page, "fleet-projects-390.png");
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
});

test("review evidence retains uncertain submissions, preflight recovery and stale observations without forge actions", async (t) => {
  const f = await fixture();
  t.onTestFinished(f.close);
  f.feedbackPages.set(0, { ...feedbackFixture(false), issue_id: IssueId.make("abra-web") });
  const page = await f.browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${f.origin}/?issue=abra-web&tab=Feedback`);
  await page.getByText(/Stale retained observation/).waitFor();
  await page.getByText("Submission: Unsubmitted", { exact: true }).waitFor();
  await page.getByText(/Preflight retry available: Permission lookup unavailable/).waitFor();
  const actions = page.getByRole("region", { name: "Retained review actions" });
  assert.match(await actions.innerText(), /Uncertain/);
  for (const summary of await actions.locator("details > summary").all()) await summary.click();
  await page.getByText("Response lost; reconcile before retry", { exact: true }).waitFor();
  await page.getByText("Reviewer request pending: reviewer", { exact: true }).waitFor();
  assert.equal(f.source.submissions, 0);
  assert.equal(f.source.stops, 0);
  assert.equal(f.replies.length, 0);
  await screenshot(page, "retained-review-actions-390.png");
});

test("overview retains bounded schema, stronger approval and repair observations across a legacy refresh", async (t) => {
  const f = await fixture();
  t.onTestFinished(f.close);
  const original = f.source.value.work.work[0]!;
  f.setDiscovery([
    {
      ...original,
      execution_contract: {
        schema: {
          state: "bound",
          name: SpecSchemaName.make("abra-compact-v1"),
          source: "project",
          selection_source: "task",
          hash: ContentHash.make("a".repeat(64)),
          file_count: 4,
        },
        plan_approval: { required: true, source: "task_requirement" },
        repair: { configured: 2, allowance: 2, consumed: 1, remaining: 1 },
      },
    },
  ]);
  const page = await f.browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${f.origin}/?issue=abra-web&tab=Overview`);
  const contract = page.getByRole("region", { name: "Planning and repair contract" });
  await contract.getByText(/Schema abra-compact-v1/).waitFor();
  await contract.getByText(/Human plan approval required · task requirement/).waitFor();
  await contract.getByText(/Automatic repair: 1 consumed · 1 remaining/).waitFor();
  await screenshot(page, "compact-contract-390.png");
  f.setDiscovery([
    {
      ...original,
      execution_contract: {
        schema: { state: "unavailable", reason: "legacy_record" },
        plan_approval: { required: true, source: "unavailable" },
        repair: { configured: 2, allowance: 0, consumed: 1, remaining: 0 },
      },
    },
  ]);
  await f.changed();
  await contract.getByText(/Original schema provenance is unavailable/).waitFor();
  await contract.getByText(/original policy source unavailable/).waitFor();
  await contract.getByText(/disabled by manual supervision/).waitFor();
  assert.equal(f.replies.length, 0);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
});

test("an optional inspector chunk has local accessible loading/error states and reload recovers the saved draft", async (t) => {
  const f = await fixture();
  t.onTestFinished(f.close);
  const page = await f.browser.newPage({ viewport: { width: 375, height: 812 } });
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/assets/inspector-*.js", async (route) => {
    await held;
    await route.abort("failed");
  });
  await page.goto(`${f.origin}/?issue=abra-web&tab=Overview`, { waitUntil: "domcontentloaded" });
  await page.getByRole("status").filter({ hasText: "Loading work inspection" }).waitFor();
  const composer = page.getByRole("textbox", { name: "Message Abra", exact: true });
  await composer.fill("Keep this draft while inspection is unavailable");
  release();
  await page.getByRole("alert").filter({ hasText: "Work inspection could not load" }).waitFor();
  assert.equal(await composer.inputValue(), "Keep this draft while inspection is unavailable");
  assert.equal(f.source.submissions, 0);
  await screenshot(page, "deferred-inspector-error-375.png");
  await page.unroute("**/assets/inspector-*.js");
  await page.getByRole("button", { name: "Reload to retry", exact: true }).click();
  await page.getByText("Details for Build a single workspace", { exact: true }).waitFor();
  // The narrow inspector is modal and correctly hides the mounted composer from AT.
  await page.setViewportSize({ width: 1440, height: 900 });
  assert.equal(await composer.inputValue(), "Keep this draft while inspection is unavailable");
  await screenshot(page, "deferred-inspector-recovered-desktop.png");
  await page.route("**/assets/work-finder-*.js", (route) => route.abort("failed"));
  await page.getByRole("button", { name: "Toggle work finder", exact: true }).click();
  const finderError = page.getByRole("alert").filter({ hasText: "Work finder could not load" });
  await finderError.waitFor();
  await page.getByRole("button", { name: "Toggle work finder", exact: true }).click();
  await finderError.waitFor({ state: "hidden" });
  assert.equal(await composer.inputValue(), "Keep this draft while inspection is unavailable");
  assert.equal(f.source.submissions, 0);
});
