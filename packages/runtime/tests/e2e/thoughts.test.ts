import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { Deferred, Effect } from "effect";
import { CrewError } from "../../src/domain.ts";
import { workspaceBrowserFixture } from "../helpers/workspace-browser.ts";

test("Thoughts browses private selections directly with zero projects and keeps late responses out of the current page", async (t) => {
  const f = await workspaceBrowserFixture();
  t.onTestFinished(f.close);
  f.source.value = { ...f.source.value, projects: [] };
  const instance = "https://notes.example.test";
  const row = (id: string, snippet: string) => ({
    reference: {
      instance,
      account: "users/me",
      name: "memos/" + id,
      wording_hash: (id === "first" ? "a" : "b").repeat(64),
    },
    snippet,
    tags: ["road"],
    created_at: "2026-11-20T09:00:00Z",
    updated_at: "2026-11-20T09:00:00Z",
  });
  const first = row("first", "Similar thought"),
    second = row("second", "Similar thought");
  let state = "unconfigured";
  const started = Deferred.makeUnsafe<void>(),
    release = Deferred.makeUnsafe<void>();
  f.source.work.thoughtList = (query) =>
    Effect.gen(function* () {
      if (state === "unconfigured")
        return yield* new CrewError("MEMOS_UNCONFIGURED", "Configure a Memos notebook");
      if (state === "down")
        return yield* new CrewError("MEMOS_UNAVAILABLE", "Notebook connection failed");
      if (query.text === "old") {
        yield* Deferred.succeed(started, undefined);
        yield* Deferred.await(release);
        return { entries: [row("first", "Obsolete result")] };
      }
      if (query.text === "empty") return { entries: [] };
      if (query.text === "current") {
        assert.equal(query.tag, "road");
        assert.equal(query.from, "2026-11-01");
        assert.equal(query.until, "2026-12-01");
      }
      return query.cursor ? { entries: [second] } : { entries: [first, second], next_cursor: "p2" };
    });
  f.source.work.thoughtDetail = (ref) =>
    Effect.succeed({
      ...second,
      reference: ref,
      content: "Exact " + ref.name,
      url: instance + "/" + ref.name,
    });
  const page = await f.browser.newPage({ viewport: { width: 1440, height: 900 } });
  const origins = new Set<string>();
  page.on("request", (r) => {
    if (r.url().startsWith("http")) origins.add(new URL(r.url()).origin);
  });
  await page.goto(f.origin);
  await page.getByRole("link", { name: "Thoughts", exact: true }).click();
  await page.getByText(/Configure a Memos notebook/).waitFor();
  state = "down";
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await page.getByText(/Notebook connection failed/).waitFor();
  state = "ok";
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  const text = page.getByRole("textbox", { name: "Thought text" });
  const submit = page.getByRole("button", { name: "Search thoughts" });
  await text.fill("empty");
  await submit.click();
  await page.getByText("No matching thoughts.").waitFor();
  await text.fill("old");
  await submit.click();
  await Effect.runPromise(Deferred.await(started));
  await text.fill("current");
  await page.getByRole("textbox", { name: "Thought tag" }).fill("road");
  await page.getByLabel("From (UTC)").fill("2026-11-01");
  await page.getByLabel("Before (UTC)").fill("2026-12-01");
  await submit.click();
  await page
    .getByRole("button", { name: /Similar thought/ })
    .first()
    .waitFor();
  await Effect.runPromise(Deferred.succeed(release, undefined));
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: /Similar thought/ }).click();
  await page.getByText("Exact memos/second").waitFor();
  assert.equal(
    await page.getByRole("link", { name: "Open in Memos" }).getAttribute("href"),
    instance + "/memos/second",
  );
  await page.getByRole("button", { name: "Back to results" }).click();
  assert.equal(await text.inputValue(), "current");
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  assert.equal((await page.request.get(f.origin + "/api/thoughts")).status(), 200);
  assert.deepEqual([...origins], [f.origin]);
  assert.equal(f.source.submissions, 0);
});

test("phone selection preserves an edited draft through navigation and submits the exact reference once", async (t) => {
  const f = await workspaceBrowserFixture();
  t.onTestFinished(f.close);
  f.source.value = { ...f.source.value, projects: [] };
  const make = (name: string) => ({
    reference: {
      instance: "https://notes.test",
      account: "users/me",
      name: "memos/" + name,
      wording_hash: "3".repeat(64),
    },
    snippet: "Same opening",
    tags: [],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  });
  const rows = [make("first"), make("second")];
  f.source.work.thoughtList = () => Effect.succeed({ entries: rows });
  f.source.work.thoughtDetail = (reference) =>
    Effect.succeed({
      ...rows[1]!,
      reference,
      content: "Selected second body",
      url: reference.instance + "/" + reference.name,
    });
  const page = await f.browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(f.origin);
  const composer = page.getByRole("textbox", { name: "Message Abra" });
  await composer.fill("Keep my question");
  await page.getByRole("link", { name: "Thoughts", exact: true }).click();
  await page
    .getByRole("button", { name: /Same opening/ })
    .nth(1)
    .click();
  await page.getByRole("button", { name: "Ask Abra about this" }).click();
  await composer.waitFor();
  assert.equal(await composer.inputValue(), "Keep my question");
  rows.reverse();
  await page.getByRole("link", { name: "More", exact: true }).click();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("link", { name: "Chat", exact: true }).click();
  await page.locator(".selection-chip").getByText("memos/second").waitFor();
  assert.equal(f.source.submissions, 0);
  await composer.fill("Keep my question and discuss this");
  await composer.press("Enter");
  await page.getByText("I can help you build that.").waitFor();
  assert.equal(f.source.submissions, 1);
  assert.deepEqual(f.source.value.receipts.at(-1)?.thought, make("second").reference);
});

test("accepted wording and its original link survive an unavailable live memo", async (t) => {
  const f = await workspaceBrowserFixture();
  t.onTestFinished(f.close);
  const reference = {
    instance: "https://notes.test",
    account: "users/me",
    name: "memos/deleted",
    wording_hash: "a".repeat(64),
  };
  f.detailOverrides.set("abra-web", {
    thought_source: { reference, excerpt: "Accepted sentence." },
  });
  f.source.work.thoughtDetail = () =>
    Effect.fail(new CrewError("MEMOS_UNAVAILABLE", "This memo is unavailable."));
  const page = await f.browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(f.origin + "/work?issue=abra-web&tab=Overview");
  const card = page.locator(".thought-source");
  await card.getByText("Accepted sentence.").waitFor();
  assert.equal(
    await card.getByRole("link", { name: "Open in Memos" }).getAttribute("href"),
    reference.instance + "/" + reference.name,
  );
  await card.getByText("Live notebook preview").click();
  await card.getByText(/This memo is unavailable/).waitFor();
  assert.equal(await card.locator("blockquote").innerText(), "Accepted sentence.");
});

test("phone and desktop remember exactly the selected sentence with one identity across a lost reply", async (t) => {
  const f = await workspaceBrowserFixture();
  t.onTestFinished(f.close);
  f.source.memoryEnabled = Effect.succeed(true);
  const text = "Remember our test procedure. The next sentence stays private.";
  const reference = {
    instance: "https://notes.example.test",
    account: "users/me",
    name: "memos/lesson",
    wording_hash: "a".repeat(64),
  };
  const item = {
    reference,
    snippet: text,
    tags: [],
    created_at: "2026-11-22T10:00:00Z",
    updated_at: "2026-11-22T10:00:00Z",
    content: text,
    url: reference.instance + "/memos/lesson",
  };
  f.source.work.thoughtList = () => Effect.succeed({ entries: [item] });
  f.source.work.thoughtDetail = () => Effect.succeed(item);
  const attempts: import("@abracode/contracts/visibility/memory").MemoryPublication[] = [];
  f.source.memoryPublish = (input) => {
    attempts.push(input);
    return attempts.length % 2 === 1
      ? Effect.fail(new CrewError("MEMORY_UNRESOLVED", "Retry with the same request ID."))
      : Effect.succeed({ scope: input.destination, path: "lesson.md", revision: "b".repeat(64) });
  };
  for (const width of [390, 1440]) {
    const page = await f.browser.newPage({ viewport: { width, height: 844 } });
    try {
      await page.goto(f.origin + "/thoughts");
      await page.getByRole("button", { name: /Remember our test procedure/ }).click();
      await page.getByRole("button", { name: "Remember for…" }).click();
      await page.getByLabel("Exact wording").fill("Remember our test procedure.");
      await page.getByLabel("Destination").selectOption(width === 390 ? "shared" : "repo:fixture");
      await page.getByRole("button", { name: "Save to memory" }).click();
      await page.getByRole("button", { name: "Retry save" }).waitFor();
      await page.reload();
      await page.getByRole("button", { name: "Retry save" }).click();
      await page.getByRole("status").filter({ hasText: "Remembered for" }).waitFor();
      assert.deepEqual(attempts.at(-2), attempts.at(-1));
      assert.equal(attempts.at(-1)?.content, "Remember our test procedure.");
      assert.equal(f.source.submissions, 0);
    } finally {
      await page.close();
    }
  }
});

test("the memory slash command and Ctrl+K open scoped notes without sending or changing the draft", async (t) => {
  const f = await workspaceBrowserFixture();
  t.onTestFinished(f.close);
  f.source.memoryEnabled = Effect.succeed(true);
  let lookups = 0;
  f.source.memorySearch = ({ repository_id, query, cursor }) => {
    lookups++;
    assert.equal(query, "fixture");
    const title = cursor ? "Later lesson" : repository_id ? "Repository lesson" : "Shared lesson";
    return Effect.succeed({
      entries: [
        {
          title,
          excerpt: "A fixture observation.",
          reference: {
            scope: repository_id ? { kind: "repository", repository_id } : { kind: "shared" },
            path: "lesson.md",
            revision: "a".repeat(64),
          },
        },
      ],
      next_cursor: cursor ? undefined : "next",
    });
  };
  f.source.memoryRead = ({ repository_id, reference, offset }) => {
    if (reference.scope.kind === "shared") {
      assert.equal(repository_id, undefined);
      return Effect.fail(
        new CrewError("MEMORY_CONFLICT", "The selected note changed. Search again."),
      );
    }
    assert.equal(repository_id, "fixture");
    assert.equal(reference.scope.kind, "repository");
    return Effect.succeed({
      reference,
      body: offset ? "Last section." : "Exact first section.",
      complete: !!offset,
      next_offset: offset ? undefined : 8192,
    });
  };
  const page = await f.browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(f.origin);
  const draft = page.getByLabel("Message Abra", { exact: true });
  await draft.and(page.locator(":enabled")).pressSequentially("Keep my question /memory");
  await page.getByRole("option", { name: /\/memory/ }).waitFor();
  await draft.press("Enter");
  const search = page.getByLabel("Search work and commands");
  await search.waitFor();
  assert.equal(await search.inputValue(), "memory: ");
  await search.pressSequentially("fixture");
  await page.getByRole("option", { name: /Shared lesson/ }).waitFor();
  await page.getByLabel("Memory scope").selectOption("fixture");
  await page.getByRole("option", { name: /Repository lesson/ }).waitFor();
  await page.getByRole("option", { name: "Search next memory page" }).click();
  await page.getByRole("option", { name: /Later lesson/ }).click();
  await page.getByText("Exact first section.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Read next section" }).click();
  await page.getByText("Last section.", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await draft.inputValue(), "Keep my question ");
  await page.keyboard.press("Control+k");
  await search.fill("> memory");
  await page.getByRole("option", { name: /Search agent memory/ }).click();
  await page.getByLabel("Memory scope").waitFor();
  assert.equal(await search.inputValue(), "memory: ");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+k");
  await search.fill("fixture");
  await page.getByRole("option", { name: /Shared lesson/ }).click();
  await page.getByRole("alert").filter({ hasText: "The selected note changed" }).waitFor();
  await page.getByRole("button", { name: "Back to results" }).click();
  await page.getByRole("option", { name: /Shared lesson/ }).waitFor();
  await page.keyboard.press("Escape");
  const previous = lookups;
  f.source.memoryEnabled = Effect.succeed(false);
  await page.reload();
  await draft.press("Control+k");
  await search.fill("memory: fixture");
  await page.getByText(/Enable Basic Memory in personal settings/).waitFor();
  assert.equal(lookups, previous);
  await page.keyboard.press("Escape");
  await draft.fill("");
  await draft.pressSequentially("/");
  await page.getByRole("option", { name: /onboard-repo/ }).waitFor();
  assert.equal(await page.getByRole("option", { name: /\/memory/ }).count(), 0);
  assert.equal(f.source.submissions, 0);
});
