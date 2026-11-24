/* oxlint-disable effecttsgo/unstable-api-usage -- Shipped browser, real review storage and native admission boundary fixture. */
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { workspaceBrowserFixture } from "../helpers/workspace-browser.ts";
import { reviewDefinition, previewPNG } from "../helpers/interactive-reviews.ts";
import { MemoryStore, TestLocks } from "../fixtures.ts";
import { Reviews } from "../../src/web/reviews.ts";
import { WebAdmissions } from "../../src/web/gateway.ts";
import { AbsolutePath, MessageId, RelativePath } from "@abracode/contracts/identities";

test("interactive A2UI review shares drafts, enlarges designs, restores feedback and links a real published revision", async (t) => {
  const fixture = await workspaceBrowserFixture();
  t.onTestFinished(() => fixture.close());
  const root = AbsolutePath.make(await mkdtemp(join(tmpdir(), "abra-review-browser-")));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "design.png"), previewPNG);
  const store = new MemoryStore(),
    locks = new TestLocks();
  const owner = new Reviews(store, locks, () => Effect.succeed({ text: "Plan", root }));
  const admissions = new WebAdmissions(
    store,
    {
      prompt: (session, text, id) =>
        fixture.source.submit({ request_id: id, text, delivery: "queue" }).pipe(Effect.asVoid),
      promptAdmission: () => Effect.succeed("consumed" as const),
    },
    locks,
  );
  fixture.source.reviews = {
    list: (issue) => owner.list(fixture.source.sessionID, issue),
    read: (selection) => owner.read(fixture.source.sessionID, selection),
    asset: (selection) => owner.asset(fixture.source.sessionID, selection),
    submit: (input) => owner.submit(fixture.source.sessionID, input, admissions),
    receipt: (input) => owner.receipt(fixture.source.sessionID, input, admissions),
  };
  const review = {
    ...reviewDefinition(),
    fields: [
      ...reviewDefinition().fields,
      {
        component: "DesignChoiceGroup" as const,
        id: "design",
        label: "Visual design",
        required: true,
        options: [
          { value: "a", label: "Design A", preview: "first" },
          { value: "b", label: "Design B", preview: "second" },
        ],
      },
    ],
  };
  const previews = [
    { id: "first", path: RelativePath.make("design.png") },
    { id: "second", path: RelativePath.make("design.png") },
  ];
  const message = MessageId.make("msg_review_browser");
  const reference = await Effect.runPromise(
    owner.publish(fixture.source.sessionID, message, "publish", { review, previews }),
  );
  fixture.source.value = {
    ...fixture.source.value,
    messages: [
      {
        id: message,
        role: "assistant",
        text: "Choose how this plan should change.",
        at: fixture.source.value.at,
      },
    ],
    presentations: await Effect.runPromise(
      owner.presentations(fixture.source.sessionID, [message]),
    ),
  };
  const page = await fixture.browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const direct = await page.request.get(
    `${fixture.origin}/api/review?review_id=${reference.review_id}&revision=${reference.revision}`,
  );
  assert.equal(direct.status(), 200, await direct.text());
  await page.goto(fixture.origin);
  const inline = () => page.locator(`[data-native-message-id="${message}"] .interactive-review`);
  try {
    await inline()
      .getByRole("button", { name: "Send feedback to Abra", exact: true })
      .waitFor({ timeout: 10000 });
  } catch (error) {
    console.log(
      JSON.stringify({
        body: await page.locator("body").innerText(),
        errors,
        bootstrap: await (await page.request.get(fixture.origin + "/api/bootstrap")).json(),
      }),
    );
    await page.screenshot({ path: "/tmp/abra-interactive-review-failure.png" });
    throw error;
  }
  await inline().getByRole("button", { name: "Send feedback to Abra", exact: true }).click();
  await inline().getByRole("alert").first().waitFor();
  assert.equal(fixture.source.submissions, 0);
  await inline().getByRole("radio", { name: "Simple", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(
    await inline().getByRole("radio", { name: "Complete", exact: true }).isChecked(),
    true,
  );
  await page.keyboard.press("ArrowLeft");
  assert.equal(
    await inline().getByRole("radio", { name: "Simple", exact: true }).isChecked(),
    true,
  );
  await inline().getByRole("checkbox", { name: "Email login", exact: true }).check();
  await inline().getByRole("checkbox", { name: "Password reset", exact: true }).check();
  await inline().getByRole("button", { name: "Select Design B", exact: true }).click();
  await inline()
    .getByRole("textbox", { name: "Comments", exact: true })
    .fill("Use B with A's navigation.");
  const second = await page.context().newPage();
  await second.goto(fixture.origin);
  const secondComments = second
    .locator(`[data-native-message-id="${message}"] .interactive-review`)
    .getByRole("textbox", { name: "Comments", exact: true });
  assert.equal(await secondComments.inputValue(), "Use B with A's navigation.");
  await secondComments.fill("Use B with A's navigation. Keep it simple.");
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll("textarea")).some(
      (el) => el.value === "Use B with A's navigation. Keep it simple.",
    ),
  );
  await second.close();
  await inline().getByRole("button", { name: "Enlarge Design B", exact: true }).click();
  await page.getByRole("dialog").getByRole("img", { name: "Design B", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.waitForFunction(
    () => document.activeElement?.textContent?.includes("Enlarge Design B"),
    {},
    { timeout: 5000 },
  );
  const evidence = process.env.ABRACODE_TEST_EVIDENCE_DIR;
  if (evidence) {
    await mkdir(evidence, { recursive: true });
    await inline()
      .getByRole("heading", { name: review.title, exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(evidence, "interactive-review-desktop.png") });
  }
  await page.goto(`${fixture.origin}/?issue=abra-web&tab=Plan&file=proposal.md`);
  await page
    .locator(".inspector")
    .getByText("Give feedback: Choose the first release", { exact: true })
    .click();
  const inspected = page.locator(".inspector .interactive-review");
  const inlineComments = inline().getByRole("textbox", { name: "Comments", exact: true });
  const inspectedComments = inspected.getByRole("textbox", { name: "Comments", exact: true });
  await inspectedComments.fill("Shared inspection edit");
  assert.equal(await inlineComments.inputValue(), "Shared inspection edit");
  await inspectedComments.fill("Use B with A's navigation. Keep it simple.");
  assert.equal(
    await inspected.getByRole("textbox", { name: "Comments", exact: true }).inputValue(),
    "Use B with A's navigation. Keep it simple.",
  );
  await page.goto(fixture.origin);
  await inline().getByRole("textbox", { name: "Comments", exact: true }).waitFor();
  assert.equal(
    await inline().getByRole("textbox", { name: "Comments", exact: true }).inputValue(),
    "Use B with A's navigation. Keep it simple.",
  );
  await page.setViewportSize({ width: 375, height: 900 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  if (evidence) {
    await inline().getByRole("radio", { name: "Design B", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(evidence, "interactive-review-narrow.png") });
  }
  // Mounting the pending response can query its receipt before the submit response is lost.
  let conflicting = 0;
  await page.route("**/api/review/receipt?**", async (route) => {
    const response = await route.fetch();
    const receipt = await response.json();
    if (!receipt) return route.fulfill({ response });
    conflicting++;
    await route.fulfill({ response, json: { ...receipt, request_id: "other-feedback" } });
  });
  await page.route("**/api/review/submit", async (route) => {
    await route.fetch();
    await route.abort();
  });
  await inline().getByRole("button", { name: "Send feedback to Abra", exact: true }).click();
  await inline().getByRole("alert").waitFor();
  assert.equal(fixture.source.submissions, 1);
  await page.unroute("**/api/review/submit");
  await Promise.all([
    page.waitForResponse((response) => response.url().includes("/api/review/receipt")),
    page.reload(),
  ]);
  await inline()
    .getByRole("button", { name: /Reconcile/ })
    .waitFor();
  assert.ok(conflicting > 0);
  assert.equal(fixture.source.submissions, 1);
  await page.unroute("**/api/review/receipt?**");
  await page.reload();
  await inline()
    .getByText("Received by Abra. A revision will appear when published.", { exact: true })
    .waitFor();
  assert.equal(fixture.source.submissions, 1);
  const receipt = await Effect.runPromise(
    admissions.receipt(
      fixture.source.sessionID,
      [...store.values.keys()]
        .find((k) => k.includes("/response/"))!
        .split("/")
        .at(-1)!,
    ),
  );
  assert.ok(receipt);
  const next = await Effect.runPromise(
    owner.publish(fixture.source.sessionID, MessageId.make("msg_review_revised"), "revise", {
      review: { ...review, title: "Revised first release", responds_to: receipt.request_id },
      previews,
    }),
  );
  await fixture.changed();
  await inline()
    .getByRole("button", { name: "Open revision: Revised first release", exact: true })
    .click();
  await page.getByRole("heading", { name: "Revised first release", exact: true }).waitFor();
  assert.equal(next.revision, reference.revision + 1);
  assert.equal(
    await page
      .locator(`[data-review-reference="${next.review_id}/${next.revision}"]`)
      .getByRole("textbox", { name: "Comments", exact: true })
      .inputValue(),
    "",
  );
  assert.equal(fixture.source.submissions, 1);
  assert.deepEqual(errors, []);
});
