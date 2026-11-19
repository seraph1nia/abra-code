import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { Effect } from "effect";
import { CrewError } from "../../src/domain.ts";
import { workspaceBrowserFixture } from "../helpers/workspace-browser.ts";
import type { AgentCatalog } from "@abracode/contracts/web/agent-settings";

const catalog: AgentCatalog = {
  agents: [
    {
      id: "engineering-specialist",
      revision: "fixture-2",
      description: "Investigate repository architecture",
      mode: "subagent",
      roles: ["explore"],
      tools: ["read", "search"],
      customTools: [{ id: "inspect-repository", revision: "3" }],
      skills: [{ name: "verification", preload: true }],
      instructions: [
        { kind: "file", path: "explore.md" },
        { kind: "inline", content: "Inspect <script> as plain text." },
      ],
      requiredSkills: [],
      requiredTools: [],
      deny: ["write"],
      dynamicContext: true,
    },
  ],
};

test("workspace links to read-only agent settings, including custom definitions and reloads", async (t) => {
  const f = await workspaceBrowserFixture();
  t.onTestFinished(f.close);
  f.source.agents = Effect.succeed(catalog);
  const page = await f.browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const mutations: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET" && new URL(request.url()).pathname.startsWith("/api/settings"))
      mutations.push(request.url());
  });
  await page.goto(f.origin);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("heading", { name: "Agents", exact: true }).waitFor();
  await page.getByText("1 agent defined", { exact: true }).waitFor();
  await page.locator("summary").filter({ hasText: "engineering-specialist" }).click();
  await page.getByText("inspect-repository", { exact: true }).waitFor();
  assert.equal(await page.getByText("verification", { exact: true }).isVisible(), true);
  assert.equal(await page.getByText("explore.md", { exact: true }).isVisible(), true);
  assert.equal(
    await page.getByText("Inspect <script> as plain text.", { exact: true }).isVisible(),
    true,
  );
  assert.equal(
    await page.getByText("Provided dynamically for each assignment", { exact: true }).isVisible(),
    true,
  );
  assert.equal(await page.locator("input,textarea,select,[contenteditable=true]").count(), 0);
  const response = await page.reload();
  assert.equal(response?.status(), 200);
  await page.getByText("1 agent defined", { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("summary").click();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.getByRole("link", { name: "Back to workspace" }).click();
  await page.getByRole("textbox", { name: "Message Abra" }).waitFor();
  assert.deepEqual(mutations, []);
  assert.equal(f.source.submissions + f.source.stops + f.source.replies, 0);
});

test("settings handles unavailable catalogs, retry and an empty installation without loading the workspace", async (t) => {
  const f = await workspaceBrowserFixture();
  t.onTestFinished(f.close);
  f.source.agents = Effect.fail(new CrewError("WEB_NATIVE_UPDATE_REQUIRED", "Old native plugin"));
  const page = await f.browser.newPage();
  const workspaceRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/(bootstrap|copilotkit)/.test(request.url())) workspaceRequests.push(request.url());
  });
  await page.goto(`${f.origin}/settings`);
  await page.getByRole("alert").filter({ hasText: "Restart the service" }).waitFor();
  f.source.agents = Effect.succeed({ agents: [] });
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await page.getByText("No agents are defined in this installation.", { exact: true }).waitFor();
  assert.deepEqual(workspaceRequests, []);
  assert.equal(f.source.submissions + f.source.stops + f.source.replies, 0);
  const post = await fetch(`${f.origin}/api/settings/agents`, {
    method: "POST",
    headers: { origin: f.origin },
  });
  assert.equal(post.status, 404);
});
