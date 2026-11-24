import type { OpenCode } from "@opencode/client";
import assert from "node:assert/strict";
import { cp, mkdir, readFile, writeFile, rename, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Effect, Exit, Scope } from "effect";
import { reportBrowserExecutable } from "@abracode/report-export/browser";
import { AbsolutePath, RequestId } from "@abracode/contracts/identities";
import { NativeWebBackend } from "../../src/web/backend.ts";
import { workspaceServer } from "../../src/web/server.ts";
import { hash } from "../../src/memory/collections.ts";
import type { Endpoint } from "@opencode/client/effect/service";
import type { MemoryReference } from "@abracode/contracts/visibility/memory";
const recallSentence = "Use amberquartz for the recovery fixture.";
const supervisorLesson = "Use the AbraCode index fixture for text lookup.";
type JourneyInput = {
  client: ReturnType<typeof OpenCode.make>;
  home: string;
  root: string;
  projects: string[];
  session: string;
  endpoint: Endpoint;
  evidence?: string;
  invoke: (name: string, args: unknown) => Promise<any>;
  restart: () => Promise<void>;
  eventually: <T>(fn: () => Promise<T | undefined>, timeout?: number) => Promise<T>;
};
async function publishInChat({ client, session }: JourneyInput) {
  await client.session.prompt({
    sessionID: session,
    text: "Remember for repository api: " + supervisorLesson,
  });
  await client.session.wait({ sessionID: session });
  const messages = await client.session.context({ sessionID: session });
  const call = messages
    .flatMap((m) =>
      m.type === "assistant"
        ? m.content.filter((p) => p.type === "tool" && p.name === "abra_memory_publish")
        : [],
    )
    .at(-1);
  assert.ok(call?.type === "tool" && call.state.status === "completed", JSON.stringify(call));
  assert.match(JSON.stringify(call.state.content), /revision/);
}

async function verifyWorker(
  { client, invoke, eventually }: JourneyInput,
  reference: MemoryReference,
) {
  const { issue } = await invoke("abra_work_create", {
    repository_id: "api",
    title: "Recall the recovery fixture",
    description: "Verify scoped memory recall",
    workflow_policy: "research-only",
    scope: {
      goal: "Read the current note",
      acceptance: ["Find the approved excerpt"],
      constraints: ["Read only"],
    },
    request_id: "memory-research",
  });
  const started = await invoke("abra_work_start", { issue_id: issue.id });
  await eventually(async () => {
    const status = await invoke("abra_work_status", { issue_id: issue.id });
    if (
      ["failed", "recovery_required", "blocked", "awaiting_approval"].includes(
        status.execution.current_phase,
      )
    )
      throw Object.assign(
        Error(
          status.execution.current_phase +
            ": " +
            JSON.stringify(status.execution.error_or_recovery_reason ?? status.execution.decisions),
        ),
        { terminal: true },
      );
    const session = status.execution.research_session_id ?? started.research_session_id;
    if (!session) return;
    const messages = await client.session.context({ sessionID: session });
    const calls = messages.flatMap((m) =>
      m.type === "assistant" ? m.content.filter((p) => p.type === "tool") : [],
    );
    for (const name of ["abra_memory_search", "abra_memory_read"]) {
      const result = calls.find((p) => p.name === name)?.state;
      if (result?.status === "error")
        throw Object.assign(Error(result.error.message), { terminal: true });
      if (
        result?.status !== "completed" ||
        !JSON.stringify(result.content).includes(reference.revision)
      )
        return;
      assert.ok(JSON.stringify(result.content).includes(recallSentence));
      assert.ok(!JSON.stringify(result.content).includes("second sentence"));
    }
    return true;
  }, 60000);
}

export class MemoryFixture {
  private reference?: MemoryReference;
  calls(role: string, user: string, names: string[]) {
    const calls: { name: string; args: unknown }[] = [];
    if (role === "research" && this.reference) {
      calls.push(
        { name: "abra_memory_search", args: { query: "amberquartz" } },
        { name: "abra_memory_read", args: { reference: this.reference } },
      );
      assert.ok(names.includes("abra_memory_search") && names.includes("abra_memory_read"));
      assert.ok(
        !names.some(
          (n: string) =>
            n === "abra_memory_publish" || n.startsWith("bm_") || n.startsWith("abra_thought_"),
        ),
      );
    }
    if (role === "supervisor" && user === "Remember for repository api: " + supervisorLesson)
      calls.push({
        name: "abra_memory_publish",
        args: {
          destination: { kind: "repository", repository_id: "api" },
          content: supervisorLesson,
          source: { kind: "observation" },
        },
      });
    return calls;
  }
  async run(input: JourneyInput) {
    const { home, root, invoke, restart } = input;
    for (const [index, id] of ["frontend", "api"].entries())
      await invoke("abra_project_onboard", {
        id,
        path: input.projects[index],
        action: "register",
        plan_approval: false,
        merge_approval: false,
        delivery: "branch",
        verification: [[process.execPath, "--version"]],
      });
    await publishInChat(input);
    assert.equal((await invoke("abra_work_list", {})).issues.length, 0);
    const marker = "notebook" + process.pid;
    const ref = await invoke("abra_thought_save", {
      request_id: "memory-road",
      content: recallSentence + " Keep the second sentence private " + marker + ".",
    });
    const backend = new NativeWebBackend(
      AbsolutePath.make(home),
      input.session,
      Effect.succeed(input.endpoint),
    );
    const scope = Scope.makeUnsafe();
    const ab = (...args: string[]) =>
      promisify(execFile)(
        resolve("node_modules/.bin/agent-browser"),
        ["--session", "abra-memory-" + process.pid, ...args],
        {
          env: { ...process.env, AGENT_BROWSER_EXECUTABLE_PATH: reportBrowserExecutable() },
          timeout: 30000,
        },
      );
    const search = (id: string, query = "amberquartz", cursor?: string) =>
      invoke("abra_memory_search", { repository_id: id, query, cursor });
    try {
      const web = await Effect.runPromise(
        workspaceServer({ port: 0, backend, assets: join(home, "apps/web/dist") }).pipe(
          Effect.provideService(Scope.Scope, scope),
        ),
      );
      await ab("open", web.origin + "/thoughts");
      await ab("set", "viewport", "390", "844");
      await ab("find", "label", "Thought text", "fill", marker);
      await ab("find", "role", "button", "click", "--name", "Search thoughts");
      await ab("wait", "--text", recallSentence);
      await ab("find", "text", recallSentence, "click");
      await ab("wait", "--text", "Open in Memos");
      await ab("wait", "--text", "Remember for…");
      await ab("find", "role", "button", "click", "--name", "Remember for…");
      await ab("find", "label", "Exact wording", "fill", recallSentence);
      await ab("select", "select", "repo:api");
      await ab("find", "role", "button", "click", "--name", "Save to memory");
      await ab("wait", "--text", "Remembered for api.");
      if (input.evidence)
        await writeFile(join(input.evidence, "remember-phone.txt"), (await ab("snapshot")).stdout);
      await restart();
      const own = await search("api");
      const hit: MemoryReference = own.entries[0].reference;
      const full = await invoke("abra_memory_read", { repository_id: "api", reference: hit });
      assert.ok(full.body.includes(recallSentence));
      assert.doesNotMatch(full.body, /second sentence|users\/|memos\//);
      await ab("open", web.origin);
      await ab("wait", 'textarea[aria-label="Message Abra"]');
      await ab("press", "Control+k");
      await ab("wait", 'input[aria-label="Search work and commands"]');
      await ab("find", "label", "Search work and commands", "fill", "memory: amberquartz");
      await ab(
        "wait",
        "--fn",
        'Boolean(document.querySelector(\'select[aria-label="Memory scope"] option[value="api"]\'))',
      );
      await ab("select", 'select[aria-label="Memory scope"]', "api");
      await ab("wait", "--text", "Observation Use amberquartz");
      await ab("find", "text", "Observation Use amberquartz", "click");
      await ab("wait", "--text", hit.revision);
      await ab("wait", '[aria-label="Memory note"] pre');
      const paletteNote = (await ab("snapshot", "-s", '[aria-label="Memory note"]')).stdout;
      assert.ok(
        paletteNote.includes(recallSentence) && paletteNote.includes(hit.revision),
        paletteNote,
      );
      assert.doesNotMatch(paletteNote, /second sentence|memos\//);
      if (input.evidence) await writeFile(join(input.evidence, "memory-search.txt"), paletteNote);
      await ab("press", "Escape");
      this.reference = hit;
      await verifyWorker(input, hit);
      const isolated = await search("frontend");
      assert.equal(isolated.entries.length, 0);
      const shared = {
        request_id: RequestId.make("shared-memory"),
        destination: { kind: "shared" as const },
        content: recallSentence,
        source: { kind: "thought" as const, reference: ref },
      };
      const reference = await Effect.runPromise(backend.memoryPublish(shared));
      const sharedHits = await search("frontend");
      assert.deepEqual(sharedHits.entries[0].reference, reference);
      const data = join(root, "memory"),
        disk = join(data, "vault", "abra-" + hash("api"), hit.path);
      await writeFile(disk, (await readFile(disk, "utf8")).replace("amberquartz", "cobaltquartz"));
      await input.eventually(
        async () => (await search("api", "cobaltquartz")).entries[0] || undefined,
      );
      await assert.rejects(
        invoke("abra_memory_read", { repository_id: "api", reference: hit }),
        /MEMORY_CONFLICT/,
      );
      const restored = join(root, "restored-memory");
      await mkdir(restored);
      // Both are quiescent: Markdown has indexed, all publications have returned,
      // and the private receipt DB closes before its command returns.
      for (const part of ["vault", "receipts"])
        await cp(join(data, part), join(restored, part), { recursive: true });
      const settings = join(home, "abracode.yaml");
      await writeFile(
        settings,
        (await readFile(settings, "utf8")).replace(JSON.stringify(data), JSON.stringify(restored)),
      );
      await restart();
      await input.eventually(
        async () => (await search("api", "cobaltquartz")).entries[0] || undefined,
      );
      assert.deepEqual(await Effect.runPromise(backend.memoryPublish(shared)), reference);
      await rename(join(root, "bm"), join(root, "bm-offline"));
      await restart();
      await assert.rejects(search("api"), /MEMORY_UNAVAILABLE/);
      await invoke("abra_work_list", {});
      return {
        phone: "390x844",
        supervisor_publication: true,
        scope: "api",
        worker_revision: hit.revision,
        shared_revision: reference.revision,
        external_edit: true,
        restored_receipt: true,
        outage_isolated: true,
      };
    } catch (cause) {
      if (input.evidence)
        await writeFile(join(input.evidence, "memory-failure.txt"), (await ab("snapshot")).stdout);
      throw cause;
    } finally {
      await ab("close").finally(() => Effect.runPromise(Scope.close(scope, Exit.void)));
    }
  }
  async configure(root: string, home: string) {
    const binary = process.env.ABRACODE_TEST_BM;
    assert.ok(binary && binary.startsWith("/"), "Provide the absolute pinned bm executable");
    const executable = join(root, "bm");
    await symlink(binary, executable);
    const path = join(home, "abracode.yaml");
    await writeFile(
      path,
      (await readFile(path, "utf8")) +
        "memory: " +
        JSON.stringify({ enabled: true, executable, directory: join(root, "memory") }) +
        "\n",
    );
  }
}
