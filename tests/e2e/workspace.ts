/* oxlint-disable effecttsgo/unstable-api-usage -- Disposable native API and Effect HTTP/AG-UI acceptance. */
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { Effect, Exit, Scope } from "effect";
import { OpenCode } from "@opencode/client";
import type { Endpoint } from "@opencode/client/effect/service";
import { AbsolutePath } from "../../src/identities.ts";
import { NativeWebBackend } from "../../src/web/backend.ts";
import { workspaceServer } from "../../src/web/server.ts";
import { catalogId } from "../../src/web/surfaces.ts";
import { launchReportBrowser } from "../../templates/reporter/scripts/browser.ts";

type Native = ReturnType<typeof OpenCode.make>;
export async function workspaceJourney(input: {
  home: string;
  project: string;
  session: string;
  endpoint: Endpoint;
  client: Native;
  readStatus: (id: string) => Promise<any>;
  evidence?: string;
}) {
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
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(web.origin);
    await page.getByRole("textbox", { name: "Message Abra" }).waitFor();
    let ordinal = 0;
    async function command(tool: string, args: Record<string, unknown>) {
      const text = `AbraCode workspace operation ${JSON.stringify({ tool, args, ordinal: ++ordinal })}`;
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
            throw new Error(`${tool}: ${JSON.stringify(call.state.error)}`);
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
        `Browser command did not settle: ${tool}; ${JSON.stringify(await page.locator('[role="alert"]').allTextContents())}; ${JSON.stringify((await Effect.runPromise(backend.snapshot)).messages.slice(-8).map((message) => ({ id: message.id, role: message.role, text: message.text.slice(0, 180), tools: message.tools?.map((tool) => ({ name: tool.name, status: tool.status })) })))}`,
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
    await command("abra_render_ui", {
      surface: {
        version: "1.0",
        createSurface: {
          surfaceId: "workspace-board",
          catalogId,
          components: [
            { id: "root", component: "Column", children: ["heading", "board"] },
            { id: "heading", component: "Text", text: "Native workspace coding journey" },
            { id: "board", component: "Kanban", issueIds: [issue], mode: "live" },
          ],
        },
      },
    });
    await page.getByRole("button", { name: /Work views/ }).click();
    await page.getByText("Native workspace coding journey", { exact: true }).waitFor();
    if (input.evidence) {
      await mkdir(input.evidence, { recursive: true });
      await page.screenshot({ path: join(input.evidence, "native-work-view.png"), fullPage: true });
    }
    await page.getByRole("button", { name: "Conversation", exact: true }).click();
    await command("abra_work_start", { issue_id: issue });
    const approved = new Set<string>();
    const deadline = Date.now() + 120000;
    let lastAdvance = 0;
    while (Date.now() < deadline) {
      const status = await input.readStatus(issue);
      const state = status.execution;
      if (state.current_phase === "completed") {
        assert.equal(status.issue.status, "closed");
        assert.equal(status.outcome.cleanup.state, "retired");
        assert.equal(status.outcome.closure, "closed");
        if (input.evidence)
          await page.screenshot({
            path: join(input.evidence, "native-completed.png"),
            fullPage: true,
          });
        assert.deepEqual(errors, []);
        return {
          issue_id: issue,
          phase: state.current_phase,
          approvals_in_browser: [...approved],
          commands: ordinal,
          interface: "copilotkit-v2/ag-ui/a2ui-1.0",
          native_session_id: input.session,
        };
      }
      assert.notEqual(
        state.current_phase,
        "failed",
        JSON.stringify(state.error_or_recovery_reason),
      );
      const kind =
        state.current_phase === "awaiting_plan_approval"
          ? "plan"
          : state.current_phase === "awaiting_merge"
            ? "merge"
            : undefined;
      const workersIdle =
        status.sessions?.length > 0 &&
        status.sessions.every(
          (worker: any) =>
            worker.busy === false && worker.executing !== true && worker.outcome === "succeeded",
        );
      if (kind && workersIdle && !approved.has(kind)) {
        const requested = await command("abra_work_approve", { issue_id: issue, kind });
        if (requested.category === "operation_in_progress") continue;
        const forms = page
          .locator("form.attention-card")
          .filter({ has: page.getByText(new RegExp(`Authorize ${kind} for ${issue}`)) });
        await forms.getByLabel("Authorize this exact checkpoint").check();
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
        await command("abra_work_control", {
          issue_id: issue,
          action: "advance",
          request_id: `workspace-advance-${ordinal}`,
        });
        lastAdvance = Date.now();
      }
      await new Promise((done) => setTimeout(done, 200));
    }
    throw new Error(
      `Browser coding journey did not complete: ${JSON.stringify(await input.readStatus(issue))}`,
    );
  } finally {
    await browser.close();
    await Effect.runPromise(Scope.close(scope, Exit.void));
  }
}
