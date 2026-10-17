import { parseDocument } from "yaml";
import { configuration } from "../../src/config/protocol.ts";
import { installSource, installationRoot } from "./install.ts";
import { browserCalls, browserPage, assertBrowserWorker, browserIsolation } from "./browser.ts";
import { workerContextCapabilities } from "./worker-context.ts";
import { prFeedbackLifecycle } from "./pr-feedback.ts";
import * as Id from "../../src/identities.ts";
import { run } from "../effects.ts";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, writeFile, rm, symlink, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { OpenCode } from "@opencode/client";
import { Rpc } from "@opencode/plugin";
import { ProcessRunner } from "../../src/process.ts";
import { Git } from "../../src/git/repository.ts";
import { repo } from "../fixtures.ts";
import { type Execution, type Issue } from "../../src/domain.ts";
import { visibility } from "../../src/visibility/protocol.ts";
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
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function eventually<T>(action: () => Promise<T | undefined>, timeout = 30000) {
  const start = Date.now();
  let last: unknown;
  while (Date.now() - start < timeout) {
    try {
      const result = await action();
      if (result) return result;
    } catch (error) {
      if (error && typeof error === "object" && "terminal" in error) throw error;
      last = error;
    }
    await delay(100);
  }
  throw Error(`Timed out: ${(last as Error)?.message ?? "condition not met"}`);
}
test(
  "real v2 server loads tools and guards across three repositories, executes full OpenSpec through native worker sessions, approvals, preserved branch, cleanup and durable restart",
  { timeout: 300000 },
  async (t) => {
    const root = await installationRoot("abracode-native-");
    const r = new ProcessRunner();
    const git = new Git(r);
    let child: ChildProcess | undefined;
    let logs = "";
    let failFirstExplore = true;
    let missingToolProviderCalls = 0;
    let directWorkerProviderCalls = 0;
    const provider = createServer(async (req, res) => {
      if (req.url?.startsWith("/browser/")) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(browserPage);
        return;
      }
      let body = "";
      for await (const chunk of req) body += chunk;
      const input = JSON.parse(body || "{}");
      if (JSON.stringify(input.messages ?? []).includes("direct-worker-must-not-run"))
        directWorkerProviderCalls++;
      if (JSON.stringify(input.messages ?? []).includes("worker-context-provider-must-not-run"))
        missingToolProviderCalls++;
      const messages = input.messages ?? [];
      const user =
        messages.findLast(
          (m: any) =>
            m.role === "user" && typeof m.content === "string" && m.content.includes("AbraCode"),
        )?.content ??
        messages.findLast((m: any) => m.role === "user")?.content ??
        "";
      const change = /OpenSpec change: ([^. ]+)\./.exec(user)?.[1];
      const role = user.includes("AbraCode explore")
        ? "explore"
        : user.includes("AbraCode apply")
          ? "apply"
          : user.includes("AbraCode research")
            ? "research"
            : user.includes("AbraCode review")
              ? "review"
              : "supervisor";
      if (role === "explore" && failFirstExplore) {
        failFirstExplore = false;
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: {
              message: "Fixture authentication denied; Authorization: Bearer fixture-private-token",
              type: "authentication_error",
            },
          }),
        );
        return;
      }
      if (input.model !== "gpt-fixture") {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: { message: "Worker used the fallback model instead of the Supervisor model" },
          }),
        );
        return;
      }
      const used = new Set(
        messages
          .filter((m: any) => m.role === "assistant")
          .flatMap((m: any) => m.tool_calls ?? [])
          .map((call: any) => call.function.arguments),
      );
      const calls: Array<{
        name: string;
        args: any;
      }> = [];
      if (role === "supervisor" && user.includes("Validate AbraCode tool input contracts")) {
        calls.push(
          {
            name: "abra_work_create",
            args: {
              repository_id: "api",
              title: "Must reject extra arguments",
              description: "Do not create this issue",
              request_id: "invalid-extra",
              extra: true,
            },
          },
          {
            name: "abra_work_create",
            args: {
              repository_id: "api",
              title: "Must reject invalid priority",
              description: "Do not create this issue",
              request_id: "invalid-priority",
              priority: -1,
            },
          },
        );
      } else if (role === "research") {
        const base = /Base commit: ([0-9a-f]+)\./.exec(user)![1];
        const generation = Number(/Control generation: (\d+)/.exec(user)![1]);
        calls.push(
          { name: "read", args: { path: "source.txt" } },
          { name: "write", args: { path: "source.txt", content: "ILLEGAL RESEARCH EDIT" } },
          { name: "shell", args: { command: "touch forbidden-research-shell" } },
          { name: "abra_work_finish", args: { issue_id: "forbidden-research-management" } },
          {
            name: "abra_research_report",
            args: {
              report_id: "native-findings",
              generation,
              conclusions: "Research kept the source unchanged.",
              findings: [
                {
                  finding: "Source has the original sample",
                  evidence: [{ base, path: "source.txt", line: 1 }],
                },
                ...(user.includes("browser-acceptance")
                  ? [
                      {
                        finding:
                          "Browser Increment changed the counter from 0 to 1; captured and read a screenshot in the assigned scratch directory.",
                        evidence: [{ url: `http://127.0.0.1:${address.port}/browser/research` }],
                      },
                    ]
                  : []),
              ],
              acceptance: [
                {
                  criterion: "Identify the source behavior",
                  met: true,
                  evidence: "Read source.txt",
                },
              ],
              limitations: [
                "Temporary native fixture only",
                ...(user.includes("browser-acceptance")
                  ? [
                      "Screenshot files are scratch evidence, not durable report attachments. The unavailable loopback application requires an operator-provided running app.",
                    ]
                  : []),
              ],
            },
          },
        );
      } else if (role === "explore") {
        const base = `openspec/changes/${change}`;
        calls.push(
          {
            name: "abra_worker_progress",
            args: {
              generation: Number(/Control generation: (\d+)/.exec(user)![1]),
              summary: "Inspecting the owned planning request",
            },
          },
          { name: "read", args: { path: join(projects[0], "source.txt") } },
          { name: "write", args: { path: "source.txt", content: "ILLEGAL PLANNING SOURCE EDIT" } },
          {
            name: "write",
            args: {
              path: `${base}/proposal.md`,
              content:
                "## Why\nNeed a sample.\n## What Changes\nAdd sample.\n## Capabilities\n### New Capabilities\n- `sample`: Sample capability.\n### Modified Capabilities\n## Impact\nSample code.\n",
            },
          },
          {
            name: "write",
            args: { path: `${base}/design.md`, content: "## Design\nReturn a sample.\n" },
          },
          {
            name: "write",
            args: {
              path: `${base}/specs/sample/spec.md`,
              content:
                "## Purpose\nProvide stable sample behavior that consumers can request through the sample capability.\n\n## ADDED Requirements\n### Requirement: Sample behavior\nThe system SHALL return a sample.\n#### Scenario: Request sample\n- **WHEN** a sample is requested\n- **THEN** a sample is returned\n",
            },
          },
          {
            name: "write",
            args: {
              path: `${base}/tasks.md`,
              content: "## Implementation\n- [ ] 1.1 Implement sample\n",
            },
          },
        );
      } else if (role === "apply")
        calls.push(
          {
            name: "abra_worker_progress",
            args: {
              generation: Number(/Control generation: (\d+)/.exec(user)![1]),
              summary: "Inspecting the owned planning request",
            },
          },
          { name: "read", args: { path: join(projects[0], "source.txt") } },
          {
            name: "write",
            args: {
              path: "source.txt",
              content:
                user.includes("Approved short scope:") && user.includes("Correction round")
                  ? "sample corrected\n"
                  : "sample\n",
            },
          },
          {
            name: "edit",
            args: {
              path: `openspec/changes/${change}/tasks.md`,
              oldString: "[ ]",
              newString: "[x]",
            },
          },
        );
      else if (role === "review")
        calls.push({
          name: "abra_review_report",
          args: {
            passed:
              !user.includes("Approved short scope:") ||
              (user.includes("Correction round") &&
                !user.includes("Exhaust native correction budget")),
            findings:
              user.includes("Approved short scope:") && !user.includes("Correction round")
                ? "Correct the scoped edge case"
                : "Specification implemented; deterministic check passes.",
            scope_status: "in_scope",
            ...(!user.includes("Approved short scope:")
              ? {
                  spec_verification: {
                    completeness: {
                      status: "passed",
                      evidence:
                        "proposal.md and specs/sample/spec.md map to tasks.md and source.txt.",
                    },
                    correctness: {
                      status: "passed",
                      evidence:
                        "source.txt behavior agrees with the configured deterministic check.",
                    },
                    coherence: {
                      status: "passed",
                      evidence: "source.txt follows design.md and the approved sample behavior.",
                    },
                    conflicts: [],
                  },
                }
              : {}),
          },
        });
      if (role === "supervisor" && user.startsWith("AbraCode attention for ")) {
        const issueID = /AbraCode attention for ([^. ]+)\./.exec(user)![1];
        if (user.includes(": pr_feedback."))
          calls.push({
            name: "abra_work_attention",
            args: {
              issue_id: issueID,
              incident_id: /Incident ([^,]+),/.exec(user)![1],
              generation: Number(/generation (\d+)/.exec(user)![1]),
              action: "handled",
              reason:
                "Inspected retained PR batch; explicit correction follows through the controller",
            },
          });
        else
          calls.push({ name: "abra_work_control", args: { issue_id: issueID, action: "retry" } });
      }
      calls.unshift(...browserCalls(user, role, `http://127.0.0.1:${address.port}`, messages));
      // GPT-family models receive OpenCode's native patch tool, not edit/write.
      for (const call of calls) {
        if (call.name === "write") {
          const path = call.args.path;
          const lines = call.args.content
            .replace(/\n$/, "")
            .split("\n")
            .map((line: string) => "+" + line)
            .join("\n");
          call.name = "patch";
          call.args = {
            patchText: `*** Begin Patch\n*** Add File: ${path}\n${lines}\n*** End Patch`,
          };
        } else if (call.name === "edit") {
          call.name = "patch";
          call.args = {
            patchText: `*** Begin Patch\n*** Update File: ${call.args.path}\n@@\n-- [ ] 1.1 Implement sample\n+- [x] 1.1 Implement sample\n*** End Patch`,
          };
        }
      }
      if (user.includes("Approved short scope:")) {
        for (let i = calls.length - 1; i >= 0; i--)
          if (
            calls[i].args.path?.includes("openspec/") ||
            calls[i].args.patchText?.includes("openspec/")
          )
            calls.splice(i, 1);
      }
      const next = calls.find((c) => !used.has(JSON.stringify(c.args)));
      const toolNames = (input.tools ?? []).map((x: any) => x.function?.name);
      if (next && !toolNames.includes(next.name) && role !== "research") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: {
              message: `Missing role tool ${role}:${next.name}; available ${toolNames.join(",")}`,
            },
          }),
        );
        return;
      }
      const chunks = next
        ? [
            {
              delta: {
                role: "assistant",
                tool_calls: [
                  {
                    index: 0,
                    id: `call_${calls.indexOf(next)}`,
                    type: "function",
                    function: { name: next.name, arguments: JSON.stringify(next.args) },
                  },
                ],
              },
              finish_reason: null,
            },
            { delta: {}, finish_reason: "tool_calls" },
          ]
        : [
            {
              delta: {
                role: "assistant",
                content: user.includes("browser-acceptance")
                  ? "Observed the browser counter change from 0 to 1, captured and read scratch screenshot evidence, and closed the assigned browser. Completed assigned role."
                  : "Completed assigned role.",
              },
              finish_reason: "stop",
            },
          ];
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      for (const chunk of chunks)
        res.write(
          `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 0, model: "fixture", choices: [{ index: 0, ...chunk }] })}\n\n`,
        );
      res.end("data: [DONE]\n\n");
    });
    await new Promise<void>((done) => provider.listen(0, "127.0.0.1", done));
    const address = provider.address() as {
      port: number;
    };
    t.onTestFinished(async () => {
      if (t.task.result?.state === "fail")
        console.error(
          logs
            .split("\n")
            .filter((line) => /error|warn|failed/i.test(line))
            .join("\n")
            .replace(/server password .*/g, "[redacted]"),
        );
      child?.kill("SIGTERM");
      await delay(200);
      await new Promise<void>((done) => provider.close(() => done()));
      await rm(root, { recursive: true, force: true });
    });
    const home = await run(repo(root, "central"));
    const projects = await Promise.all(
      ["frontend", "api", "worker"].map((id) => run(repo(root, id))),
    );
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
    await run(git.run(Id.AbsolutePath.make(projects[1]), ["add", "."]));
    await run(
      git.run(Id.AbsolutePath.make(projects[1]), ["commit", "-m", "Foreign control files"]),
    );
    await run(git.run(Id.AbsolutePath.make(projects[1]), ["push", "origin", "main"]));
    await installSource(home);
    const configPath = join(home, "opencode.json");
    await writeFile(
      configPath,
      JSON.stringify({
        plugins: [resolve(".opencode/plugins/abracode"), resolve("tests/e2e/harness.ts")],
        model: "fixture/fallback",
      }),
    );
    const fakeForge = join(root, "fake-forge.mjs"),
      forgeState = join(root, "forge-state.json");
    await writeFile(fakeForge, await readFile(resolve("tests/e2e/forge.mjs"), "utf8"), {
      mode: 0o755,
    });
    await writeFile(forgeState, JSON.stringify({}));
    // Configured local plugin entries require a directory, not a TS filename.
    const harnessDir = join(root, "probe");
    await mkdir(harnessDir);
    await writeFile(
      join(harnessDir, "package.json"),
      JSON.stringify({ name: "abracode-test", type: "module", exports: "./index.ts" }),
    );
    await writeFile(
      join(harnessDir, "index.ts"),
      await readFile(resolve("tests/e2e/harness.ts"), "utf8"),
    );
    await symlink(join(home, "node_modules"), join(root, "node_modules"));
    await writeFile(
      configPath,
      JSON.stringify({
        plugins: [join(home, ".opencode/plugins/abracode"), harnessDir],
        model: "fixture/fallback",
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
      `version: 1\nmodels: { default: { providerID: fixture, id: gpt-fixture } }\nworktree_root: ${root}/trees\nserver_url: http://127.0.0.1:${port}\nreconcile_interval_ms: 1000\ncommands:\n  forge: ${fakeForge}\n`,
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
      PATH: `${join(home, "node_modules/.bin")}:${process.env.PATH}`,
      XDG_CONFIG_HOME: join(root, "config"),
      XDG_DATA_HOME: join(root, "data"),
      XDG_STATE_HOME: join(root, "state"),
      XDG_CACHE_HOME: join(root, "cache"),
      OPENCODE_CONFIG_DIR: join(home, ".abracode/config/opencode"),
      OPENCODE_CONFIG: configPath,
      ABRACODE_HOME: home,
      ABRACODE_SERVER_PASSWORD: password,
      OPENCODE_SERVER_PASSWORD: password,
      ABRACODE_TEST_MODEL_URL: `http://127.0.0.1:${address.port}/v1`,
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
    };
    start();
    const client = OpenCode.make({
      baseUrl: `http://127.0.0.1:${port}`,
      headers: { Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}` },
    });
    await eventually(() => client.server.info());
    await client.location.get({ location: { directory: home } });
    const api = client.rpc(probe);
    const loc = { location: { directory: home } };
    const observer = client.rpc(visibility);
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
    const invoke = async (tool: string, args: any) => {
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
          return result.result;
        } catch (error: any) {
          if (
            error.type === "action_failed" &&
            error.data.code === "LOCKED" &&
            Date.now() < deadline
          ) {
            await delay(50);
            continue;
          }
          throw Error(`${error.data?.code ?? error.type}: ${error.message}`, { cause: error });
        }
      }
    };
    let managedAPI: any;
    for (let i = 0; i < projects.length; i++) {
      const report = await invoke("abra_project_onboard", {
        id: ["frontend", "api", "worker"][i],
        ...(i === 1 ? { remote: `${projects[i]}.git` } : { path: projects[i] }),
        action: "register",
        verification: [
          [
            process.execPath,
            "-e",
            'const fs=require("fs");if(fs.readFileSync("source.txt","utf8")!=="sample\\n")process.exit(1)',
          ],
        ],
        delivery: "branch",
      });
      if (i === 1) managedAPI = report.project;
    }
    assert.equal((await invoke("abra_project_list", {})).length, 3);
    const beforeInvalid = (await invoke("abra_work_list", {})).issues.length;
    await client.session.prompt({
      sessionID: supervisor.id,
      text: "Validate AbraCode tool input contracts.",
    });
    await client.session.wait({ sessionID: supervisor.id });
    const validationContext = await client.session.context({ sessionID: supervisor.id });
    const invalidCalls = validationContext.flatMap((message) =>
      message.type === "assistant"
        ? message.content.filter((part) => part.type === "tool" && part.name === "abra_work_create")
        : [],
    );
    assert.equal(invalidCalls.length, 2);
    assert.ok(
      invalidCalls.every((part) => part.type === "tool" && part.state.status === "error"),
      JSON.stringify(invalidCalls),
    );
    assert.equal((await invoke("abra_work_list", {})).issues.length, beforeInvalid);
    await assert.rejects(
      observer.detail({ issue_id: Id.IssueId.make("missing") }, loc),
      (error: any) => error.type === "not_found",
    );
    const changes: Array<{ home: string; directory: string }> = [];
    const stopChanges = observer.events.on("changed", (event) => {
      changes.push({ home: event.data.home, directory: event.location.directory });
    });
    t.onTestFinished(stopChanges);
    assert.equal((await observer.snapshot({}, loc)).home, home);
    assert.ok(managedAPI.managed);
    await run(git.run(managedAPI.path, ["config", "user.email", "fixture@example.invalid"]));
    await run(git.run(managedAPI.path, ["config", "user.name", "Fixture"]));
    await writeFile(join(projects[1], "fresh.txt"), "Fetched after onboarding.\n");
    await run(git.run(Id.AbsolutePath.make(projects[1]), ["add", "."]));
    await run(
      git.run(Id.AbsolutePath.make(projects[1]), [
        "commit",
        "-m",
        "Advance remote after onboarding",
      ]),
    );
    await run(git.run(Id.AbsolutePath.make(projects[1]), ["push", "origin", "main"]));
    const freshBase = await run(git.head(Id.AbsolutePath.make(projects[1])));
    assert.notEqual(await run(git.head(managedAPI.path)), freshBase);
    // Bootstrap OpenSpec through the real native API without modifying the cache clone.
    const bootstrap = await run(repo(root, "bootstrap"));
    await run(git.run(Id.AbsolutePath.make(bootstrap), ["rm", "openspec/config.yaml"]));
    await writeFile(join(bootstrap, "AGENTS.md"), "Preserve bootstrap instructions.\n");
    await run(git.run(Id.AbsolutePath.make(bootstrap), ["add", "."]));
    await run(git.run(Id.AbsolutePath.make(bootstrap), ["commit", "-m", "Unconfigured remote"]));
    await run(git.run(Id.AbsolutePath.make(bootstrap), ["push", "origin", "main"]));
    const pendingSetup = await invoke("abra_project_onboard", {
      id: "bootstrap",
      remote: `${bootstrap}.git`,
      action: "register",
      verification: [[process.execPath, "-e", "process.exit(0)"]],
      delivery: "branch",
    });
    assert.ok(pendingSetup.setup_blockers.some((s: string) => s.includes("OpenSpec")));
    await run(
      git.run(pendingSetup.project.path, ["config", "user.email", "fixture@example.invalid"]),
    );
    await run(git.run(pendingSetup.project.path, ["config", "user.name", "Fixture"]));
    const preparedSetup = await invoke("abra_project_setup", {
      id: "bootstrap",
      action: "prepare",
      initialize_openspec: true,
    });
    assert.ok(
      progressUpdates.some((update) => update.stage === "setup" && update.status === "completed"),
    );
    assert.equal(
      await readFile(join(preparedSetup.worktree_directory, "AGENTS.md"), "utf8"),
      "Preserve bootstrap instructions.\n",
    );
    assert.equal(await run(git.dirty(pendingSetup.project.path)), "");
    await invoke("abra_project_setup", { id: "bootstrap", action: "deliver" });
    const finishedSetup = await invoke("abra_project_setup", { id: "bootstrap", action: "finish" });
    assert.equal(finishedSetup.current_phase, "completed");
    const setupRegistry = (await invoke("abra_project_list", {})).find(
      (p: any) => p.id === "bootstrap",
    );
    assert.equal(
      setupRegistry.openspec,
      false,
      "Preserving a setup branch does not change the remote default branch",
    );
    assert.equal(
      (await client.worktree.list({ projectID: setupRegistry.project_id })).some(
        (w) => w.directory === preparedSetup.worktree_directory,
      ),
      false,
    );
    assert.ok(tools.tools.some((tool) => tool.id === "abra_work_create"));
    const goal = {
      repository_id: "api",
      title: "Sample API",
      description: "Add the sample API behavior through a full OpenSpec flow. browser-acceptance",
      request_id: "sample-api",
    };
    const intake = await invoke("abra_work_create", goal);
    const issue = intake.issue as Issue;
    assert.equal(intake.readiness.eligible, true);
    assert.equal((await invoke("abra_work_create", goal)).issue.id, issue.id);
    const frontendIssue = (
      await invoke("abra_work_create", {
        repository_id: "frontend",
        title: "Frontend contract",
        description: "Consume the API contract.",
        dependencies: [issue.id],
        request_id: "frontend-contract",
      })
    ).issue as Issue;
    const workerIssue = (
      await invoke("abra_work_create", {
        repository_id: "worker",
        title: "Worker contract",
        description: "Use the frontend contract.",
        dependencies: [frontendIssue.id],
        request_id: "worker-contract",
      })
    ).issue as Issue;
    assert.equal((await invoke("abra_work_list", {})).issues.length, 3);
    const queue = await invoke("abra_work_ready", {});
    assert.deepEqual(
      queue.filter((row: any) => row.eligible).map((row: any) => row.issue.id),
      [issue.id],
    );
    assert.equal(
      queue.find((row: any) => row.issue.id === frontendIssue.id).dependencies[0].id,
      issue.id,
    );
    let e = (await invoke("abra_work_start", { issue_id: issue.id })) as Execution;
    assert.equal(e.base_commit, freshBase);
    assert.equal(e.target_branch, "main");
    assert.equal(
      await readFile(join(e.worktree_directory!, "fresh.txt"), "utf8"),
      "Fetched after onboarding.\n",
    );
    const failed = await eventually(async () => {
      const status = await invoke("abra_work_status", { issue_id: issue.id });
      return status.execution.current_phase === "failed" ? status.execution : undefined;
    });
    assert.equal(failed.worker_failure.error.status, 403);
    assert.match(failed.error_or_recovery_reason, /authentication denied/);
    const failureDiagnostics = await invoke("abra_work_diagnostics", { issue_id: issue.id });
    assert.equal(failureDiagnostics.sessions[0].error.status, 403);
    assert.equal(failureDiagnostics.sessions[0].model.id, "gpt-fixture");
    assert.ok(!JSON.stringify(failureDiagnostics).includes("fixture-private-token"));
    const nativeAttention = await eventually(async () => {
      const status = await invoke("abra_work_status", { issue_id: issue.id });
      return status.execution.attention?.find((a: any) => a.status === "admitted");
    });
    assert.equal(nativeAttention.code, "worker_failure");
    assert.ok(nativeAttention.prompt_id);
    await eventually(async () => {
      const messages = await client.session.context({ sessionID: supervisor.id });
      return messages.some(
        (m: any) =>
          m.type === "assistant" &&
          m.content.some(
            (part: any) =>
              part.type === "tool" &&
              part.name === "abra_work_control" &&
              part.state.status === "error" &&
              JSON.stringify(part.state.error).includes("ATTENTION_AUTHORITY"),
          ),
      );
    });
    assert.equal(
      (await invoke("abra_work_status", { issue_id: issue.id })).execution.current_phase,
      "failed",
    );
    await invoke("abra_work_attention", {
      issue_id: issue.id,
      incident_id: nativeAttention.id,
      generation: nativeAttention.generation,
      action: "handled",
      reason: "Inspected the fixture provider failure; an explicit retry follows.",
    });
    // Simulate a pre-browser rollout session. Only a deliberate new turn refreshes permissions.
    await client.session.update({
      sessionID: e.explore_session_id!,
      permissions: [{ action: "*", resource: "*", effect: "deny" }],
    });
    for (const delivery of ["steer", "queue"] as const) {
      await assert.rejects(
        client.session.prompt({
          sessionID: e.explore_session_id!,
          text: "direct-worker-must-not-run",
          delivery,
        }),
      );
    }
    assert.equal(directWorkerProviderCalls, 0);
    await assert.rejects(
      client
        .rpc(configuration)
        .reconcile({ session_id: e.explore_session_id!, action: "apply" }, loc),
      (error: any) => error.type === "refused" && error.data.code === "ABRA_REQUIRED",
    );
    const retry = await invoke("abra_work_control", { issue_id: issue.id, action: "retry" });
    assert.equal(retry.explore_session_id, e.explore_session_id);
    assert.equal(retry.worktree_directory, e.worktree_directory);
    assert.equal(retry.configuration_snapshot.workers.explore.model.id, "gpt-fixture");
    e = await eventually(async () => {
      const status = await invoke("abra_work_status", { issue_id: issue.id });
      if (["blocked", "failed", "recovery_required"].includes(status.execution.current_phase))
        throw Error(JSON.stringify(status));
      return status.execution.current_phase === "awaiting_plan_approval"
        ? status.execution
        : undefined;
    }, 40000);
    assert.equal(await readFile(join(e.worktree_directory!, "source.txt"), "utf8"), "original\n");
    await assertBrowserWorker(client, home, e.explore_session_id!);
    const sidebarSnapshot = await observer.snapshot({}, loc);
    const observed = sidebarSnapshot.work.find((work) => work.issue_id === issue.id)!;
    assert.equal(observed.phase, "awaiting_plan_approval");
    assert.ok(observed.sessions.some((session) => session.id === e.explore_session_id));
    const sidebarDetail = await observer.detail({ issue_id: issue.id }, loc);
    assert.match(sidebarDetail.proposal!, /Why/);
    assert.equal(sidebarDetail.progress?.complete, 0);
    await eventually(async () => (changes.length ? true : undefined));
    assert.ok(changes.every((event) => event.home === home));
    await eventually(async () =>
      changes.some((event) => event.directory === e.worktree_directory) ? true : undefined,
    );
    await assert.rejects(
      observer.document({ issue_id: issue.id, path: Id.RelativePath.make("outside.md") }, loc),
      (error: any) => error.type === "invalid_selection",
    );
    assert.equal(sidebarDetail.work.issue_status, "in_progress");
    assert.ok(sidebarDetail.documents?.includes(Id.RelativePath.make("design.md")));
    assert.match(
      (await observer.document({ issue_id: issue.id, path: "design.md" }, loc)).content,
      /Design|design|Context/,
    );
    await assert.rejects(
      observer.report({ issue_id: issue.id }, loc),
      (error: any) => error.type === "resource_unavailable",
    );
    const planningDiff = await observer.diff({ issue_id: issue.id, scope: "all" }, loc);
    assert.equal(planningDiff.base, e.base_commit);
    assert.ok(planningDiff.files.some((file) => file.path.endsWith("proposal.md")));
    assert.ok(planningDiff.patch);
    const workerDiff = await observer.diff(
      { issue_id: issue.id, scope: "all" },
      { location: { directory: e.worktree_directory! } },
    );
    assert.equal(workerDiff.base, e.base_commit);

    assert.equal(
      (await observer.snapshot({}, { location: { directory: e.worktree_directory! } })).home,
      home,
    );
    assert.ok(
      (await client.skill.list({ location: { directory: e.worktree_directory! } })).data.some(
        (s) => s.id === "abra-openspec-execution",
      ),
    );
    const localSkills = (
      await client.skill.list({ location: { directory: e.worktree_directory! } })
    ).data;
    assert.ok(
      localSkills.some((s) => s.id === "abra-browser" && s.content.includes("skills get core")),
    );
    assert.ok(localSkills.some((s) => s.name === "local-fixture"));
    assert.equal(
      await readFile(join(e.worktree_directory!, "AGENTS.md"), "utf8"),
      "Preserve foreign repository instructions.\n",
    );
    assert.equal(
      await run(
        git.run(Id.AbsolutePath.make(e.worktree_directory!), [
          "status",
          "--porcelain",
          "--",
          "AGENTS.md",
          ".opencode",
          ".agents",
        ]),
      ),
      "",
    );
    const planningMessages = await client.session.context({ sessionID: e.explore_session_id! });
    const planningCalls = planningMessages.flatMap((m) =>
      m.type === "assistant" ? m.content.filter((p) => p.type === "tool") : [],
    );
    assert.ok(
      planningCalls.some(
        (p) => p.type === "tool" && p.name === "read" && p.state.status === "completed",
      ),
      "Explore can read another registered repository",
    );
    assert.ok(
      planningCalls.some(
        (p) => p.type === "tool" && p.name === "patch" && p.state.status === "error",
      ),
      "Explore source-edit attempt is rejected by native hook",
    );
    assert.ok(e.explore_session_id);
    const capabilities = await invoke("abra_work_diagnostics", {
      issue_id: issue.id,
      role: "explore",
    });
    assert.ok(capabilities.sessions[0].available_tools.names.includes("patch"));
    assert.ok(!capabilities.sessions[0].available_tools.names.includes("write"));
    assert.equal(capabilities.contexts[0].provenance, "captured");
    assert.equal(capabilities.contexts[0].selection.agent, "build");
    assert.equal(capabilities.contexts[0].skills[0].loading, "unobserved");
    assert.ok(capabilities.contexts[0].status.observation.names.includes("patch"));
    const supervisorProfile = (await client.agent.list(loc)).data.find(
      (agent) => agent.id === "abra",
    );
    assert.ok(
      supervisorProfile?.permissions.some((rule) => rule.action === "*" && rule.effect === "deny"),
    );
    assert.ok(
      !supervisorProfile?.permissions.some(
        (rule) => rule.action === "shell" && rule.effect === "allow",
      ),
    );
    for (const [tool, args] of [
      ["abra_work_create", { ...goal, request_id: "worker-self-create" }],
      ["abra_work_diagnostics", { issue_id: issue.id }],
      [
        "abra_work_pr_action",
        {
          issue_id: issue.id,
          generation: e.control_generation,
          expected_head: e.base_commit,
          kind: "ready",
        },
      ],
      [
        "abra_work_feedback",
        {
          issue_id: issue.id,
          generation: e.control_generation,
          expected_head: e.base_commit,
          finding_ids: ["fixture-finding"],
          disposition: "informational",
          reason: "Must reject worker authority",
        },
      ],
      [
        "abra_work_validation",
        {
          issue_id: issue.id,
          generation: e.control_generation,
          expected_head: e.base_commit,
          action: "preflight",
        },
      ],
    ])
      await assert.rejects(
        api.invoke({ tool, args, session: e.explore_session_id }, loc),
        (error: any) => error.type === "action_failed" && error.data.code === "WORKER_FORBIDDEN",
      );
    assert.equal(
      (await client.session.get({ sessionID: e.explore_session_id! })).location.directory,
      e.worktree_directory,
    );
    const paused = await invoke("abra_work_control", { issue_id: issue.id, action: "pause" });
    assert.ok(paused.stop_status === "requested" || paused.stop_status === "confirmed");
    // A monitor may still own the execution lock when pause returns. Resume only after
    // reconciliation confirms native quiescence and releases the retained writer.
    await eventually(async () => {
      const current = await invoke("abra_work_status", { issue_id: issue.id });
      return current.execution.stop_status === "confirmed" ? current.execution : undefined;
    });
    const resumed = await invoke("abra_work_control", { issue_id: issue.id, action: "resume" });
    assert.equal(resumed.current_phase, "awaiting_plan_approval");
    assert.equal(resumed.explore_session_id, e.explore_session_id);
    const pending = await invoke("abra_work_approve", { issue_id: issue.id, kind: "plan" });
    assert.equal(pending.approval_required, true);
    // A manual edit does not retarget retained work or authorize a pending form.
    const personalPath = join(home, "abracode.yaml");
    const activeConfiguration = parseDocument(await readFile(personalPath, "utf8"));
    activeConfiguration.setIn(["models", "default", "variant"], "default");
    const declared = activeConfiguration.toJS().repositories as Array<{ id: string }>;
    activeConfiguration.set(
      "repositories",
      activeConfiguration.createNode(declared.filter((d) => d.id !== "api")),
    );
    await writeFile(personalPath, activeConfiguration.toString());
    const omitted = await client
      .rpc(configuration)
      .reconcile({ session_id: supervisor.id, action: "status" }, loc);
    assert.equal(omitted.outcomes.find((d) => d.id === "api")?.status, "retained/undeclared");
    assert.equal(
      (await invoke("abra_work_status", { issue_id: issue.id })).execution.worktree_directory,
      e.worktree_directory,
    );
    activeConfiguration.set("repositories", activeConfiguration.createNode(declared));
    await writeFile(personalPath, activeConfiguration.toString());
    const applied = await client
      .rpc(configuration)
      .reconcile({ session_id: supervisor.id, action: "apply" }, loc);
    assert.equal(applied.outcomes.find((d) => d.id === "api")?.status, "registered/ready");
    child!.kill("SIGTERM");
    await new Promise<void>((done) => child!.once("exit", () => done()));
    start();
    await eventually(() => client.server.info());
    await client.location.get({ location: { directory: home } });
    const recovered = await invoke("abra_work_status", { issue_id: issue.id });
    assert.equal(recovered.execution.current_phase, "awaiting_plan_approval");
    assert.equal(recovered.execution.worktree_directory, e.worktree_directory);
    assert.equal(recovered.execution.explore_session_id, e.explore_session_id);
    assert.equal(
      recovered.execution.configuration_snapshot.workers.explore.model.variant,
      undefined,
    );
    assert.equal(
      recovered.execution.configuration_snapshot.digest,
      resumed.configuration_snapshot.digest,
    );
    assert.equal(
      (await client.session.form.list({ sessionID: supervisor.id })).some(
        (form) => form.id === pending.form_id,
      ),
      true,
    );
    await invoke("abra_work_approve", { issue_id: issue.id, kind: "plan" });
    await client.session.form.reply({
      sessionID: supervisor.id,
      formID: pending.form_id,
      answer: { authorize: true },
    });
    const done = (await eventually(async () => {
      const s = await invoke("abra_work_status", { issue_id: issue.id });
      if (["blocked", "failed", "recovery_required"].includes(s.execution.current_phase))
        throw Error(JSON.stringify(s));
      if (s.execution.current_phase === "completed") return s.execution;
      throw Error(JSON.stringify(s));
    }, 40000)) as Execution;
    assert.ok(done.apply_session_id && done.review_session_id);
    await assertBrowserWorker(client, home, done.apply_session_id);
    await assertBrowserWorker(client, home, done.review_session_id);
    await browserIsolation(
      home,
      [e.explore_session_id!, done.apply_session_id],
      `http://127.0.0.1:${address.port}`,
    );
    const nextQueue = await invoke("abra_work_ready", {});
    assert.equal(nextQueue.find((row: any) => row.issue.id === frontendIssue.id).eligible, true);
    assert.equal(nextQueue.find((row: any) => row.issue.id === workerIssue.id).eligible, false);
    assert.equal(
      (await client.session.get({ sessionID: done.apply_session_id! })).location.directory,
      e.worktree_directory,
    );
    assert.equal((await invoke("abra_work_status", { issue_id: issue.id })).issue.status, "closed");
    assert.equal(
      (
        await client.worktree.list({
          projectID: (await client.location.get({ location: { directory: managedAPI.path } }))
            .project.id,
        })
      ).some((w) => w.directory === e.worktree_directory),
      false,
    );
    const researchPath = await run(repo(root, "research-base"));
    await run(git.run(Id.AbsolutePath.make(researchPath), ["rm", "-r", "openspec"]));
    await run(
      git.run(Id.AbsolutePath.make(researchPath), [
        "commit",
        "-m",
        "Research repository without OpenSpec",
      ]),
    );
    await run(git.run(Id.AbsolutePath.make(researchPath), ["push", "origin", "main"]));
    const researchProject = await invoke("abra_project_onboard", {
      id: "research",
      path: researchPath,
      action: "register",
      verification: [],
      plan_approval: false,
      merge_approval: false,
      delivery: "branch",
    });
    assert.equal(researchProject.project.openspec, false);
    const researchIssue = (
      await invoke("abra_work_create", {
        repository_id: "research",
        title: "Research source behavior",
        description: "Read only investigation. browser-acceptance",
        workflow_policy: "research-only",
        scope: {
          goal: "Understand source",
          acceptance: ["Identify the source behavior"],
          constraints: ["Read only"],
        },
        request_id: "native-research",
      })
    ).issue;
    const researchStart = await invoke("abra_work_start", { issue_id: researchIssue.id });
    const researchDone = await eventually(async () => {
      const status = await invoke("abra_work_status", { issue_id: researchIssue.id });
      if (["blocked", "failed", "recovery_required"].includes(status.execution.current_phase)) {
        const messages = await client.session.context({
          sessionID: status.execution.research_session_id,
        });
        const output = messages.flatMap((m: any) =>
          m.type === "assistant"
            ? m.content
                .filter((p: any) => p.type === "tool" && p.name === "abra_research_report")
                .map((p: any) => p.state.content ?? p.state.error)
            : [],
        );
        throw Object.assign(
          new Error(
            `${status.execution.error_or_recovery_reason}; report submission: ${JSON.stringify(output)}`,
          ),
          { terminal: true },
        );
      }
      return status.execution.current_phase === "completed" ? status.execution : undefined;
    });
    await assertBrowserWorker(client, home, researchDone.research_session_id);
    assert.equal(researchDone.delivery_receipt, undefined);
    assert.equal(researchDone.pull_request_reference, undefined);
    assert.ok(researchDone.report_receipt);
    assert.equal(researchDone.research_session_id, researchStart.research_session_id);
    assert.equal(researchDone.configuration_snapshot.workers.research.model.variant, "default");
    assert.notEqual(
      researchDone.configuration_snapshot.digest,
      recovered.execution.configuration_snapshot.digest,
    );
    const researchTools = await invoke("abra_work_diagnostics", {
      issue_id: researchIssue.id,
      role: "research",
    });
    for (const forbidden of ["patch", "write", "edit", "bash", "abra_work_finish"])
      assert.ok(!researchTools.sessions[0].available_tools.names.includes(forbidden));
    assert.match(
      (await observer.report({ issue_id: researchIssue.id }, loc)).content,
      /Research kept/,
    );
    assert.match(
      (await observer.report({ issue_id: researchIssue.id }, loc)).content,
      /scratch evidence, not durable report attachments/,
    );
    assert.equal(await readFile(join(researchPath, "source.txt"), "utf8"), "original\n");
    await invoke("abra_project_onboard", {
      id: "research",
      path: researchPath,
      action: "register",
      repair_rounds: 1,
      verification: [
        [
          "node",
          "-e",
          "if(!require('fs').readFileSync('source.txt','utf8').startsWith('sample'))process.exit(1)",
        ],
      ],
      plan_approval: false,
      merge_approval: false,
      delivery: "branch",
    });
    const lightweightIssue = (
      await invoke("abra_work_create", {
        repository_id: "research",
        title: "Small native fix",
        description: "Implement the explicit scoped request",
        workflow_policy: "lightweight-fix",
        scope: { goal: "Return sample", acceptance: ["Source returns sample"], constraints: [] },
        request_id: "native-lightweight",
        report_reference: {
          issue_id: researchIssue.id,
          report_id: researchDone.report_receipt.report_id,
          hash: researchDone.report_receipt.hash,
        },
      })
    ).issue;
    assert.deepEqual(lightweightIssue.dependencies, [researchIssue.id]);
    await invoke("abra_work_start", { issue_id: lightweightIssue.id });
    const lightweightDone = await eventually(async () => {
      const status = await invoke("abra_work_status", { issue_id: lightweightIssue.id });
      if (["blocked", "failed", "recovery_required"].includes(status.execution.current_phase))
        throw Error(JSON.stringify(status));
      return status.execution.current_phase === "completed" ? status.execution : undefined;
    });
    assert.equal(lightweightDone.archive_path, undefined);
    assert.equal(lightweightDone.rounds.length, 1);
    assert.ok(
      lightweightDone.verification_receipt &&
        lightweightDone.review_receipt &&
        lightweightDone.delivery_receipt,
    );
    const exhaustedIssue = (
      await invoke("abra_work_create", {
        repository_id: "research",
        title: "Exhaust native correction budget",
        description: "Keep failed scoped evidence",
        workflow_policy: "lightweight-fix",
        scope: { goal: "Return sample", acceptance: ["Source returns sample"], constraints: [] },
        request_id: "native-exhausted",
      })
    ).issue;
    await invoke("abra_work_start", { issue_id: exhaustedIssue.id });
    const exhausted = await eventually(async () => {
      const status = await invoke("abra_work_status", { issue_id: exhaustedIssue.id });
      if (status.execution.current_phase === "blocked" && !status.execution.decisions?.length)
        throw Error(JSON.stringify(status.execution));
      return status.execution.current_phase === "blocked" &&
        status.execution.decisions?.some((d: any) => d.status === "open")
        ? status.execution
        : undefined;
    });
    assert.equal(exhausted.rounds.length, 1);
    assert.match(
      exhausted.decisions.find((d: any) => d.status === "open").question,
      /budget exhausted/,
    );
    const feedbackIssue = await prFeedbackLifecycle({
      root,
      forgeState,
      invoke,
      eventually,
      approve: async (formID) => {
        await client.session.form.reply({
          sessionID: supervisor.id,
          formID,
          answer: { authorize: true },
        });
      },
      feedback: (issue_id) => observer.feedback({ issue_id }, loc),
    });
    const retainedContext = (
      await invoke("abra_work_diagnostics", { issue_id: issue.id, role: "explore" })
    ).contexts[0];
    await writeFile(
      join(home, ".opencode/agents/central-only.md"),
      "---\ndescription: Only registered in the central test project\nmode: subagent\n---\nCentral fixture profile.\n",
    );
    const configBeforeRestart = await readFile(join(home, "abracode.yaml"), "utf8");
    await writeFile(
      join(home, "abracode.yaml"),
      configBeforeRestart +
        "max_executions: 8\nworkers:\n  explore: {agent: central-only}\n  research: {required_skills: [missing-worker-skill]}\n",
    );
    child!.kill("SIGTERM");
    await new Promise<void>((done) => child!.once("exit", () => done()));
    start();
    await eventually(() => client.server.info());
    await client.location.get({ location: { directory: home } });
    assert.equal(
      (await invoke("abra_work_status", { issue_id: issue.id })).execution.current_phase,
      "completed",
    );
    assert.equal(
      (await observer.snapshot({}, loc)).work.find((work) => work.issue_id === issue.id)
        ?.issue_status,
      "closed",
    );
    assert.ok((await observer.detail({ issue_id: issue.id }, loc)).archive);
    assert.match(
      (await observer.report({ issue_id: researchIssue.id }, loc)).content,
      /Research kept/,
    );
    assert.equal(
      (await invoke("abra_work_status", { issue_id: exhaustedIssue.id })).execution.rounds.length,
      1,
    );
    assert.equal(
      (await observer.feedback({ issue_id: feedbackIssue.id }, loc)).actions.filter(
        (a) => a.kind === "resolve" && a.status === "confirmed",
      ).length,
      1,
    );
    const recoveredAttention = (await invoke("abra_work_status", { issue_id: issue.id })).execution
      .attention;
    assert.equal(
      recoveredAttention.find((a: any) => a.id === nativeAttention.id).prompt_id,
      nativeAttention.prompt_id,
    );
    const retiredDiff = await observer.diff(
      { issue_id: issue.id, scope: "all", file: "source.txt" },
      loc,
    );
    assert.ok(retiredDiff.historical);
    assert.match(retiredDiff.patch!, /original/);
    assert.equal(
      (await invoke("abra_work_diagnostics", { issue_id: issue.id, role: "explore" })).contexts[0]
        .context_id,
      retainedContext.context_id,
    );
    assert.ok((await client.agent.list(loc)).data.some((agent) => agent.id === "central-only"));
    await workerContextCapabilities({
      root,
      git,
      invoke,
      eventually,
      providerCalls: () => missingToolProviderCalls,
    });
  },
);
