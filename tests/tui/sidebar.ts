import { type FeedbackPage } from "../../src/workflow/feedback-contracts.ts";
import { feedbackFixture } from "./feedback-fixtures.ts";
import * as Id from "../../src/identities.ts";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createStore, produce } from "solid-js/store";
import { createSignal, onCleanup } from "solid-js";
import { testRender, useRenderer } from "@opentui/solid";
import {
  CodeRenderable,
  DiffRenderable,
  ScrollBoxRenderable,
  RGBA,
  TextAttributes,
  type Renderable,
  type KeyEvent,
} from "@opentui/core";
import { MarkdownToken, SyntaxToken } from "@opencode/theme/tui";
import {
  type Context,
  type KeymapCommand,
  type KeymapLayer,
  type SlotClaim,
} from "@opencode/plugin/tui/context";
import { type OpenCodeEvent } from "@opencode/client";
import { type WorkDetail, type WorkSnapshot } from "../../src/visibility/protocol.ts";
import plugin from "../../.opencode/plugins/abracode/tui.ts";

let snapshot: WorkSnapshot = {
  home: Id.AbsolutePath.make("/fixture"),
  at: Id.Timestamp.make("2026-10-14T12:00:00Z"),
  closed_total: 1,
  work: [
    {
      issue_id: Id.IssueId.make("abra-1"),
      title: "Add API authentication",
      repository_id: Id.RepositoryId.make("api"),
      priority: 1,
      issue_status: "in_progress",
      phase: "awaiting_plan_approval",
      active_role: "explore",
      sessions: [{ id: Id.SessionId.make("ses_explore-session"), role: "explore" }],
      eligible: false,
      blockers: ["Existing execution must be resumed"],
    },
    {
      issue_id: Id.IssueId.make("abra-2"),
      title: "Client authentication",
      repository_id: Id.RepositoryId.make("frontend"),
      priority: 2,
      issue_status: "open",
      sessions: [],
      eligible: false,
      blockers: ["Dependency blockers: abra-1"],
      blocker_details: [{ code: "dependency", message: "Waiting on abra-1" }],
    },
    {
      issue_id: Id.IssueId.make("abra-3"),
      title: "Installation progress",
      repository_id: Id.RepositoryId.make("api"),
      priority: 2,
      issue_status: "in_progress",
      phase: "applying",
      active_role: "apply",
      sessions: [{ id: Id.SessionId.make("ses_apply-session"), role: "apply" }],
      eligible: false,
      blockers: [],
    },
    {
      issue_id: Id.IssueId.make("abra-4"),
      title: "Registry health checks",
      repository_id: Id.RepositoryId.make("api"),
      priority: 2,
      issue_status: "open",
      sessions: [],
      eligible: true,
      blockers: [],
    },
    {
      issue_id: Id.IssueId.make("abra-5"),
      title: "Repository setup",
      repository_id: Id.RepositoryId.make("api"),
      priority: 2,
      issue_status: "closed",
      phase: "completed",
      sessions: [],
      eligible: false,
      blockers: [],
    },
  ],
};
const detail = (): WorkDetail => ({
  work: snapshot.work[0],
  description: "Protect **API routes** with `tokens`.",
  change: Id.ChangeName.make("api-auth"),
  documents: [
    Id.RelativePath.make("proposal.md"),
    Id.RelativePath.make("design.md"),
    Id.RelativePath.make("tasks.md"),
    Id.RelativePath.make("specs/auth/spec.md"),
  ],
  artifacts: [
    {
      id: Id.ArtifactId.make("proposal"),
      status: "done",
      path: Id.RelativePath.make("proposal.md"),
    },
    {
      id: Id.ArtifactId.make("custom-checks"),
      status: "ready",
      path: Id.RelativePath.make("checks.md"),
    },
  ],
  progress: { total: 7, complete: 3, remaining: 4 },
  proposal: [
    "## Why",
    "Protect the API with authentication.",
    "",
    "- Require **tokens** for *every* request.",
    "- See [API guide](https://example.com/auth).",
    "",
    "```typescript",
    'const auth = "required";',
    "```",
    "",
    "| Route | Access |",
    "| --- | --- |",
    "| /api | Token |",
  ].join("\n"),
  errors: [],
  ...(snapshot.work[0].policy && snapshot.work[0].policy !== "full-openspec"
    ? {
        change: undefined,
        archive: undefined,
        artifacts: [],
        progress: undefined,
        documents: [],
        proposal: "## Research scope\nRead the source and retain findings.",
      }
    : {}),
});
const slots: SlotClaim[] = [];
const disposedSlots = new Set<string>();
let commands: KeymapCommand[] = [];
const remaps = new Map<string, string>();
let listener: (event: { details: OpenCodeEvent }) => void = () => {};
let stopped = false;
let failed = false;
let reportReads = 0;
let feedbackReads = 0;
let externalFeedback = false;
let panelName = "";
const synced: string[] = [];
const syncFailures = new Set<string>();
const [sessionRunning, setSessionRunning] = createSignal(true);
const [queued, setQueued] = createSignal(false);
const opened: string[] = [];
const focused: string[] = [];
const memory = new Map<string, object>();
const color = (base: string) => ({ base: RGBA.fromHex(base) });
const [heading, setHeading] = createSignal(RGBA.fromHex("#a9b7ff"));
const warning = color("#eac17c");
const action = {
  base: RGBA.fromHex("#a9b7ff"),
  state: (state: { selected?: boolean; focused?: boolean; hovered?: boolean }) =>
    RGBA.fromHex(
      state.selected
        ? "#a9b7ff"
        : state.focused
          ? "#8fd5ad"
          : state.hovered
            ? "#eac17c"
            : "#eeeeee",
    ),
};
const ctx = {
  app: { version: "2.0.28", channel: "stable" },
  location: { directory: "/fixture" },
  theme: {
    hue: { accent: { 200: RGBA.fromHex("#a9b7ff") } },
    categorical: [{ 200: RGBA.fromHex("#8fd5ad") }],
    syntax: Object.fromEntries(SyntaxToken.literals.map((token) => [token, heading()])),
    markdown: {
      ...Object.fromEntries(MarkdownToken.literals.map((token) => [token, heading()])),
      get heading() {
        return heading();
      },
    },
    diff: {
      text: { added: heading(), removed: heading(), context: heading() },
      background: { added: heading(), removed: heading(), context: heading() },
    },
    text: {
      base: RGBA.fromHex("#eeeeee"),
      muted: RGBA.fromHex("#aaaaaa"),
      action: { primary: { ...action, focused: heading() }, secondary: action },
      feedback: {
        warning,
        error: color("#ff8888"),
        info: color("#a9b7ff"),
        success: color("#8fd5ad"),
      },
    },
    background: {
      base: RGBA.fromHex("#202026"),
      raised: color("#202026"),
      action: {
        secondary: {
          state: (state: { selected?: boolean; focused?: boolean; hovered?: boolean }) =>
            RGBA.fromHex(
              state.selected ? "#36364f" : state.focused || state.hovered ? "#3a3a45" : "#2b2b33",
            ),
        },
      },
      feedback: { warning: color("#382f23"), info: color("#242838"), success: color("#24382b") },
    },
    border: color("#3a3a45"),
  },
  storage: {
    memory(key: string, options: { initial: object }) {
      const [state, set] = createStore(memory.get(key) ?? options.initial);
      memory.set(key, state);
      return [state, (mutation: (draft: object) => void) => set(produce(mutation))];
    },
  },
  client: {
    rpc: () => ({
      worker: async ({ session_id }: { session_id: string }) => ({
        id: Id.SessionId.make(session_id),
        role: "explore",
        outcome: "succeeded",
        busy: false,
        model: { providerID: "fixture", id: "fixture" },
        recent_messages: [],
        note: "Read-only worker evidence. Talk to Abra.",
      }),
      events: {
        subscribe: (_name: string, { signal }: { signal: AbortSignal }) => ({
          async *[Symbol.asyncIterator]() {
            if (signal.aborted) return;
            yield { data: { home: "/unrelated" } };
            await new Promise<void>((resolve) =>
              signal.addEventListener("abort", () => resolve(), { once: true }),
            );
          },
        }),
      },
      snapshot: async () => {
        if (failed) throw Error("fixture disconnected");
        return snapshot;
      },
      feedback: async (): Promise<FeedbackPage> => {
        feedbackReads++;
        return feedbackFixture(externalFeedback);
      },
      report: async () => {
        reportReads++;
        return {
          content: "## Retained research evidence\nValidated report available after retirement.",
        };
      },
      detail: async () => detail(),
      document: async ({ path }: { path: string }) => ({
        path,
        content: "## Design\nUse a validated token.\n",
      }),
      diff: async ({ file, scope }: { file?: string; scope: string }) => ({
        base: "a".repeat(40),
        head: "b".repeat(40),
        at: new Date().toISOString(),
        historical: false,
        limited: false,
        file: file ?? "auth.ts",
        files: [
          {
            path: "auth.ts",
            status: "modified",
            additions: 1,
            deletions: 1,
            binary: false,
            limited: false,
          },
          {
            path: "new.ts",
            status: "added",
            additions: 1,
            deletions: 0,
            binary: false,
            limited: false,
          },
        ],
        patch: `diff --git a/${file ?? "auth.ts"} b/${file ?? "auth.ts"}\n--- a/${file ?? "auth.ts"}\n+++ b/${file ?? "auth.ts"}\n@@ -1 +1 @@\n-const token = "old";\n+const token = "${scope === "all" ? "validated" : "local"}";\n`,
      }),
    }),
    session: {
      active: async () => {
        throw Error("AbraCode must use the host session store");
      },
    },
  },
  data: {
    session: {
      sync: async (id: string) => {
        synced.push(id);
        if (syncFailures.has(id)) throw Error("Sync unavailable");
      },
      status: () => (sessionRunning() ? "running" : "idle"),
      pending: { sync: async () => {}, list: () => (queued() ? [{}] : []) },
    },
    listen: (callback: typeof listener) => {
      listener = callback;
      return () => {
        stopped = true;
      };
    },
  },
  keymap: {
    shortcuts: (id: string) => [remaps.get(id) ?? (id.endsWith("back") ? "Esc" : "H")],
    layer: (factory: () => KeymapLayer) => {
      const initial = factory();
      commands.push(...(initial.commands ?? []));
      if (!initial.target) return;
      const renderer = (ctx as Context).renderer;
      const dispatch = (event: KeyEvent) => {
        const layer = factory();
        if (layer.enabled === false || (typeof layer.enabled === "function" && !layer.enabled()))
          return;
        let focus = renderer.currentFocusedRenderable;
        const target = layer.target?.();
        while (focus && focus !== target) focus = focus.parent;
        if (!target || focus !== target || event.ctrl || event.meta) return;
        const command = layer.commands?.find(
          (c) => ((c.id && remaps.get(c.id)) || c.bind) === event.name,
        );
        if (!command) return;
        event.preventDefault();
        event.stopPropagation();
        void command.run(undefined, event);
      };
      renderer.keyInput.on("keypress", dispatch);
      onCleanup(() => {
        renderer.keyInput.off("keypress", dispatch);
      });
    },
  },
  ui: {
    slot: (claim: SlotClaim) => {
      slots.push(claim);
      return () => {
        if (claim.append) disposedSlots.add(claim.append);
      };
    },
    router: {
      register: () => () => {},
      current: () => ({ type: "session", sessionID: "ses_supervisor" }),
      navigate: () => {},
    },
    panel: {
      open: (name: string) => {
        panelName = name;
        return true;
      },
      current: () => (panelName ? { name: panelName } : undefined),
    },
    tabs: {
      enabled: () => true,
      open: (id: string) => {
        opened.push(id);
        return true;
      },
      focus: (id: string) => {
        focused.push(id);
        return true;
      },
    },
    dialog: {
      select: async (input: { title: string }) =>
        input.title === "Changed files"
          ? "new.ts"
          : input.title === "Planning documents"
            ? "design.md"
            : input.title === "Filter by repository"
              ? "api"
              : "abra-1",
    },
    toast: { show: () => {} },
  },
} as unknown as Context;
const cleanup = await plugin.setup(ctx);
const sidebar = slots.find((s) => s.append === "sidebar.content")!;
const panel = slots.find((s) => s.append === "session.panel")!;
assert.ok(sidebar && panel);
const run = async (id: string) => {
  await commands.find((c) => c.id === id)!.run();
};
const publish = (type: string, data: object) =>
  listener({ details: { type, data } as OpenCodeEvent });

const mount = (render: () => ReturnType<typeof sidebar.render>, width = 90, height = 55) =>
  testRender(
    () => {
      (ctx as { renderer: Context["renderer"] }).renderer = useRenderer();
      return render();
    },
    { width, height },
  );
for (const name of ["home.footer.status", "prompt.footer.status"]) {
  const footer = slots.find((slot) => slot.append === name)!;
  assert.ok(footer, `Missing supported footer slot ${name}`);
  const frame = await mount(() => footer.render({} as never), 26, 4);
  try {
    await frame.waitForFrame((text) => text.includes("AbraCode") && text.includes("Talk to Abra"));
  } finally {
    frame.renderer.destroy();
  }
}
let screen = await mount(() => sidebar.render({ sessionID: "ses_explore-session" } as never), 34);
// Syntax highlighting completes outside the terminal frame queue.
const waitForMarkdown = (predicate: (frame: string) => boolean) => {
  const highlighting = (node: Renderable): Promise<void>[] => [
    ...(node instanceof CodeRenderable ? [node.highlightingDone] : []),
    ...node.getChildren().flatMap(highlighting),
  ];
  return screen.waitForFrame(async (frame) => {
    await Promise.all(highlighting(screen.renderer.root));
    return predicate(frame);
  });
};
const saveFrame = async (name: string) => {
  if (!process.env.ABRACODE_TUI_FRAME_DIR) return;
  await mkdir(process.env.ABRACODE_TUI_FRAME_DIR, { recursive: true });
  await writeFile(
    join(process.env.ABRACODE_TUI_FRAME_DIR, `${name}.txt`),
    screen.captureCharFrame(),
  );
  const lines = screen.captureSpans().lines.map((line) =>
    line.spans.map((span) => ({
      text: span.text,
      fg: span.fg.toInts(),
      bg: span.bg.toInts(),
      attributes: span.attributes,
    })),
  );
  await writeFile(join(process.env.ABRACODE_TUI_FRAME_DIR, `${name}.json`), JSON.stringify(lines));
};
const click = async (label: string) => {
  const lines = screen.captureCharFrame().split("\n");
  const row = lines.findIndex((line) => line.includes(label));
  assert.ok(row >= 0, `Missing ${label}:\n${lines.join("\n")}`);
  await screen.mockMouse.click(lines[row].indexOf(label) + 1, row);
};
try {
  const initial = await screen.waitForFrame(
    (frame) => frame.includes("abra-1") && frame.includes("Approve plan"),
  );
  assert.match(initial, /Work home/);
  assert.match(initial, /Add API authentication/);
  assert.doesNotMatch(initial, /Workers.*Spec|┌|└/);
  assert.deepEqual(opened, [], "Initial history should not open tabs");
  assert.ok(
    screen
      .captureSpans()
      .lines.flatMap((line) => line.spans)
      .some((span) => span.text.includes("Approve plan") && span.fg.equals(warning.base)),
  );
  await click("Add API authentication");
  assert.equal(panelName, "abracode.work");
  screen.resize(26, 40);
  await screen.waitForFrame((frame) => frame.includes("Work home") && frame.includes("abra-1"));
  await saveFrame("sidebar");
  failed = true;
  await run("abracode.refresh");
  await screen.waitForFrame(
    (frame) => frame.includes("Connection unavailable") && frame.includes("abra-1"),
  );
  failed = false;
  await run("abracode.refresh");
  screen.renderer.destroy();
  await run("abracode.work");
  screen = await mount(() =>
    panel.render({
      name: "abracode.work",
      sessionID: "ses_supervisor",
      close: () => {},
      toggleFullscreen: () => {},
      focused: false,
    } as never),
  );
  const home = await screen.waitForFrame(
    (frame) =>
      frame.includes("Needs you") &&
      frame.includes("Working") &&
      frame.includes("Blocked") &&
      frame.includes("Queued") &&
      frame.includes("Done"),
  );
  assert.doesNotMatch(home, /Repository setup/);
  await saveFrame("overview");
  const ticketButtonID = "abracode.ticket:home:abra-1";
  screen.renderer.root.findDescendantById(ticketButtonID)!.focus();
  snapshot = {
    ...snapshot,
    work: snapshot.work.map((w, i) => (i === 0 ? { ...w, phase: "applying" } : w)),
  };
  await run("abracode.refresh");
  await screen
    .waitFor(
      () =>
        screen.renderer.currentFocusedRenderable?.id === ticketButtonID &&
        !screen.renderer.currentFocusedRenderable.isDestroyed,
    )
    .catch((error) => {
      throw new Error("Focus after regrouping: " + screen.renderer.currentFocusedRenderable?.id, {
        cause: error,
      });
    });
  snapshot = {
    ...snapshot,
    work: snapshot.work.map((w, i) => (i === 0 ? { ...w, phase: "awaiting_plan_approval" } : w)),
  };
  await run("abracode.refresh");
  await screen.waitForFrame((frame) => frame.includes("Needs you"));
  screen.resize(90, 35);
  await screen.renderOnce();
  const findScroll = (node: Renderable): ScrollBoxRenderable | undefined =>
    node instanceof ScrollBoxRenderable ? node : node.getChildren().map(findScroll).find(Boolean);
  const scroller = findScroll(screen.renderer.root)!;
  scroller.scrollTop = 5;
  await screen.renderOnce();
  const homeScroll = scroller.scrollTop;
  assert.ok(homeScroll > 0);
  await run("abracode.find");
  await screen.waitForFrame((frame) => frame.includes("Ticket status"));
  await click("Home");
  await screen
    .waitFor(() => scroller.scrollTop === homeScroll)
    .catch((error) => {
      throw new Error(
        `Home scroll ${scroller.scrollTop} expected ${homeScroll}; saved ${JSON.stringify((memory.get("work-view-v3") as { scroll: object }).scroll)}`,
        { cause: error },
      );
    });
  scroller.scrollTop = 0;
  screen.resize(90, 55);
  await screen.renderOnce();

  await click("Done");
  await screen.waitForFrame((frame) => frame.includes("Repository setup"));
  await click("Find ticket");
  await screen.waitForFrame(
    (frame) =>
      frame.includes("Overview") && frame.includes("Diff") && frame.includes("Ticket status"),
  );
  assert.equal(feedbackReads, 0, "Feedback must remain lazy while opening overview");
  screen.resize(90, 85);
  await screen.waitForFrame((frame) => frame.includes("Feedback"));
  await click("Feedback");
  const feedbackFrame = await screen.waitForFrame(
    (frame) => frame.includes("Resolve the edge case") && frame.includes("GitHub reply"),
  );
  assert.match(feedbackFrame, /uncertain/);
  assert.match(feedbackFrame, /Submission unsubmitted/);
  assert.match(feedbackFrame, /preflight retry/);
  assert.match(feedbackFrame, /stale/);
  assert.match(feedbackFrame, /Reviewer request pending: reviewer/);
  const reads = feedbackReads;
  await screen.renderOnce();
  assert.equal(feedbackReads, reads, "Rendering must not read or mutate the forge");
  screen.resize(38, 85);
  await screen.waitForFrame((frame) => frame.includes("Resolve the edge case"));
  assert.ok(
    screen
      .captureCharFrame()
      .split("\n")
      .every((line) => line.length <= 38),
  );
  assert.match(screen.captureCharFrame(), /GitHub reviewers/);
  externalFeedback = true;
  await click("Refresh evidence");
  await screen.waitForFrame(
    (frame) => frame.includes("Custody external") && frame.includes("Answer owner: user"),
  );
  assert.match(screen.captureCharFrame(), /gate review/);
  screen.resize(90, 85);
  await screen.waitForFrame(
    (frame) => frame.includes("external-run-1") && frame.includes("Approve gate"),
  );
  externalFeedback = false;
  await click("Refresh evidence");
  await screen.waitForFrame((frame) => frame.includes("Resolve the edge case"));
  screen.resize(90, 55);
  await screen.waitForFrame((frame) => frame.includes("Plan"));
  await click("Plan");
  const proposal = await waitForMarkdown(
    (frame) =>
      frame.includes("Protect the API with authentication.") && frame.includes("API guide"),
  );
  assert.match(proposal, /custom-checks: ready/);
  assert.match(proposal, /Implementation tasks: 3\/7/);
  assert.match(proposal, /Require tokens for every request/);
  assert.match(proposal, /const auth = "required"/);
  assert.match(proposal, /Route.*Access/);
  assert.doesNotMatch(proposal, /## Why|\*\*tokens\*\*|\*every\*|\[API guide\]|```/);
  const hasStyle = (label: string, attribute: number) =>
    screen
      .captureSpans()
      .lines.flatMap((line) => line.spans)
      .some((span) => span.text.includes(label) && (span.attributes & attribute) !== 0);
  assert.ok(hasStyle("Why", TextAttributes.BOLD));
  assert.ok(hasStyle("tokens", TextAttributes.BOLD));
  assert.ok(hasStyle("every", TextAttributes.ITALIC));
  const headingUsesTheme = () =>
    screen
      .captureSpans()
      .lines.flatMap((line) => line.spans)
      .some((span) => span.text.includes("Why") && span.fg.equals(heading()));
  assert.ok(headingUsesTheme());
  setHeading(RGBA.fromHex("#ff8888"));
  await screen.waitFor(async () => {
    await waitForMarkdown((frame) => frame.includes("Why"));
    return headingUsesTheme();
  });
  await saveFrame("proposal");
  await click("Choose document");
  await waitForMarkdown((frame) => frame.includes("Use a validated token."));
  await click("Diff");
  await screen.waitForFrame(
    (frame) =>
      frame.includes("2 changed files") && frame.includes("auth.ts") && frame.includes("validated"),
  );
  await saveFrame("diff-unified");
  await click("Choose file");
  await screen.waitForFrame((frame) => frame.includes("new.ts") && frame.includes("validated"));
  await click("Uncommitted only");
  await screen.waitForFrame((frame) => frame.includes('"local"'));
  screen.resize(120, 55);
  await screen.waitForFrame((frame) => frame.includes("Unified   Split"));
  await click("Split");
  assert.equal(
    (memory.get("work-view-v3") as { diff_view: string }).diff_view,
    "split",
    "Split action updates view state",
  );
  const findDiff = (node: Renderable): DiffRenderable | undefined =>
    node instanceof DiffRenderable ? node : node.getChildren().map(findDiff).find(Boolean);
  assert.equal(
    findDiff(screen.renderer.root)?.view,
    "split",
    "Native renderer receives split mode",
  );
  await screen.waitForFrame((frame) =>
    frame.split("\n").some((line) => line.includes("local") && line.includes("old")),
  );
  await saveFrame("diff-split");
  screen.resize(34, 45);
  await screen.waitForFrame(
    (frame) => frame.includes("Home") && frame.includes("new.ts") && frame.includes("local"),
  );
  await saveFrame("diff-narrow");
  await click("Home");
  await screen.waitForFrame((frame) => frame.includes("Needs you"));
  screen.resize(90, 55);
  await screen.waitForFrame((frame) => frame.includes("Find ticket"));
  await click("Find ticket");
  await screen.waitForFrame((frame) => frame.includes("new.ts") && frame.includes("local"));
  await click("Workers");
  await screen.waitForFrame((frame) => frame.includes("Inspect worker"));
  remaps.set("abracode.panel.home", "g");
  screen.mockInput.pressKey("h");
  await screen.renderOnce();

  screen.mockInput.pressKey("g");
  await screen
    .waitForFrame((frame) => frame.includes("Find ticket"))
    .catch((error) => {
      throw new Error("H Home navigation", { cause: error });
    });
  await run("abracode.find");
  await screen.waitForFrame(
    (frame) => frame.includes("Workers") && frame.includes("Inspect worker"),
  );
  // Bare ESC is disambiguated on a native input timer, outside the frame queue.
  screen.mockInput.pressEscape();
  await new Promise((resolve) => setTimeout(resolve, 50));
  await screen
    .waitForFrame((frame) => frame.includes("Find ticket"))
    .catch((error) => {
      throw new Error("Escape Back navigation", { cause: error });
    });
  await run("abracode.find");

  await screen.waitForFrame(
    (frame) => frame.includes("explore") && frame.includes("Inspect worker"),
  );
  assert.ok(synced.includes("ses_apply-session"), "Off-screen sessions synchronize without focus");
  setSessionRunning(false);
  setQueued(true);
  await screen.waitForFrame((frame) => frame.includes("queued"));
  setQueued(false);
  await screen.waitForFrame((frame) => frame.includes("idle"));
  syncFailures.add("ses_explore-session");
  await run("abracode.refresh");
  await screen.waitForFrame((frame) => frame.includes("unavailable"));
  syncFailures.clear();
  setSessionRunning(true);
  await run("abracode.refresh");
  publish("session.text.delta", {
    sessionID: "ses_explore-session",
    delta: "Checking the middleware",
  });
  await screen.waitForFrame((frame) => frame.includes("Checking the middleware"));
  await click("Inspect worker");
  await Promise.resolve();
  await screen.waitForFrame((frame) => frame.includes("Read-only worker evidence"));
  assert.deepEqual(focused, [], "Worker inspection never opens a composer");
  snapshot = {
    ...snapshot,
    work: snapshot.work.map((w, i) =>
      i === 0
        ? {
            ...w,
            phase: "recovery_required",
            sessions: [
              ...w.sessions,
              { id: Id.SessionId.make("ses_review-session"), role: "review" },
            ],
          }
        : w,
    ),
  };
  await run("abracode.refresh");
  await screen.waitForFrame((frame) => frame.includes("Recovery required"));
  assert.deepEqual(opened, [], "Worker discovery never opens a chat tab");
  assert.deepEqual(focused, [], "Worker discovery preserves Abra focus");
  snapshot = {
    ...snapshot,
    work: snapshot.work.map((w, i) =>
      i === 0
        ? {
            ...w,
            policy: "research-only",
            phase: "completed",
            issue_status: "closed",
            report_available: true,
            scope: {
              schema_version: 1,
              revision: 1,
              fingerprint: Id.Fingerprint.make("a".repeat(64)),
              contract: {
                goal: "Investigate source",
                acceptance: ["Retain findings"],
                constraints: ["Read only"],
              },
            },
            report: {
              schema_version: 1,
              issue_id: w.issue_id,
              execution_id: Id.ExecutionId.make("research-execution"),
              report_id: Id.ReportId.make("findings"),
              session_id: Id.SessionId.make("ses_explore-session"),
              base_commit: Id.Commit.make("a".repeat(40)),
              scope_fingerprint: Id.Fingerprint.make("a".repeat(64)),
              hash: Id.ContentHash.make("b".repeat(64)),
              bytes: 100,
              path: Id.AbsolutePath.make("/fixture/.abracode/reports/abra-1/findings.md"),
            },
          }
        : w,
    ),
  };
  screen.resize(90, 55);
  await run("abracode.refresh");
  await click("Plan");
  await screen.waitForFrame((frame) => frame.includes("Research contract and report"));
  assert.doesNotMatch(screen.captureCharFrame(), /Planning artifacts:|Implementation tasks:/);
  assert.equal(reportReads, 0);
  await click("Open retained report");
  await screen.waitForFrame((frame) => frame.includes("Retained research evidence"));
  assert.equal(reportReads, 1);
  failed = true;
  await run("abracode.refresh");
  assert.equal((memory.get("work-view-v3") as { error?: string }).error, "fixture disconnected");
  await screen.waitForFrame(
    (frame) =>
      frame.includes("Connection unavailable") && frame.includes("Retained research evidence"),
  );
  failed = false;
  await run("abracode.refresh");
  await click("Show scope");
  await screen.waitForFrame((frame) => frame.includes("Read the source"));
  snapshot = {
    ...snapshot,
    work: snapshot.work.map((w, i) =>
      i === 0
        ? {
            ...w,
            issue_status: "in_progress",
            phase: "awaiting_merge",
            policy: "lightweight-fix",
            report_available: false,
            report: undefined,
            active_role: undefined,
            delivery_wait: {
              category: "waiting",
              code: Id.ErrorCode.make("CI_PENDING"),
              reason: "Required build pending",
              owner: "CI",
              fingerprint: Id.Commit.make("a".repeat(40)),
              attempts: 1,
              observed_at: 0,
              next_check_at: 30000,
            },
            decisions: [],
            attention: [],
            waits: [],
          }
        : w,
    ),
  };
  await run("abracode.refresh");
  await click("Overview");
  await screen.waitForFrame((frame) => frame.includes("Required build pending"));
  assert.doesNotMatch(screen.captureCharFrame(), /Recovery required/);
  snapshot = {
    ...snapshot,
    work: snapshot.work.map((w, i) =>
      i === 0
        ? {
            ...w,
            decisions: [
              {
                schema_version: 1,
                key: Id.ObligationKey.make("storage"),
                generation: 0,
                scope: "Persistence",
                question: "Choose storage format",
                owner: "user",
                session_id: Id.SessionId.make("ses_apply-session"),
                opened_at: 0,
                status: "open",
              },
            ],
            progress: {
              schema_version: 1,
              generation: 0,
              session_id: Id.SessionId.make("ses_apply-session"),
              source: "worker",
              at: 500,
              summary: "Inspected serializers",
            },
          }
        : w,
    ),
  };
  await run("abracode.refresh");
  await screen.waitForFrame(
    (frame) => frame.includes("Choose storage format") && frame.includes("user"),
  );
  snapshot = {
    ...snapshot,
    work: snapshot.work.map((w, i) =>
      i === 0
        ? {
            ...w,
            decisions: [],
            delivery_wait: undefined,
            waits: [
              {
                schema_version: 1,
                key: Id.ObligationKey.make("dependency"),
                generation: 0,
                kind: "dependency",
                reference: Id.IssueId.make("abra-2"),
                condition: "Deployment finished",
                owner: "release owner",
                expires_in_ms: 1000,
                session_id: Id.SessionId.make("ses_apply-session"),
                started_at: 0,
                expires_at: 1000,
                next_check_at: 1000,
                status: "expired",
              },
            ],
          }
        : w,
    ),
  };
  await run("abracode.refresh");
  await screen.waitForFrame(
    (frame) => frame.includes("release owner") && frame.includes("expired"),
  );
  snapshot = {
    ...snapshot,
    work: snapshot.work.map((w, i) =>
      i === 0
        ? {
            ...w,
            waits: [],
            attention: [
              {
                schema_version: 1,
                id: Id.IncidentId.make("incident-native"),
                key: "stall",
                generation: 0,
                code: "suspected_stall",
                evidence: "No meaningful progress",
                created_at: 1000,
                status: "admitted",
                attempts: 1,
                session_id: Id.SessionId.make("ses_supervisor"),
                prompt_id: Id.MessageId.make("msg_diagnostic-turn"),
              },
            ],
            rounds: [
              {
                id: Id.RoundId.make("round-native"),
                ordinal: 1,
                source: "review",
                starting_head: Id.Commit.make("a".repeat(40)),
                instructions: "Correct the accepted edge case",
                finding_count: 1,
              },
            ],
            policy_summary: {
              plan_approval: true,
              merge_approval: true,
              merge_method: "merge",
              ci_policy: "required",
              repair_rounds: 1,
              diagnostic_turns: 1,
            },
          }
        : w,
    ),
  };
  await run("abracode.refresh");
  await screen.waitForFrame(
    (frame) => frame.includes("suspected stall") && frame.includes("admitted"),
  );
  await click("Plan");
  await screen.waitForFrame(
    (frame) => frame.includes("Round 1") && frame.includes("repair budget 1"),
  );
  snapshot = {
    ...snapshot,
    work: snapshot.work.map((w, i) =>
      i === 0
        ? {
            ...w,
            rounds: [
              ...w.rounds!,
              { ...w.rounds![0], id: Id.RoundId.make("round-native-2"), ordinal: 2 },
            ],
            policy_summary: { ...w.policy_summary!, repair_rounds: 2 },
          }
        : w,
    ),
  };
  await run("abracode.refresh");
  await screen.waitForFrame(
    (frame) =>
      frame.includes("Round 1") && frame.includes("Round 2") && frame.includes("repair budget 2"),
  );
  screen.resize(26, 40);
  await screen.renderOnce();
  assert.ok(screen.captureCharFrame().includes("Lightweight scope"));
  assert.match(screen.captureCharFrame(), /Round 2/);
  screen.resize(90, 55);
  await screen.renderOnce();
  await click("Home");
  await screen.waitForFrame((frame) => frame.includes("Registry health checks"));
  await click("Search titles");
  await screen.mockInput.typeText("health");
  await screen.waitForFrame(
    (frame) =>
      frame.includes("Registry health checks") && !frame.includes("Add API authentication"),
  );
  // Typing 'h' must not invoke Home or leave the search box.
  assert.ok(screen.captureCharFrame().includes("health"));
  snapshot = { ...snapshot, work: [] };
  await run("abracode.refresh");
  await screen.waitForFrame((frame) => frame.includes("No open work"));
} finally {
  screen.renderer.destroy();
  await cleanup?.();
}
assert.ok(stopped, "Plugin unload stops its event listener");
assert.ok(
  disposedSlots.has("home.footer.status") && disposedSlots.has("prompt.footer.status"),
  "Plugin unload removes both branding slots",
);
console.log("Native sidebar checks passed");
