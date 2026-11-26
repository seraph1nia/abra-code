import { NativeWorkspaceCommandError } from "../helpers/workspace-advance.ts";
import { SqliteWorkGraph } from "../../src/work/graph.ts";
import { ExecutionId, RepositoryId } from "@abracode/contracts/identities";
import assert from "node:assert/strict";
import { join } from "node:path";
import { Deferred, Effect, Fiber } from "effect";
import { FileLocks } from "../../src/storage/lock.ts";
import { LockKey } from "@abracode/contracts/identities";
import { AbsolutePath, IssueId, RequestId } from "@abracode/contracts/identities";
import { NativeWebBackend } from "../../src/web/backend.ts";
import { launchReportBrowser } from "@abracode/report-export/browser";
import type { WorkspaceJourneyInput } from "./workspace.ts";
import type { WorkspaceStreaming } from "./workspace-streaming-checks.ts";
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
export async function checkWorkspaceBootstrap(
  input: WorkspaceJourneyInput,
  backend: NativeWebBackend,
  origin: string,
  browser: Awaited<ReturnType<typeof launchReportBrowser>>,
  { attachObserver }: WorkspaceStreaming,
) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const beforeSettings = input.providerCount();
  await page.goto(`${origin}/settings`);
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
    const report = await fetch(`${origin}/api/work/report?issue_id=${issueID}`);
    assert.equal(report.status, 200);
    assert.deepEqual(await report.json(), { unavailable: "not_started" });
  }
  assert.equal((await fetch(`${origin}/api/work/report?issue_id=abra-unknown-report`)).status, 404);
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
      if (!snapshot.work_unavailable && snapshot.work.work.some((work) => work.issue_id === issue))
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
        assert.ok(backend.nativeSnapshot()!.messages.some((message) => message.id === observed.id));
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
  return {
    page,
    errors,
    chatFromAttention,
    command,
    issue,
    population,
    commandCount: () => ordinal,
  };
}
export type WorkspaceBootstrap = Awaited<ReturnType<typeof checkWorkspaceBootstrap>>;
