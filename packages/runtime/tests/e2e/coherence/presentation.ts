import { FixtureViewSchema } from "../../helpers/web.ts";
import { chooseAppearance } from "../../helpers/workspace-browser.ts";
import assert from "node:assert/strict";
import { Effect, Schema } from "effect";
import {
  TranscriptMessageSchema,
  SurfaceRecordSchema,
} from "@abracode/contracts/web/workspace-wire";
import { catalogId } from "@abracode/contracts/web/catalog";
import { Form } from "@opencode/schema/form";
import { test, fixture, screenshot } from "../../helpers/coherence-browser.ts";
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
          format: "a2ui-snapshot",
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
  await page.getByRole("complementary", { name: "Work inspector" }).waitFor();
  await page.getByRole("link", { name: "Chat", exact: true }).click();
  await page.getByRole("log").waitFor();
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

test("native observation outages retain data and the server fallback recovers missed events without browser polling", async (t) => {
  const f = await fixture();
  t.onTestFinished(f.close);
  const page = await f.browser.newPage({ viewport: { width: 1440, height: 1000 } });
  f.source.value = {
    ...f.source.value,
    forms: [
      {
        active: true,
        binding: "review",
        form: {
          id: Form.ID.make("frm_theme"),
          sessionID: f.source.sessionID,
          title: "Review",
          fields: [{ type: "string", key: "answer", title: "Pending answer" }],
        },
      },
    ],
    messages: Array.from({ length: 30 }, (_, index) => ({
      id: `msg_theme_${index}`,
      role: "assistant",
      text: `Observation ${index}`,
      at: f.source.value.at,
    })),
  };
  let bootstrapReads = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/bootstrap") bootstrapReads++;
  });
  await page.goto(`${f.origin}/?issue=abra-web&tab=Overview`);
  const composer = page.getByRole("textbox", { name: "Message Abra" });
  await composer.fill("Preserve my draft through native reconnect");
  await page.getByText("Details for Build a single workspace", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Review next" }).click();
  const answer = page.getByLabel("Pending answer");
  await answer.fill("Unsubmitted");
  await page.goBack();
  await composer.waitFor();
  const scroll = page.locator(".conversation-scroll");
  await scroll.dispatchEvent("wheel");
  await scroll.evaluate(async (element) => {
    element.scrollTop = 400;
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  const readingAnchor = () =>
    scroll.evaluate(
      (element) =>
        [...element.querySelectorAll<HTMLElement>("[data-native-message-id]")].find(
          (message) => message.getBoundingClientRect().bottom > element.getBoundingClientRect().top,
        )?.dataset.nativeMessageId,
    );
  const position = await readingAnchor();
  assert.ok(position);
  await chooseAppearance(page, "dark");
  await composer.waitFor();
  assert.equal(await readingAnchor(), position);
  assert.match(page.url(), /issue=abra-web/);
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
  assert.equal(await answer.inputValue(), "Unsubmitted");
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
  f.source.value = Schema.decodeSync(FixtureViewSchema)({
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
  const value = Schema.decodeSync(FixtureViewSchema)({
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
  const requestedCursors: (string | null)[] = [];
  await page.route("**/api/history?*", (route) => {
    requestedCursors.push(new URL(route.request().url()).searchParams.get("cursor"));
    return requestedCursors.length === 1 ? route.abort() : route.continue();
  });
  await page.getByRole("button", { name: "Load earlier messages", exact: true }).click();
  const failure = page
    .locator("[data-sonner-toast]")
    .filter({ hasText: "Couldn’t load earlier messages" });
  await failure.getByRole("button", { name: "Retry" }).click();
  await page.getByText("Original generated layout", { exact: true }).waitFor();
  assert.deepEqual(requestedCursors, ["older-view", "older-view"]);
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
  const preview = (revision: number) =>
    page.locator(`.transcript [data-surface-reference="retained-board/${revision}"]`);
  assert.equal(await preview(1).getByRole("button", { name: "Open comparison" }).count(), 1);
  await preview(1).getByRole("button", { name: "Open comparison" }).click();
  const canvas = page.getByLabel("Work inspector", { exact: true });
  await canvas.getByText("Original generated layout", { exact: true }).waitFor();
  await preview(2).getByRole("button", { name: "Open comparison" }).click();
  await canvas.getByText("Revised generated layout", { exact: true }).waitFor();
  await page.goBack();
  await canvas.getByText("Original generated layout", { exact: true }).waitFor();
  await page.reload();
  await canvas.getByText("Original generated layout", { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("link", { name: "Chat", exact: true }).click();
  await page.goBack();
  await canvas.getByText("Original generated layout", { exact: true }).waitFor();
  for (const [session_id, revision] of [
    [f.source.sessionID, 99],
    ["ses_someone_else", 1],
  ] as const) {
    const params = new URLSearchParams({
      surface: JSON.stringify({ session_id, revision, surface_id: "retained-board" }),
    });
    await page.goto(f.origin + "/?" + params);
    await canvas.getByText(/unavailable|another Abra conversation/).waitFor();
    await page.getByRole("link", { name: "Work", exact: true }).waitFor();
    assert.equal(await canvas.locator(".generated-surface").count(), 0);
  }
  await page.getByRole("button", { name: "Close inspector" }).click();
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

test("workspace route recovery reloads the failed route and cockpit text meets AA on every surface", async (t) => {
  const f = await fixture();
  t.onTestFinished(f.close);
  const page = await f.browser.newPage();
  await page.route("**/assets/settings-*.js", (route) => route.abort("failed"));
  await page.goto(f.origin + "/settings/appearance");
  await page.getByRole("heading", { name: "AbraCode could not display this page" }).waitFor();
  await page.unroute("**/assets/settings-*.js");
  await page.getByRole("button", { name: "Reload page" }).click();
  const theme = page.getByLabel("Color theme", { exact: true });
  for (const mode of ["light", "dark"]) {
    await theme.selectOption(mode);
    const contrast = await page.evaluate(() => {
      const css = getComputedStyle(document.documentElement);
      function luminance(token: string) {
        const value = css.getPropertyValue(token).trim();
        const hex = value.length === 4 ? "#" + value.slice(1).replace(/[0-9a-f]/gi, "$&$&") : value;
        const rgb = [1, 3, 5]
          .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
          .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
        return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
      }
      return ["--ink-muted", "--accent-primary"].flatMap((ink) =>
        ["--surface-0", "--surface-1", "--surface-2", "--surface-3", "--surface-hover"].map(
          (bg) => {
            const a = luminance(ink),
              b = luminance(bg);
            return { ink, bg, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
          },
        ),
      );
    });
    for (const pair of contrast) assert.ok(pair.ratio >= 4.5, JSON.stringify({ mode, ...pair }));
  }
});
