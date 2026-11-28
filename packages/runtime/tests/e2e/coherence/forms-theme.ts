import { chooseAppearance } from "../../helpers/workspace-browser.ts";
import { reviewDefinition } from "../../helpers/interactive-reviews.ts";
import { feedbackFixture } from "../../helpers/review-evidence.ts";
import assert from "node:assert/strict";
import { Effect } from "effect";
import { Permission } from "@opencode/schema/permission";
import { Form } from "@opencode/schema/form";
import type { AttentionForm } from "../../../src/web/contracts.ts";
import { test, fixture, screenshot } from "../../helpers/coherence-browser.ts";
test("reopening a review reconciles the exact draft edited while all local views were closed", async (t) => {
  const f = await fixture();
  t.onTestFinished(f.close);
  const page = await f.browser.newPage();
  const context = page.context();
  const peer = await context.newPage();
  const review = reviewDefinition();
  const reference = { ...review, revision: 1, hash: "a".repeat(64) };
  const record = {
    review,
    revision: 1,
    hash: reference.hash,
    session_id: f.source.sessionID,
    message_id: "msg_review",
    at: f.source.value.at,
    schema_version: 1,
    assets: [],
    source_text: "Plan",
    call_id: "publish",
  };
  await context.route("**/api/reviews?*", (route) =>
    route.fulfill({ json: { reviews: [reference], diagnostics: [] } }),
  );
  await context.route("**/api/review?*", (route) =>
    route.fulfill({ json: { record, current_revision: 1, revisions: [] } }),
  );
  const summary = (p: typeof page) =>
    p.getByText("Give feedback: Choose the first release", { exact: true });
  const comments = (p: typeof page) => p.getByRole("textbox", { name: "Comments", exact: true });
  for (const p of [page, peer]) {
    await p.goto(f.origin + "/?issue=abra-web&tab=Plan&file=proposal.md");
    await summary(p).click();
    await comments(p).waitFor();
  }
  await comments(page).fill("First answer");
  await summary(page).click();
  await comments(page).waitFor({ state: "detached" });
  await comments(peer).fill("Changed in the other tab");
  await summary(page).click();
  assert.equal(await comments(page).inputValue(), "Changed in the other tab");
  const key = `abra-review-${record.session_id}-${review.review_id}-1-${record.hash}`;
  const pending = {
    review_id: review.review_id,
    revision: 1,
    hash: record.hash,
    request_id: "review-original",
    answers: { comments: "Submitted elsewhere" },
  };
  const receipt = {
    ...pending,
    message_id: "msg_feedback",
    text: "Feedback",
    delivery: "queue",
    status: "admitted",
    at: record.at,
  };
  const close = async () => {
    await summary(page).click();
    await comments(page).waitFor({ state: "detached" });
  };
  await close();
  await peer.evaluate(
    ({ key, pending }) =>
      localStorage.setItem(
        key,
        JSON.stringify({ answers: {}, pending: { ...pending, revision: 2 } }),
      ),
    { key, pending },
  );
  await summary(page).click();
  assert.equal(await comments(page).inputValue(), "Changed in the other tab");
  const requests: string[] = [];
  await context.route("**/api/review/receipt?*", (route) => {
    requests.push(new URL(route.request().url()).searchParams.get("request_id")!);
    return route.fulfill({ json: receipt });
  });
  await close();
  await peer.evaluate(
    ({ key, pending }) =>
      localStorage.setItem(key, JSON.stringify({ answers: pending.answers, pending })),
    { key, pending },
  );
  await summary(page).click();
  const received = page.getByText(/Received by Abra/);
  await received.waitFor();
  assert.deepEqual(requests, [pending.request_id]);
  await close();
  await summary(page).click();
  await received.waitFor();
  assert.deepEqual(requests, [pending.request_id]);
  await page.getByRole("button", { name: "Write another response" }).click();
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new Error("storage unavailable");
    };
  });
  await comments(page).fill("Unsaved local answer");
  await close();
  await summary(page).click();
  assert.equal(await comments(page).inputValue(), "Unsaved local answer");
  await close();
  await peer.evaluate(
    ({ key, receipt }) => localStorage.setItem(key, JSON.stringify({ answers: {}, receipt })),
    { key, receipt },
  );
  await summary(page).click();
  await received.waitFor();
  assert.equal(await comments(page).inputValue(), "Unsaved local answer");
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
  await chooseAppearance(page, "system");
  await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
  assert.equal(await draft.inputValue(), "Keep theme edits");
  await page.getByRole("link", { name: "Work", exact: true }).click();
  const dialog = page.getByRole("region", { name: "Work finder" });
  await dialog.waitFor();
  await dialog.getByRole("link", { name: "Capacity", exact: true }).click();
  const capacity = dialog.getByRole("region", { name: "Capacity" });
  await capacity.getByText("0 / 2", { exact: true }).waitFor();
  await capacity.getByText("1 / 4", { exact: true }).waitFor();
  await dialog.getByRole("combobox", { name: "Project", exact: true }).selectOption({ index: 1 });
  await capacity.getByText("0 / 1", { exact: true }).waitFor();
  assert.equal(
    await dialog.evaluate((element) => getComputedStyle(element).fontFamily),
    await page.locator("body").evaluate((element) => getComputedStyle(element).fontFamily),
  );
  await page.getByRole("link", { name: "Chat", exact: true }).click();
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
  await chooseAppearance(unavailable, "light");
  await unavailable.waitForFunction(() => document.documentElement.dataset.theme === "light");
  assert.equal(
    await unavailable.getByRole("textbox", { name: "Message Abra" }).inputValue(),
    "Mounted without storage",
  );
});

test("one theme button switches and remembers the palette across workspace layouts", async (t) => {
  const f = await fixture();
  t.onTestFinished(f.close);
  const page = await f.browser.newPage({ colorScheme: "light" });
  await page.goto(f.origin);
  const draft = page.getByRole("textbox", { name: "Message Abra" });
  await draft.fill("Keep my place");
  for (const [width, next] of [
    [1440, "dark"],
    [900, "light"],
    [390, "dark"],
  ] as const) {
    await page.setViewportSize({ width, height: 844 });
    const toggle = page.getByRole("button", { name: `Switch to ${next} theme`, exact: true });
    await toggle.click();
    await page.waitForFunction((theme) => document.documentElement.dataset.theme === theme, next);
    assert.equal(
      await page.getByRole("button", { name: /Switch to (light|dark) theme/ }).count(),
      1,
    );
    assert.equal(await draft.inputValue(), "Keep my place");
  }
  await page.reload();
  await page.getByRole("button", { name: "Switch to light theme", exact: true }).press("Enter");
  await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
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
  await page.getByRole("button", { name: "Review next" }).click();
  const text = page.getByRole("textbox", { name: "Additional choices, one per line" });
  await text.pressSequentially("alpha\nbeta");
  assert.equal(await text.inputValue(), "alpha\nbeta");
  await text.fill("alpha\n\nbeta\nalpha");
  await text.press("Home");
  await text.pressSequentially("middle ");
  const raw = await text.inputValue();
  assert.equal(raw, "alpha\n\nbeta\nmiddle alpha");
  await f.changed();
  await page.getByRole("link", { name: "Attention", exact: true }).click();
  await page.getByRole("link", { name: "Attention", exact: true }).click();
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
      await page.getByRole("button", { name: "Review next" }).click();
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
  await page.getByRole("button", { name: "Review next" }).click();
  await page.getByLabel(/^When/).fill("2026-03-29T02:30");
  await page.getByRole("button", { name: "Submit answer", exact: true }).click();
  await page.getByText(/this time may not exist/).waitFor();
  assert.equal(f.replies.length, 0);
  assert.equal(await page.getByText("Answer submitted", { exact: true }).count(), 0);
  assert.equal(await page.getByLabel("Date", { exact: true }).inputValue(), "2026-03-29");
  await page.getByLabel(/^When/).fill("2026-03-29T03:30");
  await page.getByRole("button", { name: "Submit answer", exact: true }).click();
  await page.getByLabel(/^When/).waitFor({ state: "hidden" });
  await page.getByText("Answer submitted", { exact: true }).waitFor();
  assert.deepEqual(f.replies[0].answer, { when: "2026-03-29T01:30:00.000Z", date: "2026-03-29" });
});

test("owned typography survives vendor reset in workspace and inspector", async (t) => {
  const f = await fixture();
  t.onTestFinished(f.close);
  const page = await f.browser.newPage();
  await page.goto(f.origin);
  await page.locator(".topbar h1").waitFor();
  assert.deepEqual(
    await page.locator(".topbar h1").evaluate((element) => {
      const style = getComputedStyle(element);
      return { size: style.fontSize, weight: style.fontWeight };
    }),
    { size: "14px", weight: "600" },
  );
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
    permissions: [
      {
        binding: "review-permission",
        request: {
          id: Permission.ID.create(),
          sessionID: f.source.sessionID,
          action: "Read fixture",
          resources: ["fixture"],
        },
      },
    ],
    forms: [form("frm_slow", "first", "old"), form("frm_fast", "fast", "fast")],
  };
  const page = await f.browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(f.origin);
  await page.getByRole("button", { name: "Review next" }).click();
  await page.getByLabel("Name frm_slow").fill("unsaved");
  const attention = page.getByRole("link", { name: "Chat", exact: true });
  await attention.press("Enter");
  await page.getByRole("button", { name: "Review next" }).press("Enter");
  assert.equal(await page.getByLabel("Name frm_slow").inputValue(), "unsaved");
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
  await page.getByRole("link", { name: "Chat", exact: true }).press("Enter");
  await page.getByRole("button", { name: "Review next" }).press("Enter");
  await page.waitForFunction(() => document.activeElement?.hasAttribute("data-native-permission"));
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  await page.getByText("Permission denied", { exact: true }).waitFor();
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
  const page = await f.browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route("**/api/abra/submit", (route) => route.abort());
  await page.goto(f.origin);
  await page.getByRole("textbox", { name: "Message Abra" }).fill("Keep this exact submission");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.getByRole("button", { name: "Reconcile submission" }).waitFor();
  const before = await page.evaluate(() => localStorage.getItem("abra-pending-ses_webfixture"));
  assert.ok(before);
  await page.getByRole("link", { name: "More", exact: true }).click();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("heading", { name: "Agents" }).waitFor();
  await page.getByRole("link", { name: "Chat", exact: true }).click();
  await page.getByRole("button", { name: "Reconcile submission" }).waitFor();
  await page.reload();
  await page.getByRole("button", { name: "Reconcile submission" }).waitFor();
  assert.equal(f.source.submissions, 0);
  assert.equal(
    await page.evaluate(() => localStorage.getItem("abra-pending-ses_webfixture")),
    before,
  );
  await page.unroute("**/api/abra/submit");
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
