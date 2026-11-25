import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Effect, Exit, Scope } from "effect";
import type { Endpoint } from "@opencode/client/effect/service";
import { launchReportBrowser, reportBrowserExecutable } from "@abracode/report-export/browser";
import { AbsolutePath } from "@abracode/contracts/identities";
import { NativeWebBackend } from "../../src/web/backend.ts";
import { workspaceServer } from "../../src/web/server.ts";
import { CrewError } from "../../src/domain.ts";
import type { SubmissionReceipt } from "@abracode/contracts/web/workspace-wire";

export async function cockpitJourney(input: {
  home: string;
  project: string;
  session: string;
  endpoint: Endpoint;
  evidence?: string;
  invoke: (tool: string, args: unknown) => Promise<any>;
  question: (session: string, args: unknown) => Promise<unknown>;
  holdWorker: () => void;
  releaseWorker: () => void;
  held: () => boolean;
  waitSession: (session: string) => Promise<unknown>;
  eventually: <T>(action: () => Promise<T | undefined>, timeout?: number) => Promise<T>;
  holdAbra: () => Promise<void>;
  releaseAbra: () => void;
}) {
  const { invoke, eventually } = input;
  await invoke("abra_project_onboard", {
    id: "cockpit",
    path: input.project,
    action: "register",
    plan_approval: true,
    merge_approval: false,
    delivery: "branch",
    verification: [[process.execPath, "--version"]],
    max_workers: 4,
    max_executions: 4,
  });
  const tasks: string[] = [];
  for (const letter of ["A", "B", "C"]) {
    const created = await invoke("abra_work_create", {
      repository_id: "cockpit",
      request_id: "cockpit-" + letter,
      title: "Cockpit task " + letter,
      description: "Inspect the retained cockpit fixture " + letter,
    });
    tasks.push(created.issue.id);
  }
  const [a, b, c] = tasks;
  async function start(id: string) {
    await invoke("abra_work_start", { issue_id: id });
    return eventually(async () => {
      const e = (await invoke("abra_work_status", { issue_id: id })).execution;
      return e?.explore_session_id && e.worktree_directory ? e : undefined;
    });
  }
  const first = await start(a);
  await input.waitSession(first.explore_session_id);
  const other = await start(b);
  await input.waitSession(other.explore_session_id);
  await input.question(other.explore_session_id, {
    key: "fixture-choice",
    generation: other.control_generation,
    scope: "B",
    question: "Which behavior should B keep?",
    owner: "user",
  });
  const decision = await invoke("abra_work_decision", {
    action: "collect",
    issue_id: b,
    key: "fixture-choice",
    generation: other.control_generation,
  });
  assert.ok(decision.form_id);
  input.holdWorker();
  await start(c);
  await eventually(async () => input.held() || undefined);
  const file = join(first.worktree_directory, "cockpit.txt");
  await writeFile(file, "The original deadline is 50ms.\n");
  const scope = await Effect.runPromise(Scope.make());
  const backend = new NativeWebBackend(
    AbsolutePath.make(input.home),
    input.session,
    Effect.succeed(input.endpoint),
  );
  let receipt: SubmissionReceipt | undefined;
  const original = backend.submit.bind(backend);
  backend.submit = (payload) =>
    original(payload).pipe(
      Effect.flatMap((result) => {
        if (payload.selection && !receipt) {
          receipt = result;
          return Effect.fail(
            new CrewError("FIXTURE_LOST", "Response interrupted after native admission"),
          );
        }
        return Effect.succeed(result);
      }),
    );
  const web = await Effect.runPromise(
    workspaceServer({ port: 0, backend, assets: join(input.home, "apps/web/dist") }).pipe(
      Effect.provideService(Scope.Scope, scope),
    ),
  );
  const browser = await launchReportBrowser();
  const page = await browser.newPage({ viewport: { width: 1550, height: 940 } });
  try {
    await page.goto(web.origin + "/?issue=" + a + "&tab=Diff");
    const resource = page.getByRole("region", { name: "cockpit.txt", exact: true });
    await resource.getByText("Select lines in cockpit.txt").click();
    await resource.getByRole("button", { name: "Ask Abra", exact: true }).click();
    await page.getByLabel("Message Abra").fill("Why this deadline?");
    await page.goto(web.origin + "/?issue=" + b + "&tab=Overview");
    await page.getByText("Which behavior should B keep?", { exact: true }).first().waitFor();
    assert.match(await page.locator(".selection-chip summary").innerText(), new RegExp(a));
    await page.reload();
    const form = page.getByRole("button", { name: "Answer in native form" });
    await form.click();
    await page.locator(`[data-native-form-id="${decision.form_id}"]:focus`).waitFor();
    assert.equal(await page.getByLabel("Message Abra").inputValue(), "Why this deadline?");
    await input.holdAbra();
    const queued = await Effect.runPromise(
      backend.submit({
        request_id: "cockpit-queued",
        text: "Record the queued developer note",
        delivery: "queue",
      }),
    );
    assert.equal(queued.delivery, "queue");
    assert.equal(queued.status, "admitted");
    await page.getByLabel("Message delivery").selectOption("steer");
    await page.getByRole("button", { name: "Send message" }).click();
    const admitted = await eventually(async () => receipt);
    assert.equal(admitted.capture?.excerpt, "The original deadline is 50ms.");
    assert.equal(admitted.delivery, "steer");
    input.releaseAbra();
    await writeFile(file, "The deadline is now 100ms.\n");
    await invoke("abra_selection_answer", {
      request_id: admitted.request_id,
      issue_id: a,
      answer: "The captured deadline was 50ms.",
    });
    await page.goto(web.origin + "/?issue=" + c + "&tab=Overview");
    await page.reload();
    await page.getByText(/cockpit.txt · additions 1–1 · Captured selection/).click();
    await page.getByText("The original deadline is 50ms.", { exact: true }).waitFor();
    await page.getByText(/Abra answered · The captured deadline was 50ms/).waitFor();
    const scoped = await Effect.runPromise(backend.receipt(admitted.request_id));
    assert.equal(scoped?.message_id, admitted.message_id);
    const history = await Effect.runPromise(
      backend.snapshot.pipe(Effect.map(() => backend.nativeSnapshot()!.messages)),
    );
    assert.equal(history.filter((m) => m.id === admitted.message_id).length, 1);
    assert.ok(input.held());
    await page.route("**/api/work/verification?*", (route) =>
      route.fulfill({ status: 503, body: "Unavailable" }),
    );
    await page.goto(web.origin + "/?issue=" + a + "&tab=Verification");
    await page.getByRole("button", { name: "Inspect changes" }).waitFor();
    const failure = page.locator(".inspector").getByRole("alert");
    await failure.getByRole("button", { name: "Retry" }).waitFor();
    await page.unroute("**/api/work/verification?*");
    await failure.getByRole("button", { name: "Retry" }).click();
    await page.getByRole("heading", { name: "Controller checks" }).waitFor();
    await page.getByText(/cockpit.txt · additions 1–1 · Captured selection/).click();
    await page.getByText("The original deadline is 50ms.", { exact: true }).waitFor();
    if (input.evidence) {
      await mkdir(input.evidence, { recursive: true });
      const cli = promisify(execFile);
      const name = "abra-cockpit-" + process.pid;
      const ab = (...args: string[]) =>
        cli(resolve("node_modules/.bin/agent-browser"), ["--session", name, ...args], {
          env: { ...process.env, AGENT_BROWSER_EXECUTABLE_PATH: reportBrowserExecutable() },
          timeout: 20000,
          maxBuffer: 1024 * 1024,
        });
      try {
        await ab("open", web.origin + "/?issue=" + a + "&tab=Verification");
        await ab("set", "viewport", "1550", "940");
        await ab("wait", "--text", "Inspect changes");
        await ab("find", "text", "cockpit.txt · additions 1–1 · Captured selection", "click");
        await ab("wait", "--text", "The captured deadline was 50ms.");
        await ab("screenshot", join(input.evidence, "desktop.png"));
        await writeFile(join(input.evidence, "desktop.txt"), (await ab("snapshot")).stdout);
        await ab("set", "viewport", "390", "830");
        await ab("screenshot", join(input.evidence, "narrow.png"));
        await writeFile(join(input.evidence, "narrow.txt"), (await ab("snapshot")).stdout);
        await writeFile(
          join(input.evidence, "steps.md"),
          "1. Attach the original deadline on A.\n2. Inspect the user-owned decision on B, reload, open its bound native form, and check the draft.\n3. Steer the held Abra turn with A still attached. Drop the first response after native admission.\n4. Change the worktree, record the linked answer, reload while C is running, and reopen the original excerpt.\n5. Fail an issue-specific verification read, recover with its local Retry, and keep the question accessible.\n6. Open the verified route in the named agent-browser session at desktop and narrow widths.\n",
        );
      } finally {
        await ab("close");
      }
    }
    return {
      journey: "contextual cockpit",
      tasks,
      request: admitted.request_id,
      delivery: admitted.delivery,
    };
  } finally {
    input.releaseAbra();
    input.releaseWorker();
    await browser.close();
    await Effect.runPromise(Scope.close(scope, Exit.void));
  }
}
