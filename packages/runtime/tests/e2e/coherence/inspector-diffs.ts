import { chooseAppearance } from "../../helpers/workspace-browser.ts";
import { feedbackFixture } from "../../helpers/review-evidence.ts";
import assert from "node:assert/strict";
import { Schema } from "effect";
import { TranscriptMessageSchema } from "@abracode/contracts/web/workspace-wire";
import { WorkItemSchema } from "@abracode/contracts/web/wire";
import { IssueId, ContentHash, SpecSchemaName } from "@abracode/contracts/identities";
import { test, fixture, screenshot } from "../../helpers/coherence-browser.ts";
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
  await page
    .locator('[data-diff-renderer="pierre"]')
    .getByText("newValue", { exact: false })
    .first()
    .waitFor();
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
  await page
    .getByRole("tablist", { name: "Work details", exact: true })
    .getByRole("tab", { name: "Plan", exact: true })
    .click();
  await page.getByRole("button", { name: "proposal.md", exact: true }).click();
  await page.getByRole("heading", { name: "Retained proposal", exact: true }).waitFor();
  await page.goBack();
  await page.getByRole("button", { name: "proposal.md", exact: true }).waitFor();
  await page.goBack();
  await page.locator('[data-diff-renderer="pierre"]').waitFor();
  assert.match(page.url(), /file=second.ts/);
  await chooseAppearance(page, "dark");
  await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
  await screenshot(page, "frontend-coherence-desktop-dark.png");
  await page.setViewportSize({ width: 761, height: 844 });
  await page.getByRole("dialog", { name: /Work inspector/ }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .locator('.phone-navigation a[aria-current="page"]')
    .filter({ hasText: "Chat" })
    .waitFor();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
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
  await page.getByRole("link", { name: "Chat", exact: true }).click();
  await page.goBack();
  await page.waitForURL(/file=second.ts/);
  await page.getByRole("link", { name: "Work", exact: true }).click();
  await page.getByRole("region", { name: "Work finder" }).waitFor();
  await page.getByRole("link", { name: "Chat", exact: true }).click();
  await page.getByRole("log").waitFor();
  // Native snapshot fallback must not cause a second browser bootstrap polling loop.
  await page.waitForTimeout(5500);
  assert.equal(bootstrapReads, 1);
  assert.equal(f.source.submissions, 0);
  assert.equal(f.source.stops, 0);
  assert.deepEqual(errors, []);
});

test("a finding from chat opens its exact file, survives Back and reload, and attaches lines for one explicit send", async (t) => {
  const f = await fixture();
  t.onTestFinished(f.close);
  const page = await f.browser.newPage({ viewport: { width: 390, height: 844 } });
  const issue = f.source.value.work.work[0].issue_id;
  const feedback = feedbackFixture(false);
  const finding = {
    ...feedback.findings[0],
    head: "f".repeat(40),
    original_head: "f".repeat(40),
    path: "source.ts",
  };
  f.feedbackPages.set(0, { ...feedback, issue_id: issue, findings: [finding] });
  f.source.value = {
    ...f.source.value,
    messages: [
      Schema.decodeSync(TranscriptMessageSchema)({
        id: "msg_evidence",
        at: f.source.value.at,
        role: "assistant",
        text: "",
        tools: [
          {
            id: "call_evidence",
            name: "abra_work_feedback_status",
            status: "completed",
            presentation: {
              kind: "findings",
              issue_id: issue,
              findings: [
                { ...finding, id: "info", blocking: false, text: "A second observation" },
                finding,
              ],
              total: 4,
              limited: false,
            },
          },
        ],
        parts: [{ type: "tool", tool_id: "call_evidence" }],
      }),
    ],
  };
  await page.goto(f.origin);
  const draft = page.getByRole("textbox", { name: "Message Abra" });
  await draft.fill("Explain this change");
  const result = page.locator('[data-tool-call-id="call_evidence"]');
  await result.getByText("Showing 2 of 4 findings.").waitFor();
  assert.equal(await result.locator('[data-presentation="finding"]').count(), 1);
  await result.getByText("1 more finding").click();
  await result.getByText("A second observation").waitFor();
  await result.getByText("1 more finding").click();
  await page.getByRole("button", { name: "Inspect finding" }).click();
  const canvas = page.getByLabel("Work inspector", { exact: true });
  await canvas.getByRole("button", { name: "Open source.ts in diff" }).click();
  await canvas.getByRole("region", { name: "source.ts", exact: true }).waitFor();
  await page.goBack();
  await page.reload();
  await canvas.getByRole("heading", { name: "Finding · " + finding.id }).waitFor();
  await canvas.getByRole("button", { name: "Open source.ts in diff" }).waitFor();
  assert.equal(f.source.submissions, 0);
  await canvas.getByRole("button", { name: "Open source.ts in diff" }).click();
  const file = canvas.getByRole("region", { name: "source.ts", exact: true });
  await file.getByText("Select lines in source.ts").click();
  await file.getByLabel("First line").fill("1");
  await file.getByRole("button", { name: "Ask Abra", exact: true }).click();
  await page.waitForFunction(
    () => document.activeElement?.getAttribute("aria-label") === "Message Abra",
  );
  assert.equal(await draft.inputValue(), "Explain this change");
  const historyLength = await page.evaluate(() => history.length);
  await draft.press("Control+k");
  const palette = page.getByLabel("Search work and commands");
  await palette.fill("diff");
  await palette.press("Escape");
  await page.waitForFunction(
    () => document.activeElement?.getAttribute("aria-label") === "Message Abra",
  );
  assert.equal(await page.evaluate(() => history.length), historyLength);
  await draft.press("Control+k");
  await page.getByRole("option", { name: /Resume last inspection/ }).click();
  await file.waitFor();
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("option", { name: "Return to chat" }).click();
  await page.waitForFunction(
    () => document.activeElement?.getAttribute("aria-label") === "Message Abra",
  );
  await page.getByRole("link", { name: "More", exact: true }).click();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("link", { name: "Chat", exact: true }).click();
  await page.locator(".selection-chip summary").click();
  assert.match(await page.locator(".selection-chip pre").innerText(), /newValue/);
  assert.equal(f.source.submissions, 0);
  f.backend.submit = ({ selection, ...input }) => {
    const receiptInput = {
      ...input,
      capture: { selection, excerpt: "export const newValue = 2;" },
    };
    return f.source.submit(receiptInput);
  };
  await page.getByRole("button", { name: "Send message" }).click();
  await page.waitForFunction(() => !document.querySelector(".selection-chip"));
  assert.equal(f.source.value.receipts.at(-1)?.capture?.selection.kind, "diff");
  assert.equal(f.source.submissions, 1);
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
  await page.goto(`${f.origin}/?issue=abra-slow&tab=Plan`);
  await request;
  await page.getByRole("link", { name: "Work", exact: true }).click();
  await page.route("**/api/work/resolve", (route) => route.abort(), { times: 1 });
  await page.getByRole("button", { name: /Another issue/ }).click();
  const failure = page
    .locator("[data-sonner-toast]")
    .filter({ hasText: "Couldn’t open this work item" });
  await failure.getByRole("button", { name: "Retry" }).click();
  await page.waitForURL((url) => url.searchParams.get("issue") === "abra-web");
  await page
    .getByRole("tablist", { name: "Work details", exact: true })
    .getByRole("tab", { name: "Overview", exact: true })
    .click();
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
    f.calls.filter((call) => call.name === "overview" && call.input.issue_id === "abra-web")
      .length >= 2,
  );
  assert.equal(f.source.submissions, 0);
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
  await page
    .getByRole("tablist", { name: "Work details", exact: true })
    .getByRole("tab", { name: "Overview", exact: true })
    .click();
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
  await page
    .getByRole("tablist", { name: "Work details", exact: true })
    .getByRole("tab", { name: "Reports", exact: true })
    .click();
  await page.getByRole("heading", { name: "Retained report", exact: true }).waitFor();
  assert.equal(f.source.submissions, 0);
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
  await page.goto(f.origin);
  const composer = page.getByRole("textbox", { name: "Message Abra", exact: true });
  await composer.fill("Keep this draft while inspection is unavailable");
  await page.goto(`${f.origin}/?issue=abra-web&tab=Overview`, { waitUntil: "domcontentloaded" });
  await page.getByRole("status").filter({ hasText: "Loading work inspection" }).waitFor();
  release();
  await page.getByRole("alert").filter({ hasText: "Work inspection could not load" }).waitFor();
  assert.equal(await composer.count(), 0);
  assert.equal(f.source.submissions, 0);
  await screenshot(page, "deferred-inspector-error-375.png");
  await page.unroute("**/assets/inspector-*.js");
  await page.getByRole("button", { name: "Reload to retry", exact: true }).click();
  await page.getByText("Details for Build a single workspace", { exact: true }).waitFor();
  await page.setViewportSize({ width: 1440, height: 900 });
  assert.equal(await composer.inputValue(), "Keep this draft while inspection is unavailable");
  await screenshot(page, "deferred-inspector-recovered-desktop.png");
  await page.route("**/assets/work-finder-*.js", (route) => route.abort("failed"));
  await page.getByRole("link", { name: "Work", exact: true }).click();
  const finderError = page.getByRole("alert").filter({ hasText: "Work finder could not load" });
  await finderError.waitFor();
  await page.getByRole("link", { name: "Chat", exact: true }).click();
  await finderError.waitFor({ state: "hidden" });
  assert.equal(await composer.inputValue(), "Keep this draft while inspection is unavailable");
  assert.equal(f.source.submissions, 0);
});
