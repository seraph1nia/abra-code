import { expect } from "vite-plus/test";
import assert from "node:assert/strict";
import { Effect, Schema } from "effect";
import { SurfaceRecordSchema } from "@abracode/contracts/web/workspace-wire";
import { catalogId } from "@abracode/contracts/web/catalog";
import { Form } from "@opencode/schema/form";
import { IssueId, MessageId, SessionId } from "@abracode/contracts/identities";
import { test, fixture } from "../../helpers/coherence-browser.ts";
test("phone destinations follow bookmarks and history at the 760px boundary", async (t) => {
  const f = await fixture();
  t.onTestFinished(f.close);
  const first = f.source.value.work.work[0];
  f.setDiscovery([
    first,
    { ...first, issue_id: IssueId.make("abra-second"), title: "Second task" },
  ]);
  const page = await f.browser.newPage({ viewport: { width: 760, height: 844 } });
  const nav = page.getByRole("navigation", { name: "Workspace", exact: true });
  const reader = page.getByRole("complementary", { name: "Work inspector" });
  const draft = page.getByLabel("Message Abra");
  await page.goto(f.origin + "/settings/repositories");
  await page.getByRole("heading", { name: "Repositories" }).waitFor();
  await nav.getByRole("link", { name: "Chat" }).click();
  await draft.fill("Keep this question");
  await nav.getByRole("link", { name: "Work", exact: true }).click();
  await page.getByLabel("Search work").fill("Second");
  await page.getByText("1 matching task", { exact: false }).waitFor();
  const list = page.url();
  await page.getByRole("button", { name: /Second task/ }).click();
  await reader.waitFor();
  const selection = page.url();
  await page.goBack();
  await page.getByLabel("Search work").waitFor();
  assert.equal(page.url(), list);
  assert.equal(await page.getByLabel("Search work").inputValue(), "Second");
  await page.goForward();
  await reader.waitFor();
  await page.reload();
  await reader.waitFor();
  assert.equal(page.url(), selection);
  for (const width of [761, 1250, 1251, 1440, 760]) {
    await page.setViewportSize({ width, height: 844 });
    if (width > 760 && width <= 1250)
      await page.getByRole("dialog", { name: /Work inspector/ }).waitFor();
    else {
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      await reader.waitFor();
      await draft.waitFor({ state: "hidden" });
    }
  }
  await nav.getByRole("link", { name: "Chat" }).click();
  assert.equal(await draft.inputValue(), "Keep this question");
  await page.goto(f.origin + "/?view=finder");
  await page.waitForURL("**/work");
  await page.goto(f.origin + "/?resource=invalid");
  await draft.waitFor();
  assert.equal(await reader.count(), 0);
  assert.equal(f.source.submissions, 0);
});

test("phone retains the current form and reading position when a reply arrives in Settings", async (t) => {
  const f = await fixture();
  t.onTestFinished(f.close);
  const message = (i: number) => ({
    id: "reading-" + i,
    role: "assistant" as const,
    text: "Reading position " + i + ". " + "Recorded observation. ".repeat(18),
    at: f.source.value.at,
  });
  f.source.value = {
    ...f.source.value,
    messages: Array.from({ length: 30 }, (_, i) => message(i)),
    forms: [
      {
        binding: "phone-current",
        active: true,
        form: {
          id: Form.ID.make("frm_phone"),
          sessionID: f.source.sessionID,
          title: "Choose storage",
          fields: [{ key: "answer", title: "Storage choice", type: "string", required: true }],
        },
      },
    ],
  };
  const page = await f.browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(f.origin);
  await page.getByLabel("Message Abra").fill("Check before sending");
  const anchor = page.locator('[data-native-message-id="reading-12"]');
  await anchor.evaluate((element) => element.scrollIntoView({ block: "start" }));
  const offset = await anchor.evaluate((element) => element.getBoundingClientRect().top);
  await page.getByRole("link", { name: "Attention", exact: true }).click();
  await page.getByLabel("Storage choice").fill("SQLite");
  await page.getByRole("link", { name: "More", exact: true }).click();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("heading", { name: "Agents" }).waitFor();
  f.source.value = { ...f.source.value, messages: [...f.source.value.messages, message(30)] };
  await f.changed();
  await page.locator('[data-native-message-id="reading-30"]').waitFor({ state: "attached" });
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("option", { name: "Review pending decisions" }).click();

  assert.equal(await page.getByLabel("Storage choice").inputValue(), "SQLite");
  await page.getByRole("link", { name: "Chat", exact: true }).click();
  await page.getByRole("log").waitFor();
  await page.waitForFunction(
    (expected) => {
      const element = document.querySelector('[data-native-message-id="reading-12"]');
      return element && Math.abs(element.getBoundingClientRect().top - expected) < 4;
    },
    offset,
    { timeout: 3000 },
  );
  assert.equal(await page.getByLabel("Message Abra").inputValue(), "Check before sending");
  assert.equal(f.replies.length, 0);
});

test("portrait composer and busy controls fit the visible height with wide transcript content", async (t) => {
  const f = await fixture();
  t.onTestFinished(f.close);
  f.source.value = {
    ...f.source.value,
    busy: true,
    messages: Array.from({ length: 18 }, (_, i) => ({
      id: "wide-" + i,
      role: "assistant" as const,
      at: f.source.value.at,
      text: "```txt\n" + "W".repeat(250) + "\n```",
    })),
  };
  const page = await f.browser.newPage({ viewport: { width: 375, height: 812 } });
  await page.goto(f.origin);
  const draft = page.getByRole("textbox", { name: "Message Abra" });
  await draft.fill("Long prompt\n".repeat(20));
  for (const [width, height] of [
    [375, 812],
    [375, 450],
    [390, 844],
    [390, 460],
  ]) {
    await page.setViewportSize({ width, height });
    await page.waitForFunction(
      () =>
        Math.abs(
          document.querySelector(".workspace-shell")!.getBoundingClientRect().height - innerHeight,
        ) < 2,
    );
    await draft.press("End");
    for (const control of [
      draft,
      page.getByLabel("Message delivery"),
      page.getByRole("button", { name: "Send message" }),
      page.getByRole("button", { name: "Stop current Abra turn" }),
    ]) {
      const box = await control.boundingBox();
      assert.ok(
        box &&
          box.y >= 0 &&
          box.y + box.height <= height &&
          box.x >= 0 &&
          box.x + box.width <= width,
        "Control outside " + width + " × " + height,
      );
    }
    assert.ok(
      await page.locator(".conversation-scroll").evaluate((el) => {
        el.scrollTop = 15;
        return el.scrollTop > 0 && el.clientHeight > 0 && el.scrollHeight > el.clientHeight;
      }),
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth && window.scrollY === 0,
      ),
    );
  }
  assert.equal(f.source.submissions, 0);
});

test("palette opens from Settings by touch or shortcut and keeps modal keyboard ownership", async (t) => {
  const f = await fixture();
  t.onTestFinished(f.close);
  const page = await f.browser.newPage({ hasTouch: true, viewport: { width: 390, height: 844 } });
  let bootstrap = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/bootstrap") bootstrap++;
  });
  await page.goto(f.origin + "/settings/repositories");
  const search = page.getByRole("button", { name: "Search", exact: true });
  await search.tap();
  const input = page.getByLabel("Search work and commands");
  await input.fill("open");
  await input.press("ArrowDown");
  assert.equal(await input.inputValue(), "open");
  await input.press("Control+k");
  assert.equal(await page.getByRole("dialog").count(), 1);
  await input.press("Escape");
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Search");
  for (const key of ["Meta+k", "Control+k"]) {
    await search.press(key);
    await input.waitFor();
    assert.equal(
      await page.getByRole("option", { name: /Review pending|Resume last|Open Diff/ }).count(),
      0,
    );
    await input.press("Escape");
  }
  assert.equal(bootstrap, 0);
  await search.tap();
  await input.fill("finder");
  await input.press("Enter");
  await page.getByRole("region", { name: "Work finder" }).waitFor();
  await page.goBack();
  await page.getByRole("heading", { name: "Repositories" }).waitFor();
  await page.goForward();
  await page.getByRole("button", { name: /Build a single workspace/ }).click();
  await page.setViewportSize({ width: 980, height: 800 });
  const sheet = page.getByRole("dialog", { name: /Work inspector/ });
  await sheet.waitFor();
  await page.keyboard.press("Control+k");
  await page.getByRole("dialog", { name: "Search workspace" }).waitFor();
  await page.getByLabel("Search work and commands").press("Escape");
  assert.ok(await sheet.isVisible());
});

test("palette searches off-page tasks, rejects late matches and seeds editable finder filters", async (t) => {
  const f = await fixture();
  t.onTestFinished(f.close);
  const work = f.source.value.work.work[0];
  const task = {
    ...work,
    issue_id: IssueId.make("archived-key"),
    title: "Archived palette task",
    issue_status: "closed" as const,
  };
  f.setDiscovery([work, task]);
  const page = await f.browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(f.origin + "/settings/repositories");
  const trigger = page.getByRole("button", { name: "Search", exact: true });
  const input = page.getByLabel("Search work and commands");
  await trigger.click();
  await input.fill("archiv");
  await page.getByRole("option", { name: /Archived palette task.*closed/ }).waitFor();
  await page.getByRole("option", { name: "See all results in Work" }).click();
  const field = page.getByRole("textbox", { name: "Search work", exact: true });
  await field.waitFor();
  assert.equal(await field.inputValue(), "archiv");
  await page.getByRole("button", { name: "Active", exact: true }).click();
  await page.getByRole("combobox", { name: "Project" }).selectOption({ index: 1 });
  await trigger.click();
  await input.fill("archived-key");
  await page.getByRole("option", { name: /Archived palette task/ }).waitFor();
  assert.match(
    await page
      .getByRole("listbox", { name: "Search results" })
      .getByRole("option")
      .first()
      .innerText(),
    /Archived palette task/,
  );
  await page.getByRole("option", { name: "See all results in Work" }).click();
  await page.getByRole("button", { name: /Archived palette task/ }).waitFor();
  assert.equal(await field.inputValue(), "archived-key");
  assert.equal(await page.getByRole("combobox", { name: "Project" }).inputValue(), "");
  assert.equal(
    await page.getByRole("button", { name: "All", exact: true }).getAttribute("aria-pressed"),
    "true",
  );
  await trigger.click();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/work/find?*", async (route) => {
    const term = new URL(route.request().url()).searchParams.get("search");
    if (term === "palette") await pending;
    if (term === "settings") return route.fulfill({ status: 503, body: "unavailable" });
    await route.continue();
  });
  const requested = page.waitForRequest(
    (request) => new URL(request.url()).searchParams.get("search") === "palette",
  );
  await input.fill("palette");
  await requested;
  await input.fill("no such work");
  await page.getByRole("status").filter({ hasText: "No matching work" }).waitFor();
  release();
  await input.fill("settings");
  await page.getByRole("option", { name: "Retry Work" }).waitFor();
  assert.equal(await page.getByRole("option", { name: /Archived palette task/ }).count(), 0);
  await page.getByRole("option", { name: /^Settings / }).waitFor();
  await input.fill("archived-key");
  await page.getByRole("option", { name: /Archived palette task/ }).click();
  await page.getByRole("heading", { name: task.title, exact: true }).waitFor();
  for (const tab of ["Plan", "Diff", "Verification", "Reports"]) {
    await trigger.click();
    await input.fill(tab);
    await page.getByRole("option", { name: new RegExp("^Open " + tab + " ") }).click();
    await page.waitForURL((url) => url.searchParams.get("tab") === tab);
  }
  assert.equal(f.source.submissions, 0);
});

test("palette opens the exact publication once by producing call or message ID", async (t) => {
  const f = await fixture();
  t.onTestFinished(f.close);
  const session = f.source.sessionID;
  const entries = [1, 2].map((revision) => ({
    session_id: session,
    message_id: MessageId.make("msg_producer_" + revision),
    tool_call_id: "unique-call-" + revision,
    source: "tool" as const,
    target: { kind: "surface" as const, surface_id: "board", revision },
  }));
  f.source.value = {
    ...f.source.value,
    surfaces: [{ surface_id: "board", revision: 2, at: f.source.value.at }],
  };
  for (const { target } of entries)
    f.source.surfaceHistory.set(
      "board/" + target.revision,
      Schema.decodeSync(SurfaceRecordSchema)({
        session_id: session,
        tool_call_id: "call",
        revision: target.revision,
        at: f.source.value.at,
        snapshot: [],
        surface: {
          version: "1.0",
          createSurface: {
            surfaceId: "board",
            catalogId,
            components: [
              { id: "root", component: "Text", text: "Exact layout " + target.revision },
            ],
          },
        },
      }),
    );
  f.source.publications = ({ search }) =>
    Effect.succeed({
      entries: [
        ...entries.filter((e) =>
          [e.tool_call_id, e.message_id, e.target.surface_id].some((v) => v.includes(search ?? "")),
        ),
        {
          ...entries[0],
          session_id: SessionId.make("ses_previous"),
          target: { ...entries[0].target, surface_id: "foreign-board" },
        },
      ],
      incomplete: false,
    });
  const page = await f.browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const requests: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.pathname === "/api/surface") requests.push(url.searchParams.get("revision")!);
  });
  for (const [term, revision] of [
    ["unique-call-2", 2],
    ["msg_producer_1", 1],
  ] as const) {
    await page.goto(f.origin + "/settings/repositories");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    const input = page.getByLabel("Search work and commands");
    await input.fill("surface: board");
    await expect.poll(() => page.getByRole("option", { name: /surface.*board/i }).count()).toBe(2);
    await input.fill("surface: " + term);
    const hit = page.getByRole("option", { name: /surface.*board/i });
    await expect.poll(() => hit.count()).toBe(1);
    requests.length = 0;
    await hit.click();
    await page
      .getByLabel("Work inspector", { exact: true })
      .getByText("Exact layout " + revision, { exact: true })
      .waitFor();
    assert.deepEqual(requests, [String(revision)]);
  }
});

test("palette and slash onboarding append the same draft and leave admission explicit", async (t) => {
  const f = await fixture();
  t.onTestFinished(f.close);
  const page = await f.browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(f.origin + "/?issue=abra-web&tab=Diff");
  const input = page.getByLabel("Message Abra");
  await input.fill("First question");
  await page.keyboard.press("Control+k");
  const search = page.getByLabel("Search work and commands");
  await search.fill("add project");
  await page.getByRole("option", { name: /Onboard repository/ }).click();
  await page.waitForFunction(() =>
    document.querySelector("textarea")?.value.includes("onboard a project"),
  );
  const paletteDraft = await input.inputValue();
  assert.match(paletteDraft, /First question/);
  await input.fill("First question");
  await input.press("End");
  await input.pressSequentially(" /onboard-repo");
  await page.getByRole("option", { name: /onboard-repo/ }).click();
  assert.equal((await input.inputValue()).replace(/ +\n/g, "\n"), paletteDraft);
  await input.fill("x".repeat(32767));
  await page.keyboard.press("Control+k");
  await search.fill("> onboard");
  await page.getByRole("option", { name: /Onboard repository/ }).click();
  await page.getByText("This insertion exceeds the draft limit.").waitFor();
  assert.equal((await input.inputValue()).length, 32767);
  assert.equal(f.source.submissions, 0);
  assert.equal(f.replies.length, 0);
});

test("slash selection edits the chosen token in place and leaves literal and dismissed commands intact", async (t) => {
  const f = await fixture();
  t.onTestFinished(f.close);
  const page = await f.browser.newPage();
  await page.goto(f.origin);
  const input = page.getByRole("textbox", { name: "Message Abra" });
  await input.fill("Before  after");
  await input.evaluate((el) => (el as HTMLTextAreaElement).setSelectionRange(7, 7));
  await input.pressSequentially("/save");
  await page.getByRole("option", { name: /save-thought/ }).waitFor();
  await input.press("Enter");
  assert.match(await input.inputValue(), /^Before Save .*Memos: after$/);
  await input.fill("~~~ts\n");
  await input.press("Control+End");
  await input.pressSequentially("/onboard");
  assert.equal(await page.getByRole("option", { name: /onboard-repo/ }).count(), 0);
  await input.fill("");
  await input.pressSequentially("/attach");
  await page.getByRole("option", { name: /attach-thought/ }).waitFor();
  await input.press("Escape");
  assert.equal(await input.inputValue(), "/attach");
  assert.equal(await page.getByRole("option", { name: /attach-thought/ }).count(), 0);
  assert.equal(f.source.submissions, 0);
});
