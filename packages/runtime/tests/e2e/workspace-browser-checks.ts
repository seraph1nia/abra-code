import { mixedDiagrams, denseFlowchart, longSequence } from "../helpers/diagram-fixtures.ts";
import { sampleFixtureMemory } from "../helpers/process-memory.ts";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdir, readFile } from "node:fs/promises";
import { Effect } from "effect";
import { NativeWebBackend } from "../../src/web/backend.ts";
import type { WorkspaceJourneyInput } from "./workspace.ts";
import type { WorkspaceBootstrap } from "./workspace-bootstrap-checks.ts";
export interface DiagramEvidence {
  diagramPerformance?: Record<string, unknown>;
}
export async function checkWorkspacePresentations(
  input: WorkspaceJourneyInput,
  backend: NativeWebBackend,
  origin: string,
  { page, chatFromAttention, command, issue, population }: WorkspaceBootstrap,
  evidence: DiagramEvidence,
) {
  const board = {
    surface_id: "workspace-board",
    source: `root = Column([Text("Native workspace coding journey"), Kanban(issueIds=[${JSON.stringify(issue)}], mode="live")])`,
  };
  const checked = await command("abra_render_ui", { ...board, validate_only: true });
  assert.deepEqual(checked, { validated: true, surface_id: board.surface_id });
  await assert.rejects(
    command("abra_render_ui", { ...board, source: "root = UnknownWidget()" }),
    /UnknownWidget/,
  );
  await assert.rejects(command("abra_render_ui", { surface: {} }), /surface_id|source|required/i);
  assert.equal((await Effect.runPromise(backend.snapshot)).surfaces.length, 0);
  const published = await command("abra_render_ui", board);
  assert.equal(published.revision, 1);
  await page.getByText("Native workspace coding journey", { exact: true }).waitFor();
  const openLayout = async (revision: number) => {
    await chatFromAttention();
    await page
      .locator(`.transcript [data-surface-reference="workspace-board/${revision}"]`)
      .getByRole("button", { name: /Open board|Open comparison/ })
      .click();
    await page
      .locator(
        `.inspector [data-surface-reference="workspace-board/${revision}"] [data-a2ui-renderer="upstream"]`,
      )
      .waitFor();
  };
  await openLayout(1);
  assert.equal(await page.locator('[data-a2ui-renderer="upstream"]').count(), 1);
  await page.getByRole("button", { name: "Close inspector" }).click();
  const reviewSource = await command("abra_review_ui", {
    action: "source",
    source: { kind: "surface", surface_id: "workspace-board", revision: 1 },
  });
  const nativeReview = await command("abra_review_ui", {
    action: "publish",
    review: {
      review_id: "workspace-feedback",
      title: "Native plan feedback",
      source: reviewSource.source,
      fields: [
        {
          component: "MultiSelect",
          id: "features",
          label: "Native feature selection",
          required: true,
          options: [{ value: "focused", label: "Focused first release" }],
        },
        { component: "CommentField", id: "comments", label: "Native review comments" },
      ],
    },
  });
  const reviewPanel = page
    .locator('[data-review-reference="workspace-feedback/1"] .interactive-review')
    .first();
  await reviewPanel.getByRole("checkbox", { name: "Focused first release", exact: true }).check();
  await reviewPanel
    .getByRole("textbox", { name: "Native review comments", exact: true })
    .fill("Keep this release focused.");
  const reviewAdmission = page.waitForResponse(
    (response) => response.url() === `${origin}/api/review/submit`,
  );
  await reviewPanel.getByRole("button", { name: "Send feedback to Abra", exact: true }).click();
  const reviewResponse = await reviewAdmission;
  assert.equal(reviewResponse.status(), 200, await reviewResponse.text());
  const nativeFeedback = await reviewResponse.json();
  assert.equal(nativeFeedback.status, "admitted");
  assert.equal(nativeFeedback.review_id, nativeReview.review_id);
  await input.client.session.wait({ sessionID: input.session });
  await command("abra_review_ui", {
    action: "publish",
    review: {
      review_id: "workspace-feedback",
      title: "Revised native plan feedback",
      source: reviewSource.source,
      responds_to: nativeFeedback.request_id,
      fields: [{ component: "CommentField", id: "comments", label: "Native review comments" }],
    },
  });
  await page
    .getByRole("heading", { name: "Revised native plan feedback", exact: true })
    .first()
    .waitFor();

  const diagramFixtures = mixedDiagrams();
  const verifierInput = {
    diagrams: diagramFixtures.map((d, i) => ({ id: `diagram${i}`, source: d.source })),
  };
  const stopMemory = await sampleFixtureMemory();
  const coldStart = performance.now();
  let memory;
  const cold = await command("abra_mermaid_verify", verifierInput).finally(async () => {
    memory = await stopMemory();
  });
  const coldMs = performance.now() - coldStart;
  assert.equal(cold.verified, true, JSON.stringify(cold));
  assert.equal(cold.results.length, 32);
  assert.ok(coldMs < 60000);
  const warmStart = performance.now();
  const warm = await command("abra_mermaid_verify", verifierInput);
  const warmMs = performance.now() - warmStart;
  assert.equal(warm.metrics.compilations, 0);
  const larger = await command("abra_mermaid_verify", {
    diagrams: [
      { id: "dense", source: denseFlowchart },
      { id: "sequence", source: longSequence },
    ],
  });
  assert.equal(larger.verified, true, JSON.stringify(larger));
  await assert.rejects(
    command("abra_mermaid_verify", {
      diagrams: [...verifierInput.diagrams, { id: "overflow", source: "flowchart LR\nA --> B" }],
    }),
    /32|maxLength/,
  );
  evidence.diagramPerformance = {
    node: process.version,
    package_manager: JSON.parse(await readFile(join(input.home, "package.json"), "utf8"))
      .packageManager,
    compiler: cold.compiler,
    count: 32,
    cold_ms: coldMs,
    warm_ms: warmMs,
    cold: cold.metrics,
    warm: warm.metrics,
    memory,
    dense_nodes: 100,
    sequence_messages: 50,
  };
  const widgets = [
    "WorkTable",
    "StatusSummary",
    "Kanban",
    "DependencyGraph",
    "Timeline",
    "DecisionSummary",
  ];
  const workViews = widgets.map((widget, i) => {
    const id = widget === "WorkTable" ? population.offPage.id : issue;
    return `${widget}(issueIds=[${JSON.stringify(id)}], mode="${i % 2 ? "snapshot" : "live"}")`;
  });
  const diagrams = diagramFixtures.map(
    (d) => `Mermaid(${JSON.stringify(d.title)}, ${JSON.stringify(d.source)})`,
  );
  await command("abra_render_ui", {
    surface_id: board.surface_id,
    source: `root = Column([
        Text("Revised upstream work view"),
        Row([WorkTable(mode="snapshot"), ${workViews.join(", ")}]),
        ReportLink(${JSON.stringify(issue)}),
        ResourceLink("Inspect execution changes", {action:"open_changes", issue_id:${JSON.stringify(issue)}}),
        ${diagrams.join(", ")}
      ])`,
  });
  await page
    .locator(".transcript")
    .getByText("Revised upstream work view", { exact: true })
    .waitFor();
  await openLayout(2);
  await page
    .locator('[data-surface-reference="workspace-board/2"] [data-diagram-state="ready"]')
    .nth(31)
    .waitFor();
  assert.equal(
    await page
      .locator('[data-surface-reference="workspace-board/2"] [data-diagram-state="ready"]')
      .count(),
    32,
  );
  assert.ok(
    (await Effect.runPromise(backend.snapshot)).surfaces.every((entry) => !("surface" in entry)),
    "Native workspace feeds carry compact surface references, never layout/data bodies",
  );
  await page
    .locator('[data-surface-reference="workspace-board/1"]')
    .getByText("Native workspace coding journey", { exact: true })
    .waitFor();
  assert.equal(await page.locator(".generated-surface").count(), 1);
  assert.equal(
    await page.locator('[data-surface-reference="workspace-board/2"] .surface-widget').count(),
    9,
  );
  const exact = await Effect.runPromise(backend.surface("workspace-board", 2));
  assert.ok(!("unavailable" in exact));
  assert.ok(exact.snapshot.some((row) => row.issue_id === population.companion));
  assert.equal(exact.snapshot.length, 57);
  assert.equal(exact.coverage?.total, 57);
  assert.equal(
    (await Effect.runPromise(backend.snapshot)).work.work.some(
      (row) => row.issue_id === population.offPage.id,
    ),
    false,
  );
  await page
    .locator('[data-surface-reference="workspace-board/2"] [data-work-widget="WorkTable"]')
    .filter({ hasText: "Live work graph" })
    .getByRole("button", { name: population.offPage.title, exact: true })
    .waitFor();
  await page.reload();
  await page
    .locator(".transcript")
    .getByText("Revised upstream work view", { exact: true })
    .waitFor();
  await page.locator(".inspector .generated-surface").waitFor();
  assert.equal(await page.locator(".generated-surface").count(), 1);
  const beforeNavigation = (
    await input.client.session.context({ sessionID: input.session })
  ).filter((message) => message.type === "user").length;
  await page.getByRole("button", { name: "Inspect execution changes", exact: true }).click();
  await page
    .getByRole("tablist", { name: "Work details", exact: true })
    .getByRole("tab", { name: "Diff", exact: true, selected: true })
    .waitFor();
  await page.goBack();
  await page.getByRole("button", { name: "Open retained reports", exact: true }).click();
  await page
    .getByRole("tablist", { name: "Work details", exact: true })
    .getByRole("tab", { name: "Reports", exact: true, selected: true })
    .waitFor();
  assert.equal(
    (await input.client.session.context({ sessionID: input.session })).filter(
      (message) => message.type === "user",
    ).length,
    beforeNavigation,
    "Trusted A2UI links must not admit prompts",
  );
  await assert.rejects(
    command("abra_render_ui", {
      surface_id: board.surface_id,
      source: `root = ResourceLink("Foreign session", {action:"open_session", issue_id:${JSON.stringify(issue)}, session_id:${JSON.stringify(input.session)}})`,
    }),
    /retained execution|does not own/i,
  );
  assert.ok(
    !("unavailable" in (await Effect.runPromise(backend.surface("workspace-board", 2)))),
    "Rejected link publication preserves the previous immutable revision",
  );
  if (input.evidence) {
    await mkdir(input.evidence, { recursive: true });
    await page.screenshot({ path: join(input.evidence, "native-work-view.png"), fullPage: true });
  }
  return { openLayout, nativeFeedback };
}
export type WorkspacePresentations = Awaited<ReturnType<typeof checkWorkspacePresentations>>;
