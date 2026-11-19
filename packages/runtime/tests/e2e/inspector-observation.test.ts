/* oxlint-disable effecttsgo/unstable-api-usage -- Read-only typed query preservation. */
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { IssueId } from "../../src/identities.ts";
import { launchReportBrowser } from "@abracode/report-export/browser";
import { workspaceBrowserFixture } from "../helpers/workspace-browser.ts";

test("a delayed inspector read completes during live work observations", async (t) => {
  const browser = await launchReportBrowser();
  t.onTestFinished(() => browser.close());
  const f = await workspaceBrowserFixture(browser);
  t.onTestFinished(f.close);
  const work = f.source.value.work.work[0];
  f.source.value = {
    ...f.source.value,
    work: {
      ...f.source.value.work,
      work: [{ ...work, issue_id: IssueId.make("abra-slow"), title: "Live slow inspector" }],
    },
  };
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  let aborted = 0;
  page.on("requestfailed", (request) => {
    if (request.url().includes("/api/work/overview")) aborted++;
  });
  await page.goto(`${f.origin}/?issue=abra-slow&tab=Overview`);
  let revision = 0;
  const observations = setInterval(() => {
    f.source.value = {
      ...f.source.value,
      work: {
        ...f.source.value.work,
        work: f.source.value.work.work.map((item) => ({
          ...item,
          priority: ++revision % 2,
        })),
      },
    };
    void f.changed();
  }, 100);
  t.onTestFinished(() => clearInterval(observations));
  try {
    await page.getByText("Details for Live slow inspector", { exact: true }).waitFor({
      timeout: 3000,
    });
  } finally {
    clearInterval(observations);
  }
  assert.equal(aborted, 0, "Live invalidations coalesce instead of cancelling in-flight reads");
  assert.equal(f.source.submissions, 0);
});

test("an observation arriving in flight retains a pending Overview refresh and explicit refresh still works", async (t) => {
  const browser = await launchReportBrowser();
  t.onTestFinished(() => browser.close());
  const f = await workspaceBrowserFixture(browser);
  t.onTestFinished(f.close);
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  t.onTestFinished(release);
  let firstReady!: () => void;
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Initial Overview response was not captured")),
      3000,
    );
    t.onTestFinished(() => clearTimeout(timer));
    firstReady = () => {
      clearTimeout(timer);
      resolve();
    };
  });
  let requests = 0;
  await page.route("**/api/work/overview?*", async (route) => {
    const ordinal = ++requests;
    const response = await route.fetch();
    if (ordinal === 1) {
      firstReady();
      await held;
    }
    await route.fulfill({ response }).catch(() => {});
  });
  await page.goto(`${f.origin}/?issue=abra-web&tab=Overview`);
  await ready;
  f.detailOverrides.set("abra-web", { description: "Fresh after in-flight observation" });
  f.source.value = {
    ...f.source.value,
    work: {
      ...f.source.value.work,
      work: f.source.value.work.work.map((work) => ({
        ...work,
        title: "Observed in-flight work",
      })),
    },
  };
  for (let index = 0; index < 3; index++) await f.changed();
  // The new live work state must reach the browser while the old Overview is held.
  await page.getByRole("heading", { name: "Observed in-flight work", exact: true }).waitFor({
    timeout: 3000,
  });
  release();
  await page.getByText("Fresh after in-flight observation", { exact: true }).waitFor({
    timeout: 3000,
  });
  assert.equal(f.calls.filter((call) => call.name === "detail").length, 0);
  assert.ok(requests >= 2, "An in-flight invalidation must produce a later fresh read");
  f.detailOverrides.set("abra-web", { description: "Fresh after explicit user refresh" });
  await page
    .getByRole("complementary", { name: "Work inspector" })
    .getByRole("button", { name: "Refresh retained evidence", exact: true })
    .first() // The outer Overview query precedes its nested review-evidence query.
    .click();
  await page.getByText("Fresh after explicit user refresh", { exact: true }).waitFor({
    timeout: 3000,
  });
  assert.equal(f.source.submissions, 0);
});
