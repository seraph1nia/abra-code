import { FixtureViewSchema } from "../../helpers/web.ts";
import { chooseAppearance } from "../../helpers/workspace-browser.ts";
import assert from "node:assert/strict";
import { Effect, Schema } from "effect";
import { IssueId, Timestamp, RepositoryId } from "@abracode/contracts/identities";
import { fleetCounts } from "../../../src/visibility/fleet.ts";
import { test, fixture, screenshot } from "../../helpers/coherence-browser.ts";
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
  await page.getByRole("tablist", { name: "Work details", exact: true }).waitFor();
  assert.deepEqual(
    await page
      .getByRole("tablist", { name: "Work details", exact: true })
      .getByRole("tab")
      .allTextContents(),
    ["Overview", "Plan", "Diff", "Verification", "Activity", "Reports"],
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
  f.source.value = Schema.decodeSync(FixtureViewSchema)({
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
  await page.getByRole("link", { name: "Attention", exact: true }).click();
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
  assert.equal(f.calls.filter((c) => c.name === "detail").length, 0);
  f.failedReads.add("overview");
  await f.changed();
  await page.getByRole("alert").filter({ hasText: "Request could not be confirmed" }).waitFor();
  await page.getByText("Showing the last successful observation.", { exact: true }).waitFor();
  await page.getByText("Details for Updated off-page task", { exact: true }).waitFor();
  f.failedReads.delete("overview");
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
  const infoRequests: string[] = [];
  page.on("request", (req) => {
    if (new URL(req.url()).pathname === "/api/copilotkit/info") infoRequests.push(page.url());
  });
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
  await page.getByRole("link", { name: "Work", exact: true }).click();
  await page.getByRole("link", { name: "Capacity", exact: true }).click();
  await page.getByText("Fleet totals are temporarily unavailable.", { exact: true }).waitFor();
  await page.getByRole("link", { name: "Tasks", exact: true }).click();
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
  await page.getByRole("link", { name: "Capacity", exact: true }).click();
  await page.getByText("Fleet across all projects · 57 tasks · Stale", { exact: true }).waitFor();
  await page.getByRole("link", { name: "Tasks", exact: true }).click();
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
    await chooseAppearance(page, width === 375 ? "dark" : "light");
    await page.getByRole("link", { name: "Work", exact: true }).click();
    await page.getByRole("region", { name: "Work finder" }).waitFor();
    await screenshot(page, `chat-primary-finder-${width}.png`);
    await page.getByRole("link", { name: "Chat", exact: true }).click();
    await page.getByRole("log").waitFor();
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
  assert.equal(infoRequests.length, 1, JSON.stringify(infoRequests));
  await page.route("**/api/copilotkit/agent/abra/stop/*", (route) =>
    route.fulfill({ status: 503, body: "unavailable" }),
  );
  await page.getByRole("button", { name: "Stop current Abra turn" }).click();
  await page.getByRole("alert").filter({ hasText: "Stop could not be confirmed" }).waitFor();
  assert.equal(f.source.stops, 0);
  await page.unroute("**/api/copilotkit/agent/abra/stop/*");
  const stopped = page.waitForResponse((response) =>
    response.url().includes("/api/copilotkit/agent/abra/stop/"),
  );
  await page.getByRole("button", { name: "Stop current Abra turn", exact: false }).click();
  await stopped;
  assert.equal(f.source.stops, 1);
  assert.equal(f.source.value.work.work.length, 1);
  assert.equal(f.source.replies, 0);
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
  await page.getByRole("link", { name: "Attention", exact: true }).click();
  await page
    .getByRole("button", { name: /Build a single workspace.*Plan approval required/ })
    .waitFor();
  await page.getByRole("link", { name: "Work", exact: true }).click();
  await page.getByRole("button", { name: /Capacity pending task/ }).waitFor();
  assert.match(
    await page.getByRole("button", { name: /Capacity pending task/ }).innerText(),
    /Waiting for capacity.*Execution slots are occupied/,
  );
  await page.getByRole("link", { name: "Capacity", exact: true }).click();
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
  assert.match(await fleet.innerText(), /61 tasks/);
  assert.match(await fleet.innerText(), /Completed today: 7 \(UTC\)/);
  await page.getByRole("link", { name: "Tasks", exact: true }).click();
  await page.getByRole("button", { name: "Closed", exact: true }).click();
  await page.getByText(/56 matching tasks/).waitFor();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByText("Historical task 55", { exact: true }).waitFor();
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

test("GitHub finder loads on demand, preserves drafts on inspection and exposes partial history", async (t) => {
  const f = await fixture();
  t.onTestFinished(f.close);
  const page = await f.browser.newPage();
  const reads: string[] = [];
  const pr = {
    repository_id: "api",
    repo_node: "repo",
    item_node: "pr",
    kind: "pr",
    number: 91,
    url: "https://github.com/fixture/api/pull/91",
    title: "Retry download",
    author: "colleague",
    labels: [],
    labels_complete: true,
    state: "OPEN",
    updated_at: "2026-11-15T10:00:00Z",
    draft: true,
    links: [],
  };
  await page.route("**/api/work/github**", (route) => {
    const url = new URL(route.request().url());
    reads.push(url.pathname);
    if (url.pathname.endsWith("/item"))
      return route.fulfill({
        json: {
          ...pr,
          observed_at: 1,
          body: "Investigate the missing retry.",
          comments: [],
          comments_complete: true,
        },
      });
    const merged = url.searchParams.get("state") === "MERGED";
    return route.fulfill({
      json: {
        total: 1,
        entries: [merged ? { ...pr, state: "MERGED", title: "Previous delivery" } : pr],
        coverage: [
          {
            repository_id: "api",
            kind: "pr",
            status: "stale",
            message: "GitHub rate limit reached",
            observed_at: 1,
          },
        ],
      },
    });
  });
  await page.goto(f.origin);
  const work = page.getByRole("link", { name: "GitHub", exact: true });
  await work.waitFor();
  const observeFallback = async (text: string) => {
    // Leave the feed idle so its server-side fallback discovers this message.
    f.source.value = {
      ...f.source.value,
      messages: [
        ...f.source.value.messages,
        {
          id: "msg_" + f.source.value.messages.length,
          role: "assistant",
          text,
          at: f.source.value.at,
        },
      ],
    };
    await page.getByText(text, { exact: true }).waitFor({ state: "attached" });
  };
  await observeFallback("Inbox is unmounted");
  assert.equal(reads.length, 0);
  const composer = page.getByRole("textbox", { name: "Message Abra" });
  await composer.fill("Existing draft");
  await work.click();
  const row = page.getByRole("button", { name: /PR #91.*Retry download/ });
  await row.waitFor();
  await page.getByText(/GitHub rate limit reached/).waitFor();
  assert.equal(reads.filter((p) => p.endsWith("/item")).length, 0);
  await row.click();
  await page.getByText("Investigate the missing retry.").waitFor();
  assert.equal(
    await page.locator('textarea[aria-label="Message Abra"]').inputValue(),
    "Existing draft",
  );
  await page.getByRole("button", { name: "Ask Abra to review" }).click();
  assert.equal(
    await composer.inputValue(),
    "Existing draft\nPrivately review " + pr.url + " in project api.",
  );
  await work.click();
  await page.getByText("GitHub filters", { exact: true }).click();
  await page.getByLabel("GitHub state").selectOption("MERGED");
  await page.getByRole("button", { name: /Previous delivery/ }).waitFor();
  await page.getByRole("button", { name: "Clear GitHub filters" }).click();
  await row.waitFor();
  const setHidden = (hidden: boolean) =>
    page.evaluate((value) => {
      Object.defineProperty(document, "hidden", { configurable: true, value });
      document.dispatchEvent(new Event("visibilitychange"));
    }, hidden);
  await setHidden(true);
  assert.equal(await row.count(), 1);
  const hiddenReads = reads.length;
  await page.clock.install();
  await page.clock.fastForward(310000);
  await observeFallback("Inbox is hidden");
  assert.equal(reads.length, hiddenReads);
  await setHidden(false);
  await row.waitFor();
  await page.getByRole("link", { name: "Chat", exact: true }).click();
  await row.waitFor({ state: "detached" });
  const before = reads.length;
  await page.clock.fastForward(310000);
  assert.equal(reads.length, before);
});

test("Work opens each real reader alongside one live chat and sending preserves the selected diff", async (t) => {
  const f = await fixture();
  t.onTestFinished(f.close);
  const page = await f.browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(f.origin + "/work");
  const task = page.getByRole("navigation", { name: "Work results" }).getByRole("button").first();
  await task.click();
  const input = page.getByLabel("Message Abra", { exact: true });
  const sections = page.getByRole("tablist", { name: "Work details", exact: true });
  await input.fill("Explain the selected diff");
  for (const tab of ["Plan", "Verification", "Diff"]) {
    await sections.getByRole("tab", { name: tab, exact: true }).click();
    await page.waitForURL((url) => url.pathname === "/work" && url.searchParams.get("tab") === tab);
    assert.equal(await input.inputValue(), "Explain the selected diff");
  }
  const file = page.getByRole("region", { name: "source.ts", exact: true });
  await file.waitFor();
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.getByRole("log").getByText("Explain the selected diff", { exact: true }).waitFor();
  await file.waitFor();
  assert.equal(f.source.submissions, 1);
  assert.equal(new URL(page.url()).searchParams.get("tab"), "Diff");
  await page.reload();
  await file.waitFor();
  await input.fill("Second question");
  for (const width of [1250, 761, 760, 1251]) {
    await page.setViewportSize({ width, height: 900 });
    await file.waitFor();
  }
  assert.equal(await input.inputValue(), "Second question");
});

test("Closed Work returns to its off-page reading position and keeps a separate merged GitHub filter", async (t) => {
  const f = await fixture();
  t.onTestFinished(f.close);
  const current = f.source.value.work.work[0];
  f.setDiscovery(
    Array.from({ length: 100 }, (_, i) => ({
      ...current,
      issue_id: IssueId.make("closed-" + i),
      title: "Closed task " + i,
      issue_status: "closed" as const,
    })),
  );
  const page = await f.browser.newPage({ viewport: { width: 1440, height: 700 } });
  await page.goto(f.origin + "/work");
  await page.getByRole("button", { name: "Closed", exact: true }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByText("51–100 of 100").waitFor();
  const task = page.getByRole("button", { name: /Closed task 80/ });
  await task.scrollIntoViewIfNeeded();
  const scroller = page.locator(".collection-page:visible").first();
  const position = await scroller.evaluate((el) => el.scrollTop);
  assert.ok(position > 0);
  await task.click();
  await page.getByRole("heading", { name: "Closed task 80", exact: true }).waitFor();
  await page.getByRole("button", { name: "Close inspector" }).click();
  await task.waitFor();
  assert.ok(Math.abs((await scroller.evaluate((el) => el.scrollTop)) - position) < 3);
  await page.getByRole("link", { name: "GitHub", exact: true }).click();
  await page.getByText("GitHub filters", { exact: true }).click();
  await page.getByLabel("GitHub item type").selectOption("pr");
  await page.getByLabel("GitHub state").selectOption("MERGED");
  await page.waitForURL((url) => decodeURIComponent(url.search).includes("MERGED"));
  await page.getByRole("link", { name: "Work", exact: true }).click();
  await page.getByText("51–100 of 100").waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Closed", exact: true }).getAttribute("aria-pressed"),
    "true",
  );
});

test("search pages retained evidence in place and locates text beyond an observed message preview", async (t) => {
  const f = await fixture();
  t.onTestFinished(f.close);
  const work = f.source.value.work.work[0];
  f.source.value = {
    ...f.source.value,
    messages: [
      {
        id: "msg_searchable",
        role: "assistant",
        at: f.source.value.at,
        text: "Earlier observation. ".repeat(10) + "Final keyword.",
      },
    ],
  };
  f.source.work.evidenceSearch = (q) =>
    Effect.succeed(
      q.after_owner
        ? {
            entries: [
              {
                kind: "wait" as const,
                issue_id: work.issue_id,
                repository_id: RepositoryId.make(f.source.value.projects[0].id),
                identity: "approval/1",
                label: "Retained approval",
                context: "Worker waiting",
              },
            ],
            coverage: [],
          }
        : {
            entries: [],
            coverage: [],
            next: { after_owner: "work/" + work.issue_id, after_entry: "" },
          },
    );
  const page = await f.browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(f.origin);
  await page.getByLabel("Message Abra").waitFor();
  await page.keyboard.press("Control+k");
  const input = page.getByLabel("Search work and commands");
  await input.fill("wait:approval");
  await page.getByRole("option", { name: "Search next retained evidence page" }).click();
  await page.getByRole("option", { name: /Retained approval/ }).waitFor();
  assert.equal(await input.inputValue(), "wait:approval");
  await input.fill("message:Final keyword");
  await page.getByRole("option", { name: /Earlier observation/ }).click();
  await page.waitForURL((url) => url.hash === "#message-msg_searchable");
  assert.equal(await page.locator(":focus").getAttribute("id"), "message-msg_searchable");
  assert.equal(f.source.submissions, 0);
});
