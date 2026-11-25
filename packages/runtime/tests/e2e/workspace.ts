import { advanceAfterIdle, NativeWorkspaceCommandError } from "../helpers/workspace-advance.ts";
import { mixedDiagrams, denseFlowchart, longSequence } from "../helpers/diagram-fixtures.ts";
import { sampleFixtureMemory } from "../helpers/process-memory.ts";
import { HttpAgent } from "@ag-ui/client";
import { SqliteWorkGraph } from "../../src/work/graph.ts";
import { ExecutionId, RepositoryId } from "@abracode/contracts/identities";
import { DecisionsSchema } from "@abracode/contracts/web/http-api";
import { MessagesPageSchema, FeedbackPageSchema } from "@abracode/contracts/web/wire";
import { WorkerHistoryPageSchema } from "@abracode/contracts/web/worker-history";
import { DocumentArtifactSchema } from "@abracode/contracts/web/wire";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Deferred, Effect, Exit, Fiber, Scope, Schema } from "effect";
import { FileLocks } from "../../src/storage/lock.ts";
import { LockKey } from "@abracode/contracts/identities";
import { OpenCode } from "@opencode/client";
import type { Endpoint } from "@opencode/client/effect/service";
import {
  AbsolutePath,
  IssueId,
  RequestId,
  ContentHash,
  SessionId,
} from "@abracode/contracts/identities";
import { NativeWebBackend } from "../../src/web/backend.ts";
import { workspaceServer } from "../../src/web/server.ts";
import { launchReportBrowser } from "@abracode/report-export/browser";

type Native = ReturnType<typeof OpenCode.make>;

/** Keep one actual native admission/restart check; history-window UI matrices
 * belong to the browser and admission unit tests. */
async function prepareAdmissionRecovery(
  input: Parameters<typeof workspaceJourney>[0],
  backend: NativeWebBackend,
) {
  const original = (await Effect.runPromise(backend.snapshot)).receipts.find(
    (receipt) => receipt.status === "admitted",
  );
  assert.ok(original);
  return async () => {
    assert.deepEqual(await Effect.runPromise(backend.receipt(original.request_id)), original);
    return { request_id: original.request_id, native_restart: true };
  };
}

/** Historical rows are disposable fixture data, not delivery/controller proof. */
async function bindingPopulation(home: string) {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const graph = yield* SqliteWorkGraph.open(
          AbsolutePath.make(join(home, ".abracode/work.sqlite")),
        );
        const closed: { id: IssueId; title: string }[] = [];
        for (let i = 0; i < 55; i++) {
          const issue = yield* graph.create({
            repository_id: RepositoryId.make("workspace"),
            request_id: RequestId.make(`fixture-history-${i}`),
            title: `Historical native task ${i}`,
            description: "Disposable historical row for binding coverage",
            priority: 4,
            dependencies: [],
          });
          const actor = ExecutionId.make(`fixture-history-${i}`);
          yield* graph.claim(issue.id, actor);
          yield* graph.close(issue.id, actor);
          closed.push({ id: issue.id, title: issue.title });
        }
        const companion = yield* graph.create({
          repository_id: RepositoryId.make("workspace"),
          request_id: RequestId.make("fixture-companion"),
          title: "Second observed native task",
          description: "Disposable bounded binding companion",
          priority: 4,
          dependencies: [],
        });
        const actor = ExecutionId.make("fixture-companion");
        yield* graph.claim(companion.id, actor);
        yield* graph.block(companion.id, actor, "Fixture stays outside automatic execution");
        return {
          companion: companion.id,
          offPage: closed.sort((a, b) => a.id.localeCompare(b.id)).at(-1)!,
        };
      }),
    ),
  );
}

export async function workspaceJourney(input: {
  home: string;
  project: string;
  session: string;
  endpoint: Endpoint;
  client: Native;
  restart: () => Promise<void>;
  providerCount: () => number;
  streaming: { hold: () => void; release: (kind: "tool" | "text") => void };
  readStatus: (id: string) => Promise<any>;
  evidence?: string;
}) {
  let diagramPerformance: Record<string, unknown> | undefined;
  const scope = await Effect.runPromise(Scope.make());
  const backend = new NativeWebBackend(
    AbsolutePath.make(input.home),
    input.session,
    Effect.succeed(input.endpoint),
  );
  const web = await Effect.runPromise(
    workspaceServer({ port: 0, backend, assets: join(input.home, "apps/web/dist") }).pipe(
      Effect.provideService(Scope.Scope, scope),
    ),
  );
  const browser = await launchReportBrowser();
  const nativeTrace: {
    type: string;
    id?: string;
    busy?: boolean;
    repair?: boolean;
    sequence?: number;
  }[] = [];
  const observeNative = backend.nativeEvent;
  backend.nativeEvent = (event) => {
    const result = observeNative(event);
    nativeTrace.push({
      type: event.type,
      id: event.id,
      busy: result.view?.busy,
      repair: result.repair,
      sequence: event.durable?.seq,
    });
    return result;
  };
  const partialBeforeRelease = { tool: false, text: false };
  const observers: { agent: HttpAgent; done: Promise<void>; events: string[]; errors: string[] }[] =
    [];
  async function attachObserver() {
    const agent = new HttpAgent({
      url: `${web.origin}/api/copilotkit/agent/abra/connect`,
      headers: { origin: web.origin },
      agentId: "abra",
      threadId: input.session,
    });
    let ready!: () => void;
    const baseline = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const events: string[] = [],
      errors: string[] = [];
    const done = agent
      .runAgent(
        {},
        {
          onMessagesSnapshotEvent: ({ event }) => {
            ready();
            for (const message of event.messages) {
              if (message.role !== "assistant") continue;
              if (
                typeof message.content === "string" &&
                message.content.includes("Streaming native text") &&
                !message.content.includes("completed.")
              ) {
                partialBeforeRelease.text = true;
                input.streaming.release("text");
              }
              for (const call of message.toolCalls ?? [])
                if (call.id === "call_workspace_stream") {
                  partialBeforeRelease.tool = true;
                  input.streaming.release("tool");
                }
            }
          },
          onTextMessageContentEvent: ({ event }) => {
            events.push("text");
            if (event.delta.includes("Streaming native text")) {
              partialBeforeRelease.text = true;
              input.streaming.release("text");
            }
          },
          onToolCallStartEvent: ({ event }) => {
            if (event.toolCallId === "call_workspace_stream") {
              partialBeforeRelease.tool = true;
              input.streaming.release("tool");
            }
          },
          onToolCallArgsEvent: ({ event }) => {
            events.push("arguments");
            if (event.toolCallId === "call_workspace_stream" && event.delta) {
              partialBeforeRelease.tool = true;
              input.streaming.release("tool");
            }
          },
          onToolCallResultEvent: () => {
            events.push("result");
          },
        },
      )
      .then(() => undefined)
      .catch((error) => {
        errors.push(String(error));
      });
    const observer = { agent, done, events, errors };
    observers.push(observer);
    await Promise.race([
      baseline,
      done.then(() => {
        throw new Error(`Native observer ended before baseline: ${errors.join("; ")}`);
      }),
    ]);
    return observer;
  }

  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const beforeSettings = input.providerCount();
    await page.goto(`${web.origin}/settings`);
    await page.getByText("6 agents defined", { exact: true }).waitFor();
    assert.equal(await page.locator(".agent-definition").count(), 6);
    await page.getByLabel("Inspect project-lead", { exact: true }).click();
    await page.getByText("Inline instructions", { exact: true }).waitFor();
    await page
      .locator(".agent-instruction-content")
      .filter({ hasText: "You are a controller-managed project lead." })
      .waitFor();
    await page.getByLabel("Inspect explore", { exact: true }).click();
    await page
      .locator(".agent-instruction-content")
      .filter({ hasText: "You are Explore." })
      .waitFor();
    assert.equal(input.providerCount(), beforeSettings, "Settings must not call the model");
    await page.getByRole("link", { name: "Back to workspace" }).click();
    await page
      .getByRole("textbox", { name: "Message Abra" })
      .waitFor({ timeout: 10000 })
      .catch((cause: unknown) => {
        throw new Error(`Workspace did not mount; browser errors: ${JSON.stringify(errors)}`, {
          cause,
        });
      });
    await attachObserver();
    let secondObserver = await attachObserver();
    input.streaming.hold();
    let ordinal = 0;
    async function chatFromAttention() {
      if (new URL(page.url()).pathname !== "/attention") return;
      const chat = page.getByRole("link", { name: "Chat", exact: true });
      if (!(await chat.isVisible())) await page.getByText("Destinations", { exact: true }).click();
      await chat.click();
    }
    async function command(tool: string, args: Record<string, unknown>, question?: string) {
      await chatFromAttention();
      const text =
        question ??
        `AbraCode workspace operation ${JSON.stringify({ tool, args, ordinal: ++ordinal })}`;
      await page.getByRole("textbox", { name: "Message Abra" }).fill(text);
      await page.getByRole("button", { name: "Send message", exact: true }).click();
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        const context = await input.client.session.context({ sessionID: input.session });
        const index = context.findIndex((m) => m.type === "user" && m.text === text);
        if (index >= 0) {
          const call = context
            .slice(index + 1)
            .flatMap((m) =>
              m.type === "assistant"
                ? m.content.filter((c) => c.type === "tool" && c.name === tool)
                : [],
            )
            .at(-1);
          if (call?.type === "tool" && call.state.status === "error") {
            await input.client.session.wait({ sessionID: input.session });
            if (call.state.error.message.startsWith("LOCKED:"))
              return { category: "operation_in_progress" };
            throw new NativeWorkspaceCommandError(tool, call.state.error.message);
          }
          if (call?.type === "tool" && call.state.status === "completed") {
            const content = call.state.content.find((c) => c.type === "text");
            assert.ok(content?.type === "text");
            await input.client.session.wait({ sessionID: input.session });
            return JSON.parse(content.text).result;
          }
        }
        await new Promise((done) => setTimeout(done, 100));
      }
      throw new Error(
        `Browser command did not settle: ${tool}; ${JSON.stringify(await page.locator('[role="alert"]').allTextContents())}; ${JSON.stringify((await Effect.runPromise(backend.snapshot.pipe(Effect.map(() => backend.nativeSnapshot()!.messages)))).slice(-8).map((message) => ({ id: message.id, role: message.role, text: message.text.slice(0, 180), tools: message.tools?.map((tool) => ({ name: tool.name, status: tool.status })) })))}`,
      );
    }
    await command("abra_project_onboard", {
      id: "workspace",
      path: input.project,
      action: "register",
      plan_approval: true,
      merge_approval: true,
      delivery: "branch",
      verification: [
        [
          process.execPath,
          "-e",
          'if(require("fs").readFileSync("source.txt","utf8")!=="sample\\n")process.exit(1)',
        ],
      ],
    });
    const created = await command("abra_work_create", {
      repository_id: "workspace",
      title: "Browser implementation acceptance",
      description:
        "Implement the sample behavior through the single AbraCode workspace. workspace-frontend-acceptance",
      request_id: "workspace-intake",
    });
    const issue = created.issue.id as string;
    const population = await bindingPopulation(input.home);
    // Real OpenCode RPC error envelopes must reach the HTTP report empty state.
    for (const issueID of [issue, population.companion]) {
      const report = await fetch(`${web.origin}/api/work/report?issue_id=${issueID}`);
      assert.equal(report.status, 200);
      assert.deepEqual(await report.json(), { unavailable: "not_started" });
    }
    assert.equal(
      (await fetch(`${web.origin}/api/work/report?issue_id=abra-unknown-report`)).status,
      404,
    );
    const answer = await command("abra_work_list", {}, "What AbraCode work is currently retained?");
    assert.ok(answer.issues.some((item: { id: string }) => item.id === issue));
    await page
      .locator('[data-tool-call-id] [data-presentation="task"]')
      .filter({ hasText: "Browser implementation acceptance" })
      .last()
      .waitFor();
    const observed = (
      await Effect.runPromise(
        backend.snapshot.pipe(Effect.map(() => backend.nativeSnapshot()!.messages)),
      )
    ).find((message) =>
      message.tools?.some(
        (tool) =>
          tool.name === "abra_work_create" &&
          tool.presentation?.kind === "tasks" &&
          tool.presentation.tasks.some((task) => task.issue_id === issue),
      ),
    );
    assert.ok(observed, "Native tool result must have a typed task presentation");
    // A bounded work read may fail during a commit. Chat must still bootstrap,
    // keep known work visible and clearly label it until a valid capture returns.
    async function availableWork() {
      const deadline = Date.now() + 10000;
      while (true) {
        const snapshot = await Effect.runPromise(backend.snapshot);
        if (
          !snapshot.work_unavailable &&
          snapshot.work.work.some((work) => work.issue_id === issue)
        )
          return snapshot;
        assert.ok(
          Date.now() < deadline,
          "A valid work observation must recover after commit release",
        );
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    await availableWork();
    const locks = new FileLocks(AbsolutePath.make(join(input.home, ".abracode/locks")));
    const entered = Deferred.makeUnsafe<void>();
    const release = Deferred.makeUnsafe<void>();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const blocker = yield* locks
            .with(LockKey.make("controller"), () =>
              Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))),
            )
            .pipe(Effect.forkScoped);
          yield* Deferred.await(entered);
          const unavailable = yield* backend.snapshot;
          assert.match(unavailable.work_unavailable ?? "", /temporarily unavailable/);
          assert.ok(
            backend.nativeSnapshot()!.messages.some((message) => message.id === observed.id),
          );
          assert.ok(unavailable.work.work.some((work) => work.issue_id === issue));
          yield* Effect.promise(async () => {
            await page.reload();
            await page.getByRole("textbox", { name: "Message Abra", exact: true }).waitFor();
            await page
              .getByRole("alert")
              .filter({ hasText: "Retained work is temporarily unavailable" })
              .waitFor();
          });
          yield* Deferred.succeed(release, undefined);
          yield* Fiber.join(blocker);
        }),
      ),
    );
    await availableWork();
    await page.reload();
    await page
      .getByRole("alert")
      .filter({ hasText: "Retained work is temporarily unavailable" })
      .waitFor({ state: "hidden" });
    const observedCall = observed.tools!.find((tool) => tool.name === "abra_work_create")!;
    const nativeCard = () =>
      page.locator(
        `[data-native-message-id="${observed.id}"] [data-tool-call-id="${observedCall.id}"] [data-presentation="task"]`,
      );
    await nativeCard().getByRole("button", { name: "Inspect task", exact: true }).waitFor();
    const userMessages = (await input.client.session.context({ sessionID: input.session })).filter(
      (message) => message.type === "user",
    ).length;
    await nativeCard().getByRole("button", { name: "Inspect task", exact: true }).click();
    await page
      .getByRole("tablist", { name: "Work details", exact: true })
      .getByRole("tab", { name: "Overview", exact: true, selected: true })
      .waitFor();
    assert.equal(
      (await input.client.session.context({ sessionID: input.session })).filter(
        (message) => message.type === "user",
      ).length,
      userMessages,
      "Read-only card inspection must not admit native prompts",
    );
    await secondObserver.agent.detachActiveRun();
    await secondObserver.done;
    secondObserver = await attachObserver();
    await page.reload();
    await nativeCard().waitFor();
    assert.equal(
      await nativeCard().locator("xpath=ancestor::*[@data-native-renderer='copilotkit']").count(),
      1,
    );
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
      (response) => response.url() === `${web.origin}/api/review/submit`,
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
    diagramPerformance = {
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
    await command("abra_work_start", { issue_id: issue });
    const approved = new Set<string>();
    let savedReport: { request_id: string; hash: string; url: string } | undefined;
    let exportedReport:
      | {
          request_id: string;
          document_hash: string;
          exporter_hash: string;
          hash: string;
          bytes: number;
        }
      | undefined;
    let composedReport: { request_id: string; hash: string } | undefined;
    const deadline = Date.now() + 120000;
    let lastAdvance = 0;
    while (Date.now() < deadline) {
      const status = await input.readStatus(issue);
      const state = status.execution;
      if (state.current_phase === "completed") {
        assert.ok(
          approved.has("plan"),
          "Branch delivery must retain the browser's human plan authorization",
        );
        assert.equal(status.issue.status, "closed");
        assert.equal(status.outcome.cleanup.state, "retired");
        assert.equal(status.outcome.closure, "closed");
        assert.ok(savedReport);
        assert.ok(composedReport);
        assert.ok(exportedReport);
        const restoreAdmission = await prepareAdmissionRecovery(input, backend);
        await input.restart();
        const admissionRecovery = await restoreAdmission();
        await page.goto(savedReport.url);
        await page.locator(".frozen-report").waitFor();
        await page.locator('.frozen-report [data-diagram-state="ready"]').nth(31).waitFor();
        const concurrent = await Effect.runPromise(
          Effect.forEach(
            [0, 1],
            () =>
              backend.prepareDiagrams({
                kind: "report",
                issue_id: IssueId.make(issue),
                request_id: RequestId.make(savedReport!.request_id),
                hash: ContentHash.make(savedReport!.hash),
              }),
            { concurrency: 2 },
          ),
        );
        assert.ok(concurrent.every((value) => value.verified && value.metrics?.compilations === 0));
        if (diagramPerformance)
          diagramPerformance.concurrent_warm = concurrent.map((value) => value.metrics);
        const restored = Schema.decodeSync(DocumentArtifactSchema)(
          await Effect.runPromise(
            backend.work["artifactDocument"]({
              issue_id: IssueId.make(issue),
              request_id: RequestId.make(savedReport.request_id),
              hash: ContentHash.make(savedReport.hash),
            }),
          ),
        );
        assert.equal(
          JSON.parse(restored.json).data.work.find(
            (work: { issue_id: string }) => work.issue_id === issue,
          ).phase,
          "awaiting_plan_approval",
        );
        const restoredExport = await Effect.runPromise(
          backend.readExport({
            issue_id: IssueId.make(issue),
            request_id: RequestId.make(exportedReport.request_id),
            hash: ContentHash.make(exportedReport.document_hash),
            exporter_hash: ContentHash.make(exportedReport.exporter_hash),
          }),
        );
        assert.equal(restoredExport.hash, exportedReport.hash);
        assert.equal(restoredExport.bytes, exportedReport.bytes);
        await page.getByRole("button", { name: "Other reports", exact: true }).click();
        await page
          .locator(".report-revision")
          .filter({ hasText: "Native composed evidence" })
          .getByRole("button", { name: "Preview", exact: true })
          .click();
        await page.locator('[data-report-section="checks"]').waitFor();
        assert.match(await page.locator('[data-report-section="checks"]').innerText(), /not run/);
        assert.doesNotMatch(
          await page.locator('[data-report-section="checks"]').innerText(),
          /passed/,
        );
        const worker = state.apply_session_id as string;
        assert.ok(worker, "Completed work retains its implementation session identity");
        const transcript = Schema.decodeSync(WorkerHistoryPageSchema)(
          await Effect.runPromise(
            backend.work["worker-history"]({
              issue_id: IssueId.make(issue),
              session_id: SessionId.make(worker),
            }),
          ),
        );
        assert.equal(transcript.session_id, worker);
        assert.ok(transcript.messages.length > 0, "Retired native worker history remains readable");
        assert.ok(transcript.messages.length <= 8);
        if (transcript.older) {
          const earlier = Schema.decodeSync(WorkerHistoryPageSchema)(
            await Effect.runPromise(
              backend.work["worker-history"]({
                issue_id: IssueId.make(issue),
                session_id: SessionId.make(worker),
                cursor: transcript.older,
              }),
            ),
          );
          assert.equal(earlier.session_id, worker);
          assert.ok(
            !earlier.messages.some((message) =>
              transcript.messages.some((current) => current.id === message.id),
            ),
          );
        }
        await assert.rejects(
          Effect.runPromise(
            backend.work["worker-history"]({
              issue_id: IssueId.make(issue),
              session_id: SessionId.make(worker),
              cursor: "forged-history-cursor",
            }),
          ),
          /not issued/,
        );
        await assert.rejects(
          Effect.runPromise(
            backend.work["worker-history"]({
              issue_id: IssueId.make(issue),
              session_id: SessionId.make(input.session),
            }),
          ),
          /own|selection|resource/i,
        );

        const inspectionsBefore = input.providerCount();
        const decisions = Schema.decodeSync(DecisionsSchema)(
          await Effect.runPromise(backend.work["decisions"]({ issue_id: IssueId.make(issue) })),
        );
        const communication = Schema.decodeSync(MessagesPageSchema)(
          await Effect.runPromise(backend.work["messages"]({ issue_id: IssueId.make(issue) })),
        );
        const checks = Schema.decodeSync(FeedbackPageSchema)(
          await Effect.runPromise(backend.work["feedback"]({ issue_id: IssueId.make(issue) })),
        );
        assert.ok(Array.isArray(decisions.decisions));
        assert.ok(communication.total >= communication.entries.length);
        assert.ok(checks.finding_total >= checks.findings.length);
        await page
          .getByRole("tablist", { name: "Work details", exact: true })
          .getByRole("tab", { name: "Activity", exact: true })
          .click();
        await page.getByRole("heading", { name: "Worker transcript", exact: true }).waitFor();
        await page.getByLabel("Read-only worker session", { exact: true }).selectOption(worker);
        await page.getByRole("tab", { name: "Communication", exact: true }).click();
        await page.getByRole("navigation", { name: "Communication pages", exact: true }).waitFor();
        await page.getByRole("tab", { name: "Reviews & checks", exact: true }).click();
        await page.getByRole("heading", { name: "Reviews & checks", exact: true }).waitFor();
        await page
          .getByRole("navigation", { name: "Review and check pages", exact: true })
          .waitFor();
        assert.equal(
          await page.getByRole("textbox", { name: "Message Abra", exact: true }).count(),
          1,
        );
        assert.equal(
          input.providerCount(),
          inspectionsBefore,
          "Owned evidence inspection must not admit a provider turn",
        );
        if (input.evidence)
          await page.screenshot({
            path: join(input.evidence, "native-completed.png"),
            fullPage: true,
          });
        assert.deepEqual(errors, []);
        assert.deepEqual(
          observers.flatMap((observer) => observer.errors),
          [],
        );
        const streamed = observers.flatMap((observer) => observer.events);
        assert.ok(
          streamed.includes("arguments"),
          "Actual native tool arguments must reach the standard HTTP consumer",
        );
        assert.ok(
          streamed.includes("text"),
          "Actual native text must reach the standard HTTP consumer",
        );
        assert.ok(streamed.includes("result"));
        assert.deepEqual(partialBeforeRelease, { tool: true, text: true });
        const historical = await Effect.runPromise(backend.surface("workspace-board", 1));
        assert.ok(!("unavailable" in historical));
        assert.equal(
          historical.surface.createSurface.components[1]!.text,
          "Native workspace coding journey",
        );

        const recoveredReviewReceipt = await Effect.runPromise(
          backend.reviews!.receipt({
            review_id: nativeFeedback.review_id,
            revision: nativeFeedback.revision,
            hash: nativeFeedback.hash,
            request_id: nativeFeedback.request_id,
          }),
        );
        assert.deepEqual(
          recoveredReviewReceipt,
          nativeFeedback,
          "Review receipt must survive actual native restart and worktree retirement",
        );

        return {
          issue_id: issue,
          phase: state.current_phase,
          approvals_in_browser: [...approved],
          commands: ordinal,
          interface: "copilotkit-v2/ag-ui/a2ui-1.0",
          native_session_id: input.session,
          stale_plan_reply_refused: true,
          pending_native_form_recreated_after_restart: true,
          saved_json_report: savedReport,
          composed_json_report: composedReport,
          exported_html_report: exportedReport,
          export_reopened_after_native_restart: true,
          admission_recovery: admissionRecovery,
          interactive_review: {
            review_id: nativeFeedback.review_id,
            revision: nativeFeedback.revision,
            request_id: nativeFeedback.request_id,
            receipt_after_restart: true,
            followup_published: true,
          },
          binding_coverage: {
            population: 57,
            companion: population.companion,
            off_page: population.offPage.id,
            snapshot_retained: true,
            live_resolved: true,
          },
          native_transport: {
            observers: observers.length,
            observer_errors: observers.flatMap((observer) => observer.errors),
            text_events: streamed.filter((type) => type === "text").length,
            argument_events: streamed.filter((type) => type === "arguments").length,
            result_events: streamed.filter((type) => type === "result").length,
            reconnected_without_replay: true,
            partial_before_provider_release: partialBeforeRelease,
            trace: nativeTrace.slice(-512),
          },
          typed_native_evidence_inspection: {
            decisions: decisions.decisions.length,
            communication: communication.total,
            findings: checks.finding_total,
            provider_calls: 0,
          },
        };
      }
      assert.notEqual(
        state.current_phase,
        "failed",
        JSON.stringify(state.error_or_recovery_reason),
      );
      // This journey delivers a branch. Human merge authorization belongs to the
      // real PR journey; a transient awaiting_merge phase can retire automatically.
      const kind = state.current_phase === "awaiting_plan_approval" ? "plan" : undefined;
      const workersIdle =
        status.sessions?.length > 0 &&
        status.sessions.every(
          (worker: any) =>
            worker.busy === false && worker.executing !== true && worker.outcome === "succeeded",
        );
      if (kind && workersIdle && !approved.has(kind)) {
        const unpublished = await fetch(`${web.origin}/api/work/report?issue_id=${issue}`);
        assert.equal(unpublished.status, 200);
        assert.deepEqual(await unpublished.json(), { unavailable: "not_published" });
        const requested = await command("abra_work_approve", { issue_id: issue, kind });
        if (requested.category === "operation_in_progress") continue;
        if (kind === "plan") {
          const checkpoint = (await Effect.runPromise(backend.snapshot)).forms.find(
            (item) => item.checkpoint?.issue_id === issue && item.checkpoint.kind === kind,
          );
          assert.ok(checkpoint?.active, "The native plan form is bound to the current checkpoint");
          const proposal = join(
            state.worktree_directory,
            "openspec/changes",
            state.openspec_change,
            "proposal.md",
          );
          const captured = await readFile(proposal);
          try {
            await writeFile(
              proposal,
              Buffer.concat([captured, Buffer.from("\nChanged after approval request.\n")]),
            );
            await assert.rejects(
              Effect.runPromise(
                backend.replyForm({
                  id: checkpoint.form.id,
                  binding: checkpoint.binding,
                  answer: {},
                }),
              ),
              /checkpoint changed/i,
            );
            assert.equal(
              (
                await input.client.session.form.get({
                  sessionID: input.session,
                  formID: checkpoint.form.id,
                })
              ).state.status,
              "pending",
            );
          } finally {
            await writeFile(proposal, captured);
          }
          assert.ok(
            (await Effect.runPromise(backend.snapshot)).forms.find(
              (item) => item.form.id === checkpoint.form.id,
            )?.active,
          );
          await input.restart();
          await page.reload();
          await page.getByRole("textbox", { name: "Message Abra" }).waitFor();
          await command("abra_work_approve", { issue_id: issue, kind });
          assert.ok(
            (await Effect.runPromise(backend.snapshot)).forms.find(
              (item) => item.form.id === checkpoint.form.id,
            )?.active,
            "Recreated native form keeps the current checkpoint identity",
          );
          await page
            .getByRole("tablist", { name: "Work details", exact: true })
            .getByRole("tab", { name: "Overview", exact: true })
            .click();
          await page
            .getByRole("button", { name: "Review current plan approval", exact: true })
            .click();
          await assert.rejects(
            Effect.runPromise(
              backend.saveSurface({
                issue_id: IssueId.make(issue),
                request_id: RequestId.make("stale-surface-save"),
                surface_id: "workspace-board",
                revision: 1,
              }),
            ),
            /revision changed/i,
          );
          await openLayout(2);
          const producingView = page.locator(
            '.inspector [data-surface-reference="workspace-board/2"]',
          );
          const beforeSave = (
            await input.client.session.context({ sessionID: input.session })
          ).filter((message) => message.type === "user").length;
          const providerBeforeSave = input.providerCount();
          await producingView
            .getByLabel("Save snapshot with task", { exact: true })
            .selectOption(issue);
          const saveResponse = page.waitForResponse(
            (response) => response.url() === `${web.origin}/api/report/save-surface`,
          );
          await producingView.getByRole("button", { name: "Save snapshot", exact: true }).click();
          const response = await saveResponse;
          assert.equal(response.status(), 200, await response.text());
          const artifact = await response.json();
          assert.equal(artifact.format, "a2ui-snapshot");
          await producingView
            .getByRole("button", { name: "Open saved report", exact: true })
            .click();
          await page.locator(".frozen-report").waitFor();
          savedReport = { request_id: artifact.request_id, hash: artifact.hash, url: page.url() };
          const download = page.getByRole("link", {
            name: "Download selected JSON",
            exact: true,
          });
          const json = await (
            await fetch(new URL((await download.getAttribute("href"))!, web.origin))
          ).json();
          assert.equal(json.provenance.source_surface.revision, 2);
          assert.equal(
            json.surface.createSurface.components.filter((c: any) => c.component === "Mermaid")
              .length,
            32,
          );
          await page.locator('.frozen-report [data-diagram-state="ready"]').nth(31).waitFor();
          assert.ok(
            json.data.work.some(
              (row: { issue_id: string }) => row.issue_id === population.offPage.id,
            ),
          );
          assert.ok(
            json.data.snapshot_work.some(
              (row: { issue_id: string }) => row.issue_id === population.companion,
            ),
          );
          assert.equal(json.data.snapshot_coverage.total, 57);
          assert.equal(json.data.live_coverage.total, 2);

          assert.equal(
            json.data.work.find((work: any) => work.issue_id === issue).phase,
            "awaiting_plan_approval",
          );
          assert.equal(
            json.data.snapshot_work.find((work: any) => work.issue_id === issue).issue_status,
            "open",
          );
          assert.equal(
            (await input.client.session.context({ sessionID: input.session })).filter(
              (message) => message.type === "user",
            ).length,
            beforeSave,
            "Saving/opening a snapshot must not admit a native prompt",
          );
          await input.client.session.wait({ sessionID: input.session });
          assert.equal(
            input.providerCount(),
            providerBeforeSave,
            "Saving/opening a snapshot must not call the provider",
          );
          const exportResponse = page.waitForResponse(
            (response) => response.url() === `${web.origin}/api/report/export`,
          );
          await page.getByRole("button", { name: "Export offline HTML", exact: true }).click();
          const exported = await exportResponse;
          assert.equal(exported.status(), 200, await exported.text());
          const exportReceipt = await exported.json();
          exportedReport = { ...exportReceipt, request_id: artifact.request_id };
          assert.equal(exportReceipt.document_hash, artifact.hash);
          const exportDownload = page.getByRole("link", {
            name: "Download exported HTML",
            exact: true,
          });
          const downloaded = await fetch(
            new URL((await exportDownload.getAttribute("href"))!, web.origin),
          );
          assert.match(downloaded.headers.get("content-disposition") ?? "", /attachment/);
          const exportedHTML = await downloaded.text();
          assert.equal(Buffer.byteLength(exportedHTML), exportReceipt.bytes);
          assert.ok(exportReceipt.bytes < 8 * 1024 * 1024);
          assert.deepEqual(
            await Effect.runPromise(
              backend.exportDocument({
                issue_id: IssueId.make(issue),
                request_id: RequestId.make(artifact.request_id),
                hash: ContentHash.make(artifact.hash),
              }),
            ),
            exportReceipt,
          );
          await page.getByRole("button", { name: "Preview exported HTML", exact: true }).click();
          await page
            .frameLocator('iframe[title="Offline HTML export"]')
            .getByRole("heading", { name: json.title, exact: true })
            .waitFor();
          await page.getByRole("button", { name: "Close HTML preview", exact: true }).click();
          assert.equal(
            input.providerCount(),
            providerBeforeSave,
            "Explicit HTML export must not call the provider",
          );
          const composed = await command("abra_work_report", {
            issue_id: issue,
            action: "generate",
            request_id: "native-composed-report",
            title: "Native composed evidence",
          });
          assert.equal(composed.format, "a2ui-snapshot");
          assert.equal(composed.source_attachment, "associated");
          assert.equal(composed.notify_session, undefined);
          assert.equal(composed.notices, undefined);
          composedReport = {
            request_id: composed.request.request_id,
            hash: composed.artifact.hash,
          };
          await page.reload();
          await page.locator(".frozen-report").waitFor();
          await page.getByRole("button", { name: "Close inspector", exact: true }).click();
        }
        const dock = page.getByRole("link", { name: "Attention", exact: true });
        if (!(await dock.isVisible()))
          await page.getByText("Destinations", { exact: true }).click();
        await dock.click();
        const forms = page
          .locator(".attention-card")
          .filter({ has: page.getByText(new RegExp(`Authorize ${kind} for ${issue}`)) });
        await forms.getByRole("checkbox", { name: /Authorize this exact checkpoint/ }).check();
        const submit = forms.getByRole("button", { name: "Submit checkpoint decision" });
        assert.equal(await submit.isEnabled(), true, await forms.innerText());
        try {
          const [response] = await Promise.all([
            page.waitForResponse((r) => r.url() === `${web.origin}/api/form/reply`, {
              timeout: 5000,
            }),
            submit.click(),
          ]);
          assert.equal(response.status(), 200, await response.text());
        } catch (error) {
          throw new Error(
            `Checkpoint submit failed: ${String(error)}; ${await forms.innerText()}; ${JSON.stringify((await Effect.runPromise(backend.snapshot)).forms)}`,
          );
        }
        await command("abra_work_approve", { issue_id: issue, kind });
        approved.add(kind);
      } else if (workersIdle && Date.now() - lastAdvance > 2000) {
        await advanceAfterIdle({
          before: status,
          advance: () =>
            command("abra_work_control", {
              issue_id: issue,
              action: "advance",
              request_id: `workspace-advance-${ordinal}`,
            }),
          readStatus: () => input.readStatus(issue),
          context: (sessionID) => input.client.session.context({ sessionID }),
        });
        lastAdvance = Date.now();
      }
      await new Promise((done) => setTimeout(done, 200));
    }
    throw new Error(
      `Browser coding journey did not complete: ${JSON.stringify(await input.readStatus(issue))}`,
    );
  } finally {
    if (input.evidence) {
      await mkdir(input.evidence, { recursive: true });
      await writeFile(
        join(input.evidence, "native-transport.json"),
        JSON.stringify(
          {
            partialBeforeRelease,
            diagramPerformance,
            trace: nativeTrace,
            observers: observers.map(({ events, errors }) => ({ events, errors })),
          },
          null,
          2,
        ),
      );
    }
    for (const observer of observers) await observer.agent.detachActiveRun();
    await Promise.all(observers.map((observer) => observer.done));
    await browser.close();
    await Effect.runPromise(Scope.close(scope, Exit.void));
  }
}
