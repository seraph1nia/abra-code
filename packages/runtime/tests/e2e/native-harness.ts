import { portableRpc } from "../helpers/portable-rpc.ts";
import { configureMemosFixture } from "./memos-thoughts.ts";
import { nativeObservation } from "../helpers/native-observation.ts";
import { installNativeProbe } from "../helpers/native-probe.ts";
import { reportBrowserExecutable } from "@abracode/report-export/browser";
import { safeEvidence } from "../operational/evidence.ts";
import { command, installSource, installationRoot } from "./install.ts";
import { removeFixture } from "../helpers/resources.ts";
import { installSpecialist } from "./agents.ts";
import * as Id from "@abracode/contracts/identities";
import { run } from "../effects.ts";

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { writeFileSync } from "node:fs";
import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { OpenCode } from "@opencode/client";
import { Rpc } from "@opencode/plugin";
import { ProcessRunner } from "../../src/process.ts";
import { Git } from "../../src/git/repository.ts";
import { repo } from "../fixtures.ts";
import { visibility } from "../../src/visibility/protocol.ts";
import { retainedBytes } from "../operational/resources.ts";
import type { TestContext } from "vite-plus/test";
import { startMockProvider } from "./native-mock-provider.ts";
import { delay, eventually } from "./native-timing.ts";
const value = { type: "object" as const, additionalProperties: true };
const probe = Rpc.define({
  id: "abracode-test",
  methods: {
    tools: { input: value, output: value },
    invoke: {
      input: value,
      output: value,
      errors: {
        action_failed: {
          type: "object",
          properties: { code: { type: "string" } },
          required: ["code"],
          additionalProperties: false,
        },
      },
    },
    storage: { input: value, output: value },
  },
  events: {},
});
export interface NativeOptions {
  journey?: string;
  evidenceDirectory?: string;
  timeout?: number;
}
export async function startNativeHarness(t: TestContext, options?: NativeOptions) {
  const journey = options?.journey ?? process.env.ABRACODE_TEST_JOURNEY;
  const inboxFixture = journey === "github-inbox" || journey === "work-briefing";
  const evidenceDirectory = options?.evidenceDirectory ?? process.env.ABRACODE_TEST_EVIDENCE_DIR;
  if (journey === "crash-windows")
    assert.ok(
      evidenceDirectory && process.env.ABRACODE_TEST_METRICS === "1",
      "Crash windows require the opt-in instrumented fixture",
    );
  const root = await installationRoot("abracode-native-");
  let cleanup = async () => {
    await removeFixture(root);
  };
  t.onTestFinished(() => cleanup());
  const resources = {
    schema_version: 1,
    fixture_root: root,
    runner_pid: process.pid,
    native_children: [] as number[],
    cleanup: "pending",
  };
  const recordResources = () => {
    if (evidenceDirectory)
      writeFileSync(
        join(resolve(evidenceDirectory), "resources.json"),
        JSON.stringify(resources, null, 2) + "\n",
      );
  };
  if (evidenceDirectory) {
    const path = resolve(evidenceDirectory);
    assert.ok(path !== root && !path.startsWith(root + "/"));
    await mkdir(path, { recursive: true });
    recordResources();
  }
  const r = new ProcessRunner();
  const git = new Git(r);
  let child: ChildProcess | undefined;
  let logs = "";
  const engineeringEvidence: unknown[] = [];
  const controllerCalls: Record<string, { count: number; total_ms: number; max_ms: number }> = {};
  let retainedState: Awaited<ReturnType<typeof retainedBytes>> | undefined;
  const home = await run(repo(root, "central"));
  const projects = await Promise.all(
    ["frontend", "api", "worker"].map((id) => run(repo(root, id))),
  );
  const mock = await startMockProvider(journey, git, projects[0]!, engineeringEvidence);
  const {
    releaseStreamProof,
    acceptance,
    leads,
    agentRequests,
    providerRequests,
    controls,
    parallel,
    provider,
    address,
    memory,
  } = mock;
  cleanup = async () => {
    releaseStreamProof.tool?.();
    releaseStreamProof.text?.();
    acceptance.close();
    leads.close();
    const recordEvidence = async (cleanupComplete: boolean) => {
      if (!evidenceDirectory) return;
      const evidenceDir = resolve(evidenceDirectory);
      assert.ok(
        evidenceDir !== root && !evidenceDir.startsWith(root + "/"),
        "Evidence must survive fixture teardown",
      );
      await mkdir(evidenceDir, { recursive: true });
      const path = join(evidenceDir, "native-engineering.json");
      await writeFile(
        path,
        JSON.stringify(
          {
            fixture: "packages/runtime/tests/e2e/native-fixture.ts",
            result: cleanupComplete ? t.task.result?.state : "fail",
            cleanup_complete: cleanupComplete,
            // Assertion messages can embed whole executions and prompts.
            // Keep error identity and source frames in default telemetry.
            errors: t.task.result?.errors?.map((error) => ({
              name: error.name,
              code: /^([A-Z][A-Z0-9_]{2,40}):/.exec(error.message)?.[1],
              frames: error.stack
                ?.split("\n")
                .filter((line) => /^\s+at /.test(line))
                .slice(0, 8),
            })),
            observed_at: new Date().toISOString(),
            isolation:
              "Disposable service/data/config, loopback provider and local bare remotes; no operator service or user remote",
            observations: safeEvidence(engineeringEvidence),
            agent_requests: safeEvidence(agentRequests),
            metrics: {
              provider_requests: providerRequests,
              controller_calls: controllerCalls,
              retained_state: retainedState,
              usage_kind:
                "Deterministic provider requests and controller RPC calls; neither is billable tokens or a native turn count",
              billable_tokens: null,
              cost: null,
            },
          },
          null,
          2,
        ) + "\n",
      );
      if (cleanupComplete && journey === "engineering")
        console.info(
          "agent-verification " +
            JSON.stringify({
              evidence: path,
              result: t.task.result?.state,
              cleanup_complete: true,
              requests: agentRequests.length,
              observations: engineeringEvidence.filter(
                (value) =>
                  typeof value === "object" &&
                  value !== null &&
                  ("agent_capture_restart" in value ||
                    "native_contribution_direct" in value ||
                    "native_contribution_wrong_role" in value),
              ),
            }),
        );
      await access(path);
    };
    try {
      controls.releaseExplore?.();
      controls.releaseApply?.();
      controls.releaseModelWorker?.();
      parallel.close();
      if (t.task.result?.state === "fail")
        console.error(
          logs
            .split("\n")
            .filter((line) => /error|warn|failed/i.test(line))
            .join("\n")
            .replace(/server password .*/g, "[redacted]"),
        );
      const owned = child;
      if (owned && owned.exitCode === null && owned.signalCode === null)
        await new Promise<void>((done) => {
          const timeout = setTimeout(() => owned.kill("SIGKILL"), 5000);
          owned.once("exit", () => {
            clearTimeout(timeout);
            done();
          });
          owned.kill("SIGTERM");
        });
      await new Promise<void>((done) => provider.close(() => done()));
      retainedState = await retainedBytes([
        join(root, "data"),
        join(root, "state"),
        join(root, "central/.abracode"),
      ]);
      await removeFixture(root);
      resources.cleanup = "removed";
      recordResources();
      await recordEvidence(true);
    } catch (error) {
      resources.cleanup = "cleanup_failed";
      recordResources();
      await recordEvidence(false);
      throw error;
    }
  };
  // Only disposable local bare remotes are used in this test.
  for (const path of projects) {
    await run(
      r.run(
        Id.Executable.make("git"),
        ["init", "--bare", `${path}.git`],
        Id.AbsolutePath.make(root),
      ),
    );
    await run(git.run(Id.AbsolutePath.make(path), ["push", "origin", "main"]));
  }
  await mkdir(join(home, ".abracode/browser/other-session"), { recursive: true });
  await writeFile(
    join(home, ".abracode/browser/other-session/sentinel.txt"),
    "Unassigned evidence",
  );
  await mkdir(join(projects[1], ".opencode/skills/local-fixture"), { recursive: true });
  await writeFile(
    join(projects[1], ".opencode/skills/local-fixture/SKILL.md"),
    "---\nname: local-fixture\ndescription: Preserve local discovery\n---\nLocal instructions.\n",
  );
  await writeFile(join(projects[1], "AGENTS.md"), "Preserve foreign repository instructions.\n");
  await writeFile(
    join(projects[1], "README.md"),
    '# Fixture verification\n\nThe existing source-content check is:\n\n```sh\nnode -e \'if(require("fs").readFileSync("source.txt","utf8")!=="sample\\n")process.exit(1)\'\n```\n\nNo runtime audit service or verification recipe is supplied.\n',
  );
  await run(git.run(Id.AbsolutePath.make(projects[1]), ["add", "."]));
  await run(git.run(Id.AbsolutePath.make(projects[1]), ["commit", "-m", "Foreign control files"]));
  await run(git.run(Id.AbsolutePath.make(projects[1]), ["push", "origin", "main"]));
  await installSource(home, {
    buildWeb:
      journey === "agent-memory" ||
      journey === "memos-thoughts" ||
      inboxFixture ||
      journey === "workspace" ||
      journey === "cockpit",
  });
  if (
    journey === "workspace" ||
    journey === "reports" ||
    process.env.ABRACODE_TEST_COMBINED === "1"
  )
    await command("pnpm", ["report:prepare"], {
      cwd: home,
      timeout: 90_000,
      maxBuffer: 2 * 1024 * 1024,
    });
  if (journey === "engineering") await installSpecialist(home);
  const configPath = join(home, "opencode.json");
  await writeFile(
    configPath,
    JSON.stringify({
      plugins: [
        resolve(".opencode/plugins/abracode"),
        resolve("packages/runtime/tests/e2e/harness.ts"),
      ],
      model: "fixture/fallback",
    }),
  );
  const fakeForge = join(root, "fake-forge.mjs"),
    forgeState = join(root, "forge-state.json");
  await writeFile(
    fakeForge,
    await readFile(resolve("packages/runtime/tests/e2e/forge.mjs"), "utf8"),
    {
      mode: 0o755,
    },
  );
  await writeFile(
    forgeState,
    JSON.stringify(
      inboxFixture
        ? {
            inboxFixture: true,
            ...(journey === "work-briefing" && {
              check: "pending",
              briefing: true,
              releaseRemote: projects[0] + ".git",
            }),
            remote: "https://inbox.invalid/fixture/api",
            merge_hold: true,
          }
        : {},
    ),
  );
  if (journey === "work-briefing")
    await writeFile(
      join(root, "release-forge-state.json"),
      JSON.stringify({ remote: projects[0] + ".git", check: "pass" }),
    );
  if (inboxFixture) {
    await mkdir(join(root, "config/gh"), { recursive: true });
    await writeFile(join(root, "config/gh/hosts.yml"), "inbox.invalid: {}\n");
  }
  const harnessDir = await installNativeProbe(root, home);
  await writeFile(
    configPath,
    JSON.stringify({
      plugins: [join(home, ".opencode/plugins/abracode"), harnessDir],
      model: "fixture/fallback",
      ...(journey === "engineering"
        ? {
            agent: {
              "external-apply": {
                description: "External native profile fixture",
                mode: "subagent",
                hidden: true,
                prompt: "External native override guidance marker.",
              },
            },
          }
        : {}),
    }),
  );
  const port = await new Promise<number>((done) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = (
        s.address() as {
          port: number;
        }
      ).port;
      s.close(() => done(p));
    });
  });
  await writeFile(
    join(home, "abracode.yaml"),
    `version: 1\nmodels: { default: { providerID: fixture, id: gpt-fixture${journey === "research" ? ", variant: default" : ""} } ${inboxFixture ? ", overrides: { review: { providerID: fixture, id: gpt-specialist } }" : ""} }\nprofiles:\n  native-investigator: { role: research, model: { providerID: fixture, id: gpt-specialist } }\nworktree_root: ${root}/trees\nserver_url: http://127.0.0.1:${port}\nreconcile_interval_ms: 1000\n${journey === "finishing" ? "progress_timeout_ms: { explore: 500, apply: 1800000, review: 900000, research: 900000, operation: 300000 }\n" : ""}${journey === "simplify-loop" ? "supervision_mode: attended-automatic\n" : ""}max_executions: 8\ncommands:\n  forge: ${fakeForge}\n`,
  );
  if (memory) await memory.configure(root, home);
  if (journey === "memos-thoughts" || journey === "agent-memory") {
    await configureMemosFixture(home);
  }
  if (journey === "engineering")
    await writeFile(
      join(home, "abracode.yaml"),
      (await readFile(join(home, "abracode.yaml"), "utf8")) +
        "workers:\n  explore: {definition: engineering-specialist}\n  apply: {agent: external-apply}\n",
    );
  const password = "abracode-disposable-test-password";
  const globalPlugins = join(root, "config/opencode/plugins");
  await mkdir(globalPlugins, { recursive: true });
  await writeFile(
    join(globalPlugins, "legacy-ambient.js"),
    "export const LegacyPlugin = async () => ({});\n",
  );
  const env = {
    ...process.env,
    ...(inboxFixture
      ? {
          ABRACODE_INBOX_FIXTURE_REMOTE: projects[1] + ".git",
          GH_CONFIG_DIR: join(root, "config/gh"),
        }
      : {}),
    PATH: `${join(home, "node_modules/.bin")}:${process.env.PATH}`,
    XDG_CONFIG_HOME: join(root, "config"),
    XDG_DATA_HOME: join(root, "data"),
    XDG_STATE_HOME: join(root, "state"),
    XDG_CACHE_HOME: join(root, "cache"),
    REPORT_CHROMIUM_PATH: reportBrowserExecutable(),
    OPENCODE_CONFIG_DIR: join(home, ".abracode/config/opencode"),
    OPENCODE_CONFIG: configPath,
    ABRACODE_HOME: home,
    ABRACODE_SERVER_PASSWORD: password,
    OPENCODE_SERVER_PASSWORD: password,
    ABRACODE_TEST_MODEL_URL: `http://127.0.0.1:${address.port}/v1`,
    ...(evidenceDirectory ? { ABRACODE_TEST_EVIDENCE_DIR: evidenceDirectory } : {}),
    ABRACODE_TEST_FAULT_PROFILE: journey === "crash-windows" ? "communication-crash" : undefined,
  };
  const start = () => {
    logs = "";
    child = spawn(
      join(home, "node_modules/.bin/opencode"),
      [
        "serve",
        "--print-logs",
        "--log-level",
        "debug",
        "--hostname",
        "127.0.0.1",
        "--port",
        String(port),
      ],
      { cwd: home, env, stdio: ["ignore", "pipe", "pipe"] },
    );
    child.stdout!.on("data", (d) => (logs += d.toString()));
    child.stderr!.on("data", (d) => (logs += d.toString()));
    if (child.pid) resources.native_children.push(child.pid);
    recordResources();
  };
  start();
  // Native administrative fixtures use their own authenticated service. Browser
  // operations are covered by the bounded workspace journey, never a raw proxy.
  const client = OpenCode.make({
    baseUrl: `http://127.0.0.1:${port}`,
    headers: { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}` },
  });
  const ready = async () => {
    await eventually(() => client.server.info());
    await client.location.get({ location: { directory: home } });
    await eventually(async () => {
      const plugins = (await client.plugin.list({ location: { directory: home } })).data;
      const failed = plugins.filter((p) => p.state.status === "failed");
      if (failed.length) throw Object.assign(Error(JSON.stringify(failed)), { terminal: true });
      return ["abracode", "abracode-test"].every((id) =>
        plugins.some((p) => p.id === id && p.state.status === "active"),
      )
        ? true
        : undefined;
    });
  };
  await ready();

  const api = client.rpc(probe);
  const loc = { location: { directory: home } };
  const observer = client.rpc(portableRpc(visibility));
  // Poll retained state without rerunning OpenSpec/Git diagnostics on every
  // tick. Assertions still obtain the complete native work_status response.
  const observeWork = async (id: string) => {
    const page = await nativeObservation(() =>
      observer.find({ state: "all", search: id, limit: 50 }, loc),
    );
    const item = page.entries.find((item) => item.issue_id === id);
    assert.ok(item, `Missing retained work ${id}`);
    return item;
  };
  const atPhase = async (id: string, phase: string) =>
    [phase, "blocked", "failed", "recovery_required"].includes((await observeWork(id)).phase ?? "");
  const tools = (await api.tools({}, loc).catch(async (error) => {
    console.error(
      JSON.stringify(
        (await client.plugin.list(loc)).data.filter((p) => !p.id?.startsWith("opencode.")),
      ),
    );
    console.error(JSON.stringify(await client.config.get(loc)));
    console.error(
      logs
        .split("\n")
        .filter((line) => /error|warn|failed|loading plugin/i.test(line))
        .join("\n")
        .replace(/server password .*/g, "server password [redacted]")
        .replaceAll(password, "[redacted]"),
    );
    throw error;
  })) as {
    tools: Array<{
      id: string;
    }>;
  };
  assert.ok(
    tools.tools.some((t) => t.id === "abra_work_start"),
    logs.replaceAll(password, "[redacted]"),
  );
  assert.ok(
    !(await client.plugin.list(loc)).data.some((p) => p.state?.status === "failed"),
    "Inherited global legacy plugins must not load in the isolated v2 service: " +
      JSON.stringify((await client.plugin.list(loc)).data),
  );
  const supervisor = await client.session.create({
    location: { directory: home },
    title: "Abra",
    metadata: { abracode_supervisor_home: home },
    agent: "abra",
    model: { providerID: "fixture", id: "gpt-fixture" },
  });
  assert.equal((await client.model.default(loc)).data?.id, "fallback");
  await client.session.prompt({
    sessionID: supervisor.id,
    text: "Initialize the Supervisor conversation.",
  });
  await eventually(async () =>
    (await client.session.get({ sessionID: supervisor.id })).outcome === "succeeded"
      ? true
      : undefined,
  );
  const progressUpdates: any[] = [];
  const invokeRaw = async (tool: string, args: any, observeBusy = false) => {
    const deadline = Date.now() + 5000;
    while (true) {
      try {
        const result = (await api.invoke({ tool, args, session: supervisor.id }, loc)) as any;
        assert.equal(result.ok, true);
        progressUpdates.push(...result.probe.progress);
        assert.deepEqual(result.probe.output, {
          ok: true,
          ...(result.result === undefined ? {} : { result: result.result }),
        });
        if (
          !observeBusy &&
          result.result?.category === "operation_in_progress" &&
          Date.now() < deadline
        ) {
          await delay(50);
          continue;
        }
        return result.result;
      } catch (error: any) {
        if (
          error.type === "action_failed" &&
          (error.data.code === "LOCKED" ||
            (["abra_work_list", "abra_work_ready", "abra_work_status"].includes(tool) &&
              error.data.code === "OBSERVATION_UNAVAILABLE")) &&
          Date.now() < deadline
        ) {
          await delay(50);
          continue;
        }
        throw Error(`${error.data?.code ?? error.type}: ${error.message}`, { cause: error });
      }
    }
  };
  const invoke: typeof invokeRaw = (tool, args, observeBusy) => {
    const started = performance.now();
    return invokeRaw(tool, args, observeBusy).finally(() => {
      const elapsed = performance.now() - started;
      const metric = controllerCalls[tool] ?? { count: 0, total_ms: 0, max_ms: 0 };
      metric.count++;
      metric.total_ms += elapsed;
      metric.max_ms = Math.max(metric.max_ms, elapsed);
      controllerCalls[tool] = metric;
    });
  };
  const restart = async (forceAfterMs?: number, afterExit?: () => void) => {
    const owned = child!;
    if (owned.exitCode === null && owned.signalCode === null) {
      await new Promise<void>((done) => {
        const force =
          forceAfterMs === undefined
            ? undefined
            : setTimeout(() => owned.kill("SIGKILL"), forceAfterMs);
        owned.once("exit", () => {
          clearTimeout(force);
          done();
        });
        owned.kill("SIGTERM");
      });
    }
    afterExit?.();
    start();
    await ready();
    await client.location.get({ location: { directory: home } });
  };
  return {
    t,
    journey,
    inboxFixture,
    evidenceDirectory,
    root,
    git,
    engineeringEvidence,
    home,
    projects,
    forgeState,
    port,
    password,
    client,
    api,
    loc,
    observer,
    observeWork,
    atPhase,
    tools,
    supervisor,
    progressUpdates,
    invoke,
    restart,
    mock,
    nativePid: () => {
      assert.ok(child?.pid);
      return child.pid;
    },
  };
}
export type NativeHarness = Awaited<ReturnType<typeof startNativeHarness>>;
