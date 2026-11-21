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
  await page.getByRole("button", { name: "Toggle work finder" }).click();
  await page.getByRole("button", { name: "Thoughts", exact: true }).click();
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
  await page.getByRole("link", { name: "Canvas", exact: true }).click();
  await page.getByRole("button", { name: "Thoughts", exact: true }).click();
  await page
    .getByRole("button", { name: /Same opening/ })
    .nth(1)
    .click();
  await page.getByRole("button", { name: "Ask Abra about this" }).click();
  await composer.waitFor();
  assert.equal(await composer.inputValue(), "Keep my question");
  rows.reverse();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("link", { name: "Chat", exact: true }).click();
  await page.getByText("Selected thought · memos/second").waitFor();
  assert.equal(f.source.submissions, 0);
  await composer.fill("Keep my question and discuss this");
  await composer.press("Enter");
  await page.getByText("I can help you build that.").waitFor();
  assert.equal(f.source.submissions, 1);
  assert.deepEqual(f.source.value.receipts.at(-1)?.thought, make("second").reference);
});
