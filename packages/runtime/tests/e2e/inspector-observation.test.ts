/* oxlint-disable effecttsgo/unstable-api-usage -- Read-only typed query preservation. */
import { Effect } from "effect";
import { CrewError } from "../../src/domain.ts";
import { Form } from "@opencode/schema/form";
import { SessionMessage } from "@opencode/schema/session-message";
import { Schema } from "effect";
import { ReceiptSchema, selectionMarker } from "@abracode/contracts/web/workspace-wire";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { IssueId } from "@abracode/contracts/identities";
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
    .getByRole("button", { name: "Refresh canvas", exact: true })
    .click();
  await page.getByText("Fresh after explicit user refresh", { exact: true }).waitFor({
    timeout: 3000,
  });
  assert.equal(f.source.submissions, 0);
});

test("a diff selection and draft survive inspection of another task and reload", async (t) => {
  const f = await workspaceBrowserFixture();
  t.onTestFinished(f.close);
  const page = await f.browser.newPage();
  const first = f.source.value.work.work[0];
  f.source.value = {
    ...f.source.value,
    work: {
      ...f.source.value.work,
      work: [first, { ...first, issue_id: IssueId.make("abra-other"), title: "Another issue" }],
    },
  };
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.goto(f.origin + "/?issue=abra-web&tab=Diff");
  await page.getByLabel("Message Abra").fill("Does this cover a timeout?");
  const source = page.getByRole("region", { name: "source.ts", exact: true });
  await source.getByText("Select lines in source.ts").click();
  await source.getByLabel("First line").fill("1");
  await source.getByRole("button", { name: "Ask Abra", exact: true }).click();
  await page.locator(".selection-chip summary").click();
  assert.match(await page.locator(".selection-chip pre").innerText(), /export const newValue = 2/);
  await page.goto(f.origin + "/?issue=abra-other&tab=Overview");
  await page.getByText("Details for Another issue", { exact: true }).waitFor();
  await page.reload();
  await page.locator(".selection-chip").waitFor();
  assert.match(await page.locator(".selection-chip summary").innerText(), /abra-web.*source.ts/);
  assert.equal(await page.getByLabel("Message Abra").inputValue(), "Does this cover a timeout?");
  assert.equal(f.source.submissions, 0);
  f.backend.submit = () =>
    Effect.fail(
      new CrewError("SELECTION_STALE", "Review the updated diff or remove the selection."),
    );
  await page.getByRole("button", { name: "Send message" }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Review the updated diff or remove the selection." })
    .waitFor({ timeout: 3000 });
  assert.equal(await page.getByLabel("Message Abra").isEditable(), true);
  await page.getByRole("button", { name: "Remove selection" }).click();
  assert.equal(await page.getByLabel("Message Abra").inputValue(), "Does this cover a timeout?");
});

test("a retired selection reopens its captured excerpt and linked worker result after reload", async (t) => {
  const f = await workspaceBrowserFixture();
  t.onTestFinished(f.close);
  const request_id = "retired-question";
  const text = "Did the worker recheck this?";
  const excerpt = "+historical implementation";
  const selection = {
    kind: "diff",
    issue_id: "abra-web",
    scope: "all",
    file: "former.ts",
    side: "additions",
    start: 1,
    end: 1,
    patch_id: "a".repeat(64),
  };
  const native_text = text + selectionMarker + JSON.stringify({ request_id, selection, excerpt });
  const at = new Date().toISOString();
  const message_id = SessionMessage.ID.create();
  const receipt = Schema.decodeUnknownSync(ReceiptSchema)({
    request_id,
    message_id,
    text,
    native_text,
    at,
    status: "admitted",
    delivery: "queue",
    capture: { selection, excerpt },
    followups: [
      {
        request_id: "worker-recheck",
        role: "apply",
        status: "answered",
        acknowledged_at: at,
        answer: "I rechecked the timeout.",
      },
    ],
  });
  f.source.retainedReceipts.set(request_id, receipt);
  f.source.value = {
    ...f.source.value,
    work: { ...f.source.value.work, work: [] },
    messages: [{ id: message_id, role: "user", text: native_text, at }],
  };
  f.failedReads.add("diff");
  const page = await f.browser.newPage();
  await page.goto(f.origin);
  await page.reload();
  await page.getByText(/former.ts.*Captured selection/).click();
  await page.getByText(excerpt, { exact: true }).waitFor();
  await page.getByText(/Worker acknowledged/).waitFor();
  await page.getByText("I rechecked the timeout.", { exact: true }).waitFor();
  assert.ok(!f.calls.some((c) => c.name === "diff"));
});

test("Verification uses one responsive canvas and keyboard resizing preserves the draft and route", async (t) => {
  const f = await workspaceBrowserFixture();
  t.onTestFinished(f.close);
  const page = await f.browser.newPage({ viewport: { width: 1600, height: 980 } });
  await page.goto(f.origin + "/?issue=abra-web&tab=Feedback");
  await page.getByLabel("Message Abra").fill("Keep this question");
  await page
    .getByRole("tablist", { name: "Work details", exact: true })
    .getByRole("tab", { name: "Verification", exact: true })
    .click();
  const width = page.getByRole("separator", { name: "Chat width" });
  const panel = page.getByRole("complementary", { name: "Work inspector" });
  const before = (await panel.boundingBox())!.width;
  await width.press("ArrowLeft");
  assert.ok((await panel.boundingBox())!.width > before);
  await page.goBack();
  await page
    .getByRole("tablist", { name: "Work details", exact: true })
    .getByRole("tab", { name: "Activity", exact: true, selected: true })
    .waitFor();
  await page.goForward();
  await page.setViewportSize({ width: 390, height: 830 });
  await page
    .getByRole("complementary", { name: "Work inspector" })
    .getByRole("tablist", { name: "Work details", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Close inspector", exact: true }).click();
  assert.equal(await page.getByLabel("Message Abra").inputValue(), "Keep this question");
  assert.ok(!f.calls.some((c) => ["document", "diff", "worker-history"].includes(c.name)));
});

test("verification keeps a superseded check inspectable and distinguishes missing Review and research scope", async (t) => {
  const f = await workspaceBrowserFixture();
  t.onTestFinished(f.close);
  f.source.value = {
    ...f.source.value,
    work: {
      ...f.source.value.work,
      work: f.source.value.work.work.map((work) => ({ ...work, policy: "lightweight-fix" })),
    },
  };
  const old = "a".repeat(64);
  f.detailOverrides.set("abra-web", {
    verification: {
      scope: { goal: "Keep the deadline", acceptance: ["Stop on timeout"], constraints: [] },
      observed: "b".repeat(64),
      checks: [{ fingerprint: old, at: f.source.value.at, commands: ["pnpm test"] }],
    },
  });
  const page = await f.browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto(f.origin);
  await page.getByLabel("Message Abra").waitFor();
  assert.ok(
    !f.calls.some((c) => ["verification", "document", "diff", "worker-history"].includes(c.name)),
  );
  await page.goto(f.origin + "/?issue=abra-web&tab=Verification");
  await page.getByRole("heading", { name: "Lightweight scope" }).waitFor();
  await page.getByText("Stop on timeout").waitFor();
  await page.getByText("Earlier pass · content has changed").click();
  await page.getByText("pnpm test", { exact: true }).waitFor();
  await page.getByText("No independent review receipt is available.").waitFor();
  f.source.value = {
    ...f.source.value,
    work: {
      ...f.source.value.work,
      work: f.source.value.work.work.map((work) => ({ ...work, policy: "research-only" })),
    },
  };
  await f.changed();
  await page.getByRole("button", { name: "Inspect research report" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Inspect changes" }).count(), 0);
});

test("a retained screenshot loads only when its receipt is expanded", async (t) => {
  const f = await workspaceBrowserFixture();
  t.onTestFinished(f.close);
  const target = await f.browser.newPage({ viewport: { width: 640, height: 320 } });
  await target.setContent("<h1>Original browser behavior</h1>");
  const bytes = await target.screenshot();
  const data = bytes.toString("base64");
  await target.close();
  const receipt = {
    kind: "screenshot",
    request_id: "capture",
    path: "observed.png",
    description: "Rendered result",
    session_id: "ses_worker",
    issue_id: "abra-web",
    generation: 2,
    at: f.source.value.at,
    bytes: bytes.length,
    hash: "a".repeat(64),
    width: 640,
    height: 320,
  };
  f.detailOverrides.set("abra-web", {
    verification: { evidence: [receipt] },
    evidence: { receipt, data },
  });
  const page = await f.browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto(f.origin + "/?issue=abra-web&tab=Verification");
  await page.getByText("Rendered result", { exact: true }).waitFor();
  assert.ok(!f.calls.some((c) => c.name === "evidence"));
  await page.getByText("Rendered result", { exact: true }).click();
  await page.getByText("Revision unverified", { exact: true }).waitFor();
  const image = page.getByRole("img", { name: "Rendered result" });
  assert.equal(await image.getAttribute("src"), "data:image/png;base64," + data);
  await page.getByText("Select a region", { exact: true }).click();
  const rect = (await image.boundingBox())!;
  await page.mouse.move(rect.x + rect.width / 4, rect.y + rect.height / 4);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.up();
  assert.ok(Math.abs(Number(await page.getByLabel("Region x").inputValue()) - 160) <= 2);
  await page.getByLabel("Region x").fill("640");
  assert.ok(await page.getByRole("button", { name: "Ask Abra", exact: true }).isDisabled());
  await page.getByLabel("Region x").fill("160");
  await page.getByLabel("Region y").fill("80");
  await page.getByLabel("Region width").fill("320");
  await page.getByLabel("Region height").fill("160");
  await page.getByRole("button", { name: "Ask Abra", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 820 });
  await page.getByRole("button", { name: "Close inspector" }).click();
  assert.match(
    await page.locator(".selection-chip summary").innerText(),
    /Image capture.*320×160 at 160, 80/,
  );
  const selection = {
    kind: "region",
    issue_id: "abra-web",
    request_id: "capture",
    hash: receipt.hash,
    x: 160,
    y: 80,
    width: 320,
    height: 160,
  };
  const request_id = "region-history",
    message_id = SessionMessage.ID.create();
  const text = "Check this region",
    capture = { selection, excerpt: "Rendered result" };
  const native_text = text + selectionMarker + JSON.stringify({ request_id, ...capture });
  f.source.retainedReceipts.set(
    request_id,
    Schema.decodeUnknownSync(ReceiptSchema)({
      request_id,
      message_id,
      text,
      native_text,
      capture,
      at: receipt.at,
      status: "admitted",
      delivery: "queue",
    }),
  );
  f.source.value = {
    ...f.source.value,
    messages: [{ id: message_id, role: "user", text: native_text, at: receipt.at }],
  };
  await page.goto(f.origin);
  await page.getByText(/capture.*Captured selection/).click();
  const marked = page.getByLabel("Selected image region");
  const smallImage = page.getByRole("img", { name: "Rendered result" });
  await smallImage.waitFor();
  const small = (await smallImage.boundingBox())!,
    box = (await marked.boundingBox())!;
  assert.ok(small.width < rect.width);
  assert.ok(Math.abs(box.width / small.width - 0.5) < 0.005);
  assert.ok(Math.abs((box.x - small.x) / small.width - 0.25) < 0.005);
  assert.equal(await smallImage.getAttribute("src"), "data:image/png;base64," + data);
});

test("recent visits reopen unchanged and off-page tasks from legacy storage after reload", async (t) => {
  const f = await workspaceBrowserFixture();
  t.onTestFinished(f.close);
  const current = f.source.value.work.work[0];
  const previous = {
    ...current,
    issue_id: IssueId.make("old-task"),
    title: "Earlier investigation",
  };
  f.setDiscovery([current, previous]);
  const page = await f.browser.newPage({ viewport: { width: 1500, height: 900 } });
  const recent =
    f.origin + "/work?collection=" + encodeURIComponent(JSON.stringify({ section: "recent" }));
  await page.goto(recent);
  await page.getByText(/Inspect a task to start/).waitFor();
  const key = "abra-recap-v1-" + f.source.value.session_id;
  await page.evaluate(
    ({ key, id }) =>
      localStorage.setItem(key, JSON.stringify([{ issue: id, result: "old", decisions: "old" }])),
    { key, id: previous.issue_id },
  );
  await page.reload();
  const list = page.getByRole("region", { name: "Recently inspected tasks" });
  await list.getByRole("button", { name: previous.issue_id }).click();
  await page.getByRole("heading", { name: previous.title, exact: true }).waitFor();
  await page.goto(f.origin + "/?issue=" + current.issue_id);
  await page.getByRole("heading", { name: current.title, exact: true }).waitFor();
  await page.goto(recent);
  const buttons = list.getByRole("button");
  assert.deepEqual(await buttons.allTextContents(), [current.title, previous.issue_id]);
  await f.changed();
  await page.reload();
  assert.deepEqual(await buttons.allTextContents(), [current.title, previous.issue_id]);
  assert.equal(await page.getByText("Since your last inspection").count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await buttons.first().click();
  await page.getByRole("heading", { name: current.title, exact: true }).waitFor();
  assert.equal(f.source.submissions, 0);
});

test("disabled local history leaves the main conversation and attention available", async (t) => {
  const f = await workspaceBrowserFixture();
  t.onTestFinished(f.close);
  const page = await f.browser.newPage();
  await page.addInitScript(() => {
    const original = Storage.prototype.getItem.bind(localStorage);
    Storage.prototype.getItem = function (key) {
      if (key.startsWith("abra-recap-")) throw new Error("Storage offline");
      return original(key);
    };
  });
  await page.goto(f.origin);
  await page.goto(
    f.origin + "/work?collection=" + encodeURIComponent(JSON.stringify({ section: "recent" })),
  );
  await page.getByText("Local reading history is unavailable.").waitFor();
  await page.getByRole("link", { name: "Chat", exact: true }).click();
  assert.ok(await page.getByRole("link", { name: "Attention", exact: true }).isVisible());
  assert.ok(await page.getByLabel("Message Abra").isEditable());
});

test("the busy composer submits the developer's delivery choice to Abra", async (t) => {
  const f = await workspaceBrowserFixture();
  t.onTestFinished(f.close);
  f.source.value = { ...f.source.value, busy: true };
  const page = await f.browser.newPage();
  await page.goto(f.origin);
  for (const delivery of ["queue", "steer"]) {
    await page.getByLabel("Message delivery").selectOption(delivery);
    await page.getByLabel("Message Abra").fill("Delivery " + delivery);
    await page.getByRole("button", { name: "Send message" }).click();
    await page
      .locator(".message.user")
      .getByText("Delivery " + delivery, { exact: true })
      .waitFor();
    assert.equal(f.source.value.receipts.at(-1)?.delivery, delivery);
  }
  assert.equal(f.source.stops, 0);
});

test("a plan passage attaches to the existing composer and retains its exact source lines", async (t) => {
  const f = await workspaceBrowserFixture();
  t.onTestFinished(f.close);
  f.detailOverrides.set("abra-web", {
    document: { content: "Same criterion\nFirst context\nSame criterion\nSecond context" },
  });
  const page = await f.browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto(f.origin + "/?issue=abra-web&tab=Plan&file=proposal.md");
  await page.getByText("Ask about a plan passage").click();
  await page.getByLabel("First plan line").fill("3");
  await page.getByLabel("Last plan line").fill("4");
  await page.getByRole("button", { name: "Ask Abra", exact: true }).click();
  await page.waitForFunction(
    () => document.activeElement?.getAttribute("aria-label") === "Message Abra",
  );
  await page.getByLabel("Message Abra").fill("Which criterion?");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByText("Ask about a plan passage").click();
  await page.getByLabel("First plan line").fill("2");
  await page.getByLabel("Last plan line").fill("3");
  await page.getByRole("button", { name: "Ask Abra", exact: true }).press("Enter");
  await page.waitForFunction(
    () => document.activeElement?.getAttribute("aria-label") === "Message Abra",
  );
  assert.equal(await page.getByLabel("Message Abra").inputValue(), "Which criterion?");
  await page.reload();
  await page.locator(".selection-chip summary").click();
  assert.equal(
    await page.locator(".selection-chip pre").innerText(),
    "First context\nSame criterion",
  );
  assert.equal(f.replies.length, 0);
});

test("matching checks and independent review are reported separately for a pending decision", async (t) => {
  const f = await workspaceBrowserFixture();
  t.onTestFinished(f.close);
  const task = f.source.value.work.work[0];
  const formID = Form.ID.make("frm_verification_decision");
  f.source.value = {
    ...f.source.value,
    forms: [
      {
        binding: "verification-decision",
        active: true,
        checkpoint: { active: true, kind: "decision", issue_id: task.issue_id },
        form: {
          id: formID,
          sessionID: f.source.sessionID,
          title: "Confirm the requested behavior",
          fields: [{ key: "answer", title: "Decision answer", type: "string", required: true }],
        },
      },
    ],
  };
  const fingerprint = "a".repeat(64);
  f.detailOverrides.set(task.issue_id, {
    verification: {
      observed: fingerprint,
      checks: [{ at: f.source.value.at, fingerprint, commands: ["pnpm check"] }],
      review: {
        passed: false,
        fingerprint: "b".repeat(64),
        session_id: "ses_independent",
        findings: "A review finding remains.",
      },
    },
  });
  const page = await f.browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(f.origin + "/?issue=" + task.issue_id + "&tab=Verification");
  await page.getByText("Checks passed on the observed content.").waitFor();
  await page
    .getByText("Findings reported by ses_independent · current revision unconfirmed")
    .waitFor();
  await page.getByText("Review evidence", { exact: true }).click();
  await page.getByText("A review finding remains.").waitFor();
  await page.getByRole("button", { name: "Answer current decision" }).click();
  await page.locator(`[data-native-form-id="${formID}"]:focus`).waitFor();
  await page.getByLabel("Decision answer").fill("Retain the earlier behavior");
  assert.equal(f.replies.length, 0);
  assert.equal(f.source.submissions, 0);
});

test("canvas refresh reads each visible section once and Retry recovers only its failed read", async (t) => {
  const f = await workspaceBrowserFixture();
  t.onTestFinished(f.close);
  const page = await f.browser.newPage({ viewport: { width: 1500, height: 900 } });
  const reads: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.pathname.startsWith("/api/work/"))
      reads.push(url.pathname.slice(10) + "/" + url.searchParams.get("issue_id"));
  });
  await page.goto(f.origin + "/?issue=abra-web&tab=Overview");
  await page.getByText("No retained decisions.", { exact: true }).waitFor();
  await page.getByText("Details for Build a single workspace", { exact: true }).waitFor();
  reads.length = 0;
  f.failedReads.add("decisions");
  await page.getByRole("button", { name: "Refresh canvas" }).click();
  const failure = page.locator(".inspector").getByRole("alert");
  await failure.getByText("Showing the last successful observation.").waitFor();
  assert.deepEqual(reads.toSorted(), ["decisions/abra-web", "overview/abra-web"]);
  reads.length = 0;
  f.failedReads.delete("decisions");
  await failure.getByRole("button", { name: "Retry" }).click();
  await failure.waitFor({ state: "hidden" });
  assert.deepEqual(reads, ["decisions/abra-web"]);
  assert.equal(f.source.submissions, 0);
});

test("a deliberate reader split follows open tabs and tasks through reload and phone layout", async (t) => {
  const f = await workspaceBrowserFixture();
  t.onTestFinished(f.close);
  const context = await f.browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const peer = await context.newPage();
  const fresh = await f.browser.newPage({ viewport: { width: 1440, height: 900 } });
  await Promise.all(
    [page, peer, fresh].map((p, i) =>
      p.goto(f.origin + "/?issue=abra-web&tab=" + ["Plan", "Diff", "Verification"][i]),
    ),
  );
  const handle = (p: typeof page) => p.getByRole("separator", { name: "Chat width" });
  await handle(page).waitFor();
  await handle(peer).waitFor();
  const box = (await handle(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 90, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.waitForFunction(() => Number(localStorage.getItem("abra-reader-percent")) >= 30);
  const saved = await page.evaluate(() => Number(localStorage.getItem("abra-reader-percent")));
  assert.notEqual(saved, 58);
  await peer.waitForFunction(
    (expected) =>
      Math.abs(
        Number(document.querySelector('[aria-label="Chat width"]')?.getAttribute("aria-valuenow")) -
          (100 - expected),
      ) <= 1,
    saved,
  );
  await peer.reload();
  await handle(peer).waitFor();
  assert.equal(await fresh.evaluate(() => localStorage.getItem("abra-reader-percent")), null);
  await page.setViewportSize({ width: 390, height: 844 });
  await handle(page).waitFor({ state: "hidden" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await handle(page).waitFor();
  assert.equal(
    await page.evaluate(() => Number(localStorage.getItem("abra-reader-percent"))),
    saved,
  );
  await fresh.evaluate(() => localStorage.setItem("abra-reader-percent", "broken"));
  await fresh.reload();
  await handle(fresh).waitFor();
  assert.equal(Number(await handle(fresh).getAttribute("aria-valuenow")), 42);
  await fresh.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new Error("blocked");
    };
  });
  await handle(fresh).press("ArrowLeft");
  assert.ok(Number(await handle(fresh).getAttribute("aria-valuenow")) < 61);
});

test("a briefing source opens its bound form and offers the next decision when the binding changes", async (t) => {
  const f = await workspaceBrowserFixture();
  t.onTestFinished(f.close);
  const work = f.source.value.work.work[0];
  const form = (key: string): (typeof f.source.value.forms)[number] => ({
    active: true,
    binding: key,
    checkpoint: { active: true, issue_id: work.issue_id, kind: "merge" as const, fingerprint: key },
    form: {
      id: Form.ID.make("frm_" + key),
      sessionID: f.source.sessionID,
      title: "Approve " + key,
      fields: [{ type: "boolean" as const, key: "authorize", title: "Authorize" }],
    },
  });
  const first = form("first"),
    next = form("next");
  f.source.value = {
    ...f.source.value,
    forms: [first, next],
    messages: [
      {
        id: SessionMessage.ID.make("msg_brief"),
        role: "assistant",
        at: f.source.value.at,
        text: "Review this merge.",
        tools: [
          {
            id: "brief",
            name: "abra_work_briefing",
            status: "completed",
            presentation: {
              kind: "briefing",
              links: [
                {
                  title: work.title,
                  label: "Merge approval",
                  target: { action: "open_task", issue_id: work.issue_id, section: "verification" },
                  form_id: first.form.id,
                  fingerprint: first.binding,
                },
              ],
            },
          },
        ],
        parts: [{ type: "tool", tool_id: "brief" }],
      },
    ],
  };
  const page = await f.browser.newPage();
  await page.goto(f.origin);
  await page.getByText("Briefing sources (1)").click();
  await page.getByRole("link", { name: "Open decision", exact: true }).click();
  await page.locator('[data-native-form-id="frm_first"]:focus').waitFor();
  assert.equal(f.replies.length, 0);
  f.source.value = { ...f.source.value, forms: [next] };
  await f.changed();
  await page.getByRole("link", { name: "Open next decision" }).click();
  await page.locator('[data-native-form-id="frm_next"]:focus').waitFor();
  assert.equal(f.replies.length, 0);
  await page.getByRole("link", { name: "Chat", exact: true }).click();
  await page.getByText(/This form is no longer current/).waitFor();
  assert.equal(await page.getByRole("link", { name: "Open decision", exact: true }).count(), 0);
});
