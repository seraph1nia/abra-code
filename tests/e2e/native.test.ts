import { acceptanceJourney } from "./acceptance.ts";
import { reportJourney } from "./reports.ts";
import { leadJourney } from "./leads.ts";
import { modelDispatchJourney } from "./model-dispatch.ts";
import { parallelJourney } from "./parallel.ts";
import { parseDocument } from "yaml";
import { configuration } from "../../src/config/protocol.ts";
import { installSource, installationRoot } from "./install.ts";
import { browserCalls, browserPage, assertBrowserWorker, browserIsolation } from "./browser.ts";
import { capturePreSuite, assertPreSuiteAfterRestart } from "./engineering-recovery.ts";
import { engineeringCalls, assertEngineeringWorker } from "./engineering.ts";
import { engineeringSkills } from "../../src/opencode/engineering-skills.ts";
import { workerContextCapabilities } from "./worker-context.ts";
import { prFeedbackLifecycle } from "./pr-feedback.ts";
import * as Id from "../../src/identities.ts";
import { run } from "../effects.ts";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, writeFile, rm, rename, symlink, readFile, access } from "node:fs/promises";
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
  { timeout: 420000 },
  async (t) => {
    const root = await installationRoot("abracode-native-");
    const r = new ProcessRunner();
    const git = new Git(r);
    let child: ChildProcess | undefined;
    let logs = "";
    const engineeringEvidence: unknown[] = [];
    const reviewedTrees = new Set<string>();
    let failFirstExplore = true;
    let stallFirstExplore = false;
    let missingToolProviderCalls = 0;
    let directWorkerProviderCalls = 0;
    let holdExplore = false;
    let exploreHeld = false;
    let releaseExplore: (() => void) | undefined;
    let steeringProviderCalls = 0;
    let cancelledSteeringProviderCalls = 0;
    let holdModelWorker = false,
      modelWorkerHeld = false;
    let releaseModelWorker: (() => void) | undefined;
    let holdLeadResearch = false,
      leadResearchHeld = false;
    let releaseLeadResearch: (() => void) | undefined;
    let holdApply = false,
      applyHeld = false;
    let releaseApply: (() => void) | undefined;
    let failedCorrelatedRequest = false;
    const parallelSeen = new Set<string>(),
      parallelReleased = new Set<string>();
    const parallelWaiting = new Map<string, Array<() => void>>();
    const releaseParallel = (key: string) => {
      parallelReleased.add(key);
      for (const done of parallelWaiting.get(key) ?? []) done();
      parallelWaiting.delete(key);
    };
    const acceptanceSeen = new Set<string>(),
      acceptanceReleased = new Set<string>();
    const acceptanceWaiting = new Map<string, Array<() => void>>();
    const releaseAcceptance = (key: string) => {
      acceptanceReleased.add(key);
      for (const done of acceptanceWaiting.get(key) ?? []) done();
      acceptanceWaiting.delete(key);
    };
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
      const hasUserMarker = (marker: string) =>
        messages.some((m: any) => m.role === "user" && JSON.stringify(m.content).includes(marker));
      if (hasUserMarker("controller-steering-native-marker")) steeringProviderCalls++;
      if (hasUserMarker("controller-cancel-native-marker")) cancelledSteeringProviderCalls++;
      const user =
        messages.findLast(
          (m: any) =>
            m.role === "user" &&
            typeof m.content === "string" &&
            /You are the AbraCode (explore|apply|review|research) for issue/.test(m.content),
        )?.content ??
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
      const acceptanceKey = user.includes("final-acceptance-authentication")
        ? role === "explore"
          ? "auth-explore"
          : role === "apply"
            ? "auth-apply"
            : undefined
        : role === "research" && user.includes("final-acceptance-database")
          ? "db-research"
          : undefined;
      if (acceptanceKey && !acceptanceReleased.has(acceptanceKey)) {
        acceptanceSeen.add(acceptanceKey);
        await new Promise<void>((done) =>
          acceptanceWaiting.set(acceptanceKey, [
            ...(acceptanceWaiting.get(acceptanceKey) ?? []),
            done,
          ]),
        );
      }
      const parallelKey =
        role === "research" ? /parallel-lane-([a-z]+)/.exec(user)?.[1] : undefined;
      if (parallelKey) {
        parallelSeen.add(parallelKey);
        if (!parallelReleased.has(parallelKey))
          await new Promise<void>((done) =>
            parallelWaiting.set(parallelKey, [...(parallelWaiting.get(parallelKey) ?? []), done]),
          );
      }
      if (role === "research" && holdLeadResearch && user.includes("lead-blocker-investigation")) {
        holdLeadResearch = false;
        leadResearchHeld = true;
        await new Promise<void>((done) => {
          releaseLeadResearch = done;
        });
      }
      if (role === "research" && holdModelWorker && user.includes("model-capture-acceptance")) {
        holdModelWorker = false;
        modelWorkerHeld = true;
        await new Promise<void>((done) => {
          releaseModelWorker = done;
        });
      }
      if (role === "explore" && holdExplore) {
        holdExplore = false;
        exploreHeld = true;
        await new Promise<void>((done) => (releaseExplore = done));
      }
      if (role === "apply" && holdApply) {
        holdApply = false;
        applyHeld = true;
        await new Promise<void>((done) => (releaseApply = done));
      }
      if (
        role === "review" &&
        user.includes("engineering-acceptance") &&
        !user.includes("Approved short scope:") &&
        !reviewedTrees.has(user)
      ) {
        reviewedTrees.add(user);
        const directory = /Worktree: ([^\n]+)/.exec(user)![1];
        const status = await run(
          git.run(Id.AbsolutePath.make(directory), ["status", "--porcelain"]),
        );
        assert.match(status, / M source.txt/);
        assert.match(status, /\?\? sample-proof.mjs/);
        engineeringEvidence.push({ review_tree: directory, status });
      }
      if (role === "explore" && failFirstExplore) {
        failFirstExplore = false;
        if (stallFirstExplore) {
          stallFirstExplore = false;
          await delay(2500);
        }
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
      if (
        role === "apply" &&
        !failedCorrelatedRequest &&
        hasUserMarker("native-request-failure") &&
        messages.some(
          (m: any) =>
            m.role === "assistant" &&
            m.tool_calls?.some((call: any) =>
              call.function.arguments.includes("native-research-handoff"),
            ),
        )
      ) {
        failedCorrelatedRequest = true;
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: {
              message: "Fixture correlated request provider failure",
              type: "authentication_error",
            },
          }),
        );
        return;
      }
      if (!["gpt-fixture", "gpt-specialist"].includes(input.model)) {
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
      const correlated = messages.filter(
        (m: any) =>
          m.role === "user" &&
          typeof m.content === "string" &&
          m.content.startsWith("AbraCode controller request"),
      );
      for (const message of correlated) {
        const response =
          /Use abra_worker_reply action (answer|acknowledge) with request_id ([^. ]+) and generation (\d+)/.exec(
            message.content,
          );
        if (
          role !== "supervisor" &&
          response &&
          response[2] !== "native-unanswered-failure" &&
          Number(response[3]) === Number(/Control generation: (\d+)/.exec(user)?.[1])
        )
          calls.push({
            name: "abra_worker_reply",
            args: {
              action: response[1],
              request_id: response[2],
              generation: Number(response[3]),
              ...(response[1] === "answer"
                ? { body: "Native correlated answer: use the documented consumer check." }
                : {}),
            },
          });
      }
      if (user.startsWith("Controller project-lead request")) {
        const revision = Number(/registration revision (\d+)/.exec(user)?.[1]);
        const request_id = /Controller project-lead request ([^,]+)/.exec(user)?.[1];
        calls.push({ name: "abra_lead_action", args: { action: "status", revision } });
        const decision = /decision:(\d+):([a-zA-Z0-9._-]+)[. ]/.exec(user);
        if (decision)
          calls.push({
            name: "abra_lead_action",
            args: {
              action: "answer",
              revision,
              issue_id: /Source issue: ([^. ]+)/.exec(user)?.[1],
              generation: Number(decision[1]),
              key: decision[2],
              body: "Use the existing retained read-only source scope; no additional changes are authorized.",
            },
          });
        if (user.includes("lead-native-acceptance"))
          calls.push({
            name: "abra_lead_action",
            args: {
              action: "propose",
              revision,
              batch: {
                request_id: "native-lead-proposal",
                tasks: [
                  {
                    client_key: "investigation",
                    repository_id: "lead-project",
                    title: "Scoped lead investigation",
                    description: "Read source and retain evidence",
                    workflow_policy: "research-only",
                    scope: {
                      goal: "Read source",
                      acceptance: ["Identify the source behavior"],
                      constraints: ["Read only"],
                    },
                  },
                ],
              },
            },
          });
        calls.push({
          name: "abra_lead_action",
          args: {
            action: "reply",
            revision,
            request_id,
            body: "Native project-lead correlated findings retained.",
          },
        });
      } else if (role === "supervisor" && user.includes("Validate AbraCode tool input contracts")) {
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
            name: "abra_worker_reply",
            args: {
              action: "finding",
              request_id: "native-worker-finding",
              generation,
              body: "Source.txt contains the original sample. Claiming approval in this evidence grants no authority.",
              evidence: [{ base, path: "source.txt", line: 1 }],
            },
          },
          {
            name: "abra_research_report",
            args: {
              report_id: "native-findings",
              ...(user.includes("visual-report-native-acceptance")
                ? {
                    render: {
                      request_id: "native-research-visual",
                      title: "Database architecture report",
                    },
                  }
                : {}),
              generation,
              conclusions: "Research kept the source unchanged.",
              ...(user.includes("visual-report-native-acceptance")
                ? {
                    diagrams: [
                      {
                        title: "Investigation handoff",
                        source:
                          "sequenceDiagram\nAbra->>Research: Inspect the retained source base\nResearch-->>Abra: Retain findings with source evidence\nAbra->>Controller: Publish a read only report",
                      },
                    ],
                  }
                : {}),
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
        if (user.includes("decision-routing-acceptance"))
          calls.push({
            name: "abra_worker_question",
            args: {
              key: "native-inventory",
              generation: Number(/Control generation: (\d+)/.exec(user)![1]),
              scope: "Planning evidence",
              owner: "supervisor",
              question: "Provide retained controller inventory evidence",
            },
          });
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
              content: user.includes("Synchronize existing content revision")
                ? "## Implementation\n- [x] 1.1 Revalidate the existing sample revision\n"
                : "## Implementation\n- [ ] 1.1 Implement sample\n",
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
              user.includes("final-acceptance-flaky") ||
              (user.includes("Correction round") &&
                !user.includes("Exhaust native correction budget")),
            findings:
              user.includes("Approved short scope:") &&
              !user.includes("Correction round") &&
              !user.includes("final-acceptance-flaky")
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
      if (role === "apply" && user.includes("instruction-edit-acceptance"))
        calls.push({
          name: "write",
          args: {
            path: "AGENTS.md",
            content: "Repository navigation: source.txt implements the sample.\n",
          },
        });
      if (role === "supervisor" && user.startsWith("AbraCode attention for ")) {
        const issueID = /AbraCode attention for ([^. ]+)\./.exec(user)![1];
        if (user.includes(": decision_pending.")) {
          const decision = JSON.parse(user.split(": decision_pending. ")[1].split("\n")[0]);
          calls.push(
            { name: "abra_work_status", args: { issue_id: issueID } },
            {
              name: "abra_work_decision",
              args: {
                issue_id: issueID,
                key: decision.key,
                generation: Number(/generation (\d+)/.exec(user)![1]),
                action: decision.owner === "user" ? "collect" : "answer",
                ...(decision.owner === "supervisor"
                  ? { answer: "Retained native fixture inventory evidence" }
                  : {}),
              },
            },
            {
              name: "abra_work_attention",
              args: {
                issue_id: issueID,
                incident_id: /Incident ([^,]+),/.exec(user)![1],
                generation: Number(/generation (\d+)/.exec(user)![1]),
                action: "handled",
                reason: "Answered the retained worker question in the main Supervisor session",
              },
            },
          );
        } else if (
          user.includes(": worker_failure.") &&
          user.includes("Fixture correlated request provider failure")
        )
          calls.push({
            name: "abra_work_attention",
            args: {
              issue_id: issueID,
              incident_id: /Incident ([^,]+),/.exec(user)![1],
              generation: Number(/generation (\d+)/.exec(user)![1]),
              action: "user_needed",
              reason: "Retained unanswered request and provider failure require explicit recovery",
            },
          });
        else if (user.includes(": message_update.") || user.includes(": message_pending."))
          calls.push(
            { name: "abra_work_messages", args: { issue_id: issueID } },
            {
              name: "abra_work_attention",
              args: {
                issue_id: issueID,
                incident_id: /Incident ([^,]+),/.exec(user)![1],
                generation: Number(/generation (\d+)/.exec(user)![1]),
                action: user.includes(": message_pending.") ? "user_needed" : "handled",
                reason:
                  "Inspected retained worker communication; preserved outstanding requests and controller gates",
              },
            },
          );
        else if (user.includes(": pr_feedback."))
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
      if (role === "explore" && user.includes("engineering-unavailable-evidence")) {
        const spec = calls.find((c) => c.args.path?.endsWith("specs/sample/spec.md"))!;
        spec.args.content +=
          "\n### Requirement: Runtime evidence\nThe system SHALL expose runtime audit evidence for the sample.\n#### Scenario: Inspect runtime audit\n- **WHEN** the sample is exercised in the runtime\n- **THEN** its runtime audit evidence can be inspected\n";
      }
      if (role === "apply" && user.includes("engineering-unavailable-evidence")) {
        calls.push({
          name: "abra_worker_progress",
          args: {
            generation: Number(/Control generation: (\d+)/.exec(user)![1]),
            summary:
              "Runtime audit prerequisite is unavailable in this foreign fixture. Existing documented source check covers sample content only; no local recipe can establish the required runtime audit observation. No recipe, glossary or host setup was created.",
          },
        });
      }
      if (role === "review" && user.includes("engineering-unavailable-evidence")) {
        calls.unshift(
          { name: "skill", args: { id: "abra-verification" } },
          { name: "read", args: { path: "unavailable-proof.json" } },
        );
        const report = calls.find((c) => c.name === "abra_review_report")!.args;
        report.passed = false;
        report.findings =
          "Required behavior proof unavailable; loaded guidance does not verify it. Keep accepted planning unchanged.";
        report.scope_status = "uncertain";
        report.spec_verification.correctness = {
          status: "not_verified",
          evidence:
            "unavailable-proof.json is absent and the configured source check cannot establish the additional claimed runtime observation.",
        };
      }
      calls.unshift(...browserCalls(user, role, `http://127.0.0.1:${address.port}`, messages));
      calls.unshift(...engineeringCalls(user, role));
      if (
        role === "apply" &&
        user.includes("engineering-acceptance") &&
        !user.includes("Approved short scope:")
      )
        calls.push({
          name: "shell",
          args: { command: "node sample-proof.mjs # original-scenario recheck" },
        });
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
      if (
        next &&
        !toolNames.includes(next.name) &&
        role !== "research" &&
        !(
          user.includes("engineering-acceptance") &&
          ["abra_work_finish", "task"].includes(next.name)
        )
      ) {
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
      for (const key of ["auth-explore", "db-research", "auth-apply"]) releaseAcceptance(key);
      releaseLeadResearch?.();
      const recordEvidence = async (cleanupComplete: boolean) => {
        if (!process.env.ABRACODE_TEST_EVIDENCE_DIR) return;
        const evidenceDir = resolve(process.env.ABRACODE_TEST_EVIDENCE_DIR);
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
              fixture: "tests/e2e/native.test.ts",
              result: cleanupComplete ? t.task.result?.state : "fail",
              cleanup_complete: cleanupComplete,
              errors: t.task.result?.errors?.map((error) => error.message),
              observed_at: new Date().toISOString(),
              isolation:
                "Disposable service/data/config, loopback provider and local bare remotes; no operator service or user remote",
              observations: engineeringEvidence,
            },
            null,
            2,
          ) + "\n",
        );
        await access(path);
      };
      try {
        releaseExplore?.();
        releaseApply?.();
        releaseModelWorker?.();
        for (const key of ["one", "two", "three", "dependent"]) releaseParallel(key);
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
        await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        await recordEvidence(true);
      } catch (error) {
        await recordEvidence(false);
        throw error;
      }
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
    await writeFile(
      join(projects[1], "README.md"),
      '# Fixture verification\n\nThe existing source-content check is:\n\n```sh\nnode -e \'if(require("fs").readFileSync("source.txt","utf8")!=="sample\\n")process.exit(1)\'\n```\n\nNo runtime audit service or verification recipe is supplied.\n',
    );
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
      `version: 1\nmodels: { default: { providerID: fixture, id: gpt-fixture } }\nprofiles:\n  native-investigator: { role: research, model: { providerID: fixture, id: gpt-specialist } }\nworktree_root: ${root}/trees\nserver_url: http://127.0.0.1:${port}\nreconcile_interval_ms: 1000\nmax_executions: 8\ncommands:\n  forge: ${fakeForge}\n`,
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
    const invoke = async (tool: string, args: any, observeBusy = false) => {
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
    const runParallel = () =>
      parallelJourney({
        supervisor: Id.SessionId.make(supervisor.id),
        workerQuestion: async (session, args) =>
          (
            (await api.invoke(
              { tool: "abra_worker_question", args, session: Id.SessionId.make(session) },
              loc,
            )) as any
          ).result,
        root,
        home,
        client,
        invoke,
        eventually,
        seen: parallelSeen,
        release: releaseParallel,
        restart: async () => {
          child!.kill("SIGTERM");
          await new Promise<void>((done) => child!.once("exit", () => done()));
          start();
          await eventually(() => client.server.info());
          await client.location.get({ location: { directory: home } });
        },
      });
    const runModels = () =>
      modelDispatchJourney({
        root,
        home,
        invoke,
        eventually,
        restart: async () => {
          child!.kill("SIGTERM");
          await new Promise<void>((done) => child!.once("exit", () => done()));
          start();
          await eventually(() => client.server.info());
          await client.location.get({ location: { directory: home } });
        },
        hold: () => {
          holdModelWorker = true;
          modelWorkerHeld = false;
        },
        held: () => modelWorkerHeld,
        release: () => releaseModelWorker?.(),
      });
    const runLeads = () =>
      leadJourney({
        root,
        home,
        client,
        supervisor: supervisor.id,
        invoke,
        eventually,
        holdResearch: () => {
          holdLeadResearch = true;
          leadResearchHeld = false;
        },
        held: () => leadResearchHeld,
        releaseResearch: () => releaseLeadResearch?.(),
        leadTool: async (session, tool, args) =>
          ((await api.invoke({ tool, args, session }, loc)) as any).result,
        restart: async () => {
          child!.kill("SIGTERM");
          await new Promise<void>((done) => child!.once("exit", () => done()));
          start();
          await eventually(() => client.server.info());
          await client.location.get({ location: { directory: home } });
        },
      });
    const runReports = () =>
      reportJourney({
        root,
        home,
        client,
        supervisor: supervisor.id,
        invoke,
        eventually,
        workerTool: async (session, tool, args) =>
          ((await api.invoke({ tool, args, session }, loc)) as any).result,
        restart: async () => {
          child!.kill("SIGTERM");
          await new Promise<void>((done) => child!.once("exit", () => done()));
          start();
          await eventually(() => client.server.info());
          await client.location.get({ location: { directory: home } });
        },
      });
    const runAcceptance = () => {
      failFirstExplore = false;
      return acceptanceJourney({
        root,
        home,
        client,
        supervisor: supervisor.id,
        invoke,
        eventually,
        seen: acceptanceSeen,
        release: releaseAcceptance,
        restart: async () => {
          child!.kill("SIGTERM");
          await new Promise<void>((done) => child!.once("exit", () => done()));
          start();
          await eventually(() => client.server.info());
          await client.location.get({ location: { directory: home } });
        },
      });
    };
    if (process.env.ABRACODE_TEST_JOURNEY === "acceptance") {
      engineeringEvidence.push(await runAcceptance());
      return;
    }
    if (process.env.ABRACODE_TEST_JOURNEY === "reports") {
      engineeringEvidence.push(await runReports());
      return;
    }
    if (process.env.ABRACODE_TEST_JOURNEY === "leads") {
      engineeringEvidence.push(await runLeads());
      return;
    }
    if (process.env.ABRACODE_TEST_JOURNEY === "models") {
      engineeringEvidence.push(await runModels());
      return;
    }
    if (process.env.ABRACODE_TEST_JOURNEY === "parallel") {
      engineeringEvidence.push(await runParallel());
      return;
    }
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
          ...(i === 1 ? [[process.execPath, "sample-proof.mjs"]] : []),
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
    const observeChanges = () =>
      observer.events.on("changed", (event) => {
        changes.push({ home: event.data.home, directory: event.location.directory });
      });
    const stopChanges = observeChanges();
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
      description:
        "Add the sample API behavior and update AGENTS.md navigation through a full OpenSpec flow. browser-acceptance decision-routing-acceptance instruction-edit-acceptance engineering-acceptance",
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
    holdExplore = true;
    const retry = await invoke("abra_work_control", { issue_id: issue.id, action: "retry" });
    assert.equal(retry.explore_session_id, e.explore_session_id);
    assert.equal(retry.worktree_directory, e.worktree_directory);
    assert.equal(retry.configuration_snapshot.workers.explore.model.id, "gpt-fixture");
    await eventually(async () => (exploreHeld ? true : undefined));
    try {
      const replay = await client.session.prompt({
        sessionID: retry.explore_session_id!,
        id: retry.prompt_id!,
        text: "direct-worker-must-not-run: changed payload under an already admitted assignment ID",
        delivery: "queue",
      });
      assert.equal(replay.id, retry.prompt_id);
      assert.ok(!replay.payload.text.includes("direct-worker-must-not-run"));
      engineeringEvidence.push({
        steering_identity_replay: "native returns original payload before invoking the prompt hook",
        assignment_prompt_id: retry.prompt_id,
        session_id: retry.explore_session_id,
        changed_payload_accepted: false,
        native_request_rejected: false,
        direct_provider_calls: directWorkerProviderCalls,
      });
      await invoke("abra_work_control", {
        issue_id: issue.id,
        action: "steer",
        request_id: "native-steering",
        text: "controller-steering-native-marker: Continue the retained assignment within its approved scope.",
      });
      await invoke("abra_work_control", {
        issue_id: issue.id,
        action: "steer",
        request_id: "native-steering",
        text: "controller-steering-native-marker: Continue the retained assignment within its approved scope.",
      });
      await assert.rejects(
        invoke("abra_work_control", {
          issue_id: issue.id,
          action: "steer",
          request_id: "native-steering",
          text: "Changed instruction",
        }),
        /MESSAGE_REBIND/,
      );
      const retained = (await invoke("abra_work_status", { issue_id: issue.id })).execution;
      assert.equal(retained.prompt_id, retry.prompt_id);
      assert.equal(retained.worker_context_id, retry.worker_context_id);
      assert.equal(retained.messages.length, 1);
      assert.notEqual(retained.messages[0].prompt_id, retry.prompt_id);
      const inbox = await client.session.inbox.list({ sessionID: retry.explore_session_id! });
      assert.equal(inbox.filter((m) => m.id === retained.messages[0].prompt_id).length, 1);
      for (const delivery of ["queue", "steer"] as const)
        await assert.rejects(
          client.session.prompt({
            sessionID: retry.explore_session_id!,
            text: "direct-worker-must-not-run",
            delivery,
            metadata: { source: "abracode" },
          }),
        );
      // Let the first steer reach the provider, then hold that request while a
      // second instruction is queued. Pause must withdraw it before another turn.
      exploreHeld = false;
      holdExplore = true;
      releaseExplore?.();
      await eventually(async () => (exploreHeld ? true : undefined));
      assert.ok(steeringProviderCalls > 0);
      const queued = await invoke("abra_work_control", {
        issue_id: issue.id,
        action: "steer",
        request_id: "native-steering-cancel",
        text: "controller-cancel-native-marker: This pending instruction must be withdrawn.",
      });
      const withdrawnID = queued.messages.find(
        (m: any) => m.request_id === "native-steering-cancel",
      ).prompt_id;
      assert.ok(
        (await client.session.inbox.list({ sessionID: retry.explore_session_id! })).some(
          (m) => m.id === withdrawnID,
        ),
      );
      const paused = await invoke("abra_work_control", { issue_id: issue.id, action: "pause" });
      assert.equal(paused.stop_status, "confirmed");
      assert.ok(paused.messages.every((m: any) => m.status === "superseded"));
      assert.equal(
        (await client.session.inbox.list({ sessionID: retry.explore_session_id! })).length,
        0,
      );
      await assert.rejects(
        invoke("abra_work_control", {
          issue_id: issue.id,
          action: "steer",
          request_id: "native-stale-generation",
          text: "Must not run",
        }),
        /STEER/,
      );
      await assert.rejects(
        client.session.prompt({
          sessionID: retry.explore_session_id!,
          text: "direct-worker-must-not-run",
          delivery: "steer",
          metadata: { source: "abracode", generation: retry.control_generation },
        }),
      );
      engineeringEvidence.push({
        steering_pause: "queued instruction withdrawn; generation superseded",
        prompt_id: withdrawnID,
        stop_status: paused.stop_status,
        pending_native_items: 0,
      });
    } catch (error) {
      engineeringEvidence.push({
        steering: "controller admission refused",
        assignment_prompt_id: retry.prompt_id,
        session_id: retry.explore_session_id,
        provider_marker_calls: steeringProviderCalls,
        error: String(error),
      });
      throw error;
    } finally {
      releaseExplore?.();
    }
    exploreHeld = false;
    holdExplore = true;
    const resumedSteering = await invoke("abra_work_control", {
      issue_id: issue.id,
      action: "resume",
    });
    assert.equal(resumedSteering.explore_session_id, retry.explore_session_id);
    assert.equal(resumedSteering.worktree_directory, retry.worktree_directory);
    assert.equal(resumedSteering.configuration_snapshot.workers.explore.model.id, "gpt-fixture");
    await eventually(async () => (exploreHeld ? true : undefined));
    try {
      const message = {
        issue_id: issue.id,
        request_id: "native-correlated-answer",
        role: "explore",
        body: "Which verification command should the implementation use?",
        kind: "question",
        response: "answer",
        delivery: "queue",
      };
      const admitted = await invoke("abra_work_message", message);
      assert.equal(admitted.status, "admitted");
      assert.equal((await invoke("abra_work_message", message)).prompt_id, admitted.prompt_id);
      assert.equal((await invoke("abra_work_messages", { issue_id: issue.id })).outstanding, 1);
      const workerSession = resumedSteering.explore_session_id;
      child!.kill("SIGTERM");
      await new Promise<void>((done) => child!.once("exit", () => done()));
      releaseExplore?.();
      start();
      await eventually(() => client.server.info());
      await client.location.get({ location: { directory: home } });
      stopChanges();
      t.onTestFinished(observeChanges());
      const recoveredMessage = await invoke("abra_work_message", message);
      assert.equal(recoveredMessage.prompt_id, admitted.prompt_id);
      assert.equal(recoveredMessage.recipient_session_id, workerSession);
      const nativeQueued = await client.session.inbox.list({ sessionID: workerSession });
      const nativeHistory = await client.session.context({ sessionID: workerSession });
      assert.ok(
        nativeQueued.some((m) => m.id === admitted.prompt_id) ||
          nativeHistory.some((m) => m.id === admitted.prompt_id),
      );
      engineeringEvidence.push({
        queued_message_restart: admitted.request_id,
        prompt_id: admitted.prompt_id,
        recipient_session_id: workerSession,
        controller_identity_reused: true,
      });
    } finally {
      releaseExplore?.();
    }
    let sampledRestart = false;
    e = await eventually(async () => {
      const status = await invoke("abra_work_status", { issue_id: issue.id });
      if (!sampledRestart && status.execution.current_phase === "interrupted") {
        sampledRestart = true;
        const queue = await client.session.inbox.list({
          sessionID: resumedSteering.explore_session_id,
        });
        const request = status.execution.messages.find(
          (m: any) => m.request_id === "native-correlated-answer",
        );
        engineeringEvidence.push({
          interrupted_assignment_after_restart: status.execution.prompt_id,
          request_status: request.status,
          queued_ids: queue.map((m) => m.id),
          request_answer: request.reply?.body,
        });
      }
      if (
        status.execution.current_phase === "interrupted" &&
        status.execution.messages.some(
          (m: any) => m.request_id === "native-correlated-answer" && m.status === "answered",
        )
      ) {
        await invoke("abra_work_control", { issue_id: issue.id, action: "resume" });
        return undefined;
      }
      if (["blocked", "failed", "recovery_required"].includes(status.execution.current_phase))
        throw Error(JSON.stringify(status));
      return status.execution.current_phase === "awaiting_plan_approval"
        ? status.execution
        : undefined;
    }, 40000);
    assert.ok(steeringProviderCalls > 0);
    const steeringContext = await client.session.context({ sessionID: retry.explore_session_id! });
    assert.equal(
      steeringContext.filter(
        (m) => m.type === "user" && m.text.includes("controller-steering-native-marker"),
      ).length,
      1,
    );
    assert.equal(directWorkerProviderCalls, 0);
    assert.equal(
      steeringContext.filter(
        (m) => m.type === "user" && m.text.includes("controller-cancel-native-marker"),
      ).length,
      0,
    );
    assert.equal(cancelledSteeringProviderCalls, 0);
    const replies = await invoke("abra_work_messages", { issue_id: issue.id });
    const answer = replies.entries.find(
      (m: any) => m.record.request_id === "native-correlated-answer",
    ).record;
    assert.equal(answer.status, "answered");
    assert.equal(answer.reply.body, "Native correlated answer: use the documented consumer check.");
    assert.equal(
      steeringContext.filter((m) => m.type === "user" && m.id === answer.prompt_id).length,
      1,
    );
    const storedAnswerPrompt = await client.session.message.get({
      sessionID: answer.recipient_session_id,
      messageID: answer.prompt_id,
    });
    assert.ok(storedAnswerPrompt.type === "user" && storedAnswerPrompt.text === answer.prompt);
    const firstNativePage = await client.message.list({
      sessionID: answer.recipient_session_id,
      order: "desc",
      limit: 2,
    });
    assert.equal(firstNativePage.data.length, 2);
    assert.ok(firstNativePage.cursor.next);
    assert.ok(
      (
        await client.message.list({
          sessionID: answer.recipient_session_id,
          limit: 2,
          cursor: firstNativePage.cursor.next,
        })
      ).data.length > 0,
    );
    assert.equal(replies.outstanding, 0);
    engineeringEvidence.push({
      message_request: answer.request_id,
      prompt_id: answer.prompt_id,
      recipient_session_id: answer.recipient_session_id,
      status: answer.status,
      reply: answer.reply.body,
    });
    engineeringEvidence.push({
      steering: "admitted once in existing session",
      assignment_prompt_id: retry.prompt_id,
      session_id: retry.explore_session_id,
      provider_marker_calls: steeringProviderCalls,
      native_user_messages: 1,
      direct_provider_calls: directWorkerProviderCalls,
    });
    const routed = await eventually(async () => {
      const state = (await invoke("abra_work_status", { issue_id: issue.id })).execution;
      return state.attention?.some(
        (a: any) => a.code === "decision_pending" && a.status === "handled",
      )
        ? state
        : undefined;
    });
    assert.equal(
      routed.decisions.find((d: any) => d.key === "native-inventory").answer,
      "Retained native fixture inventory evidence",
    );
    assert.equal(
      routed.attention_turns,
      1,
      "Question routing must work after diagnostics are exhausted",
    );
    assert.deepEqual(routed.approval_receipts, []);
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
    for (const { name } of engineeringSkills) {
      assert.ok(
        localSkills.some((s) => s.id === `abra-${name}` && s.content.includes("Adapted from")),
      );
      assert.ok((await client.skill.list(loc)).data.some((s) => s.id === `abra-${name}`));
    }
    engineeringEvidence.push(
      await assertEngineeringWorker(client, e.explore_session_id!, "explore"),
    );
    for (const file of ["docs/verification/README.md", "GLOSSARY.md", ".cursor/skills"])
      await assert.rejects(access(join(e.worktree_directory!, file)), /ENOENT/);
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
      [
        "abra_work_create_batch",
        {
          request_id: "worker-self-batch",
          tasks: [
            {
              client_key: "blocked",
              repository_id: "api",
              title: "Must reject",
              description: "Workers cannot create batches",
            },
          ],
        },
      ],
      ["abra_work_diagnostics", { issue_id: issue.id }],
      ["abra_work_messages", { issue_id: issue.id }],
      [
        "abra_work_message",
        {
          issue_id: issue.id,
          request_id: "worker-self-message",
          role: "explore",
          body: "Must reject worker management",
        },
      ],
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
    // Later finishing acceptance observes a real exhausted stall under a short
    // fixture-only watchdog; initial authentication/attention checks use defaults.
    activeConfiguration.set("progress_timeout_ms", {
      explore: 500,
      apply: 1800000,
      review: 900000,
      research: 900000,
      operation: 300000,
    });
    await writeFile(personalPath, activeConfiguration.toString());
    const applied = await client
      .rpc(configuration)
      .reconcile({ session_id: supervisor.id, action: "apply" }, loc);
    assert.equal(applied.outcomes.find((d) => d.id === "api")?.status, "registered/ready");
    const preSuitePath = await capturePreSuite(
      client,
      (await invoke("abra_work_status", { issue_id: issue.id })).execution,
      home,
    );
    child!.kill("SIGTERM");
    await new Promise<void>((done) => child!.once("exit", () => done()));
    start();
    await eventually(() => client.server.info());
    await client.location.get({ location: { directory: home } });
    const recovered = await invoke("abra_work_status", { issue_id: issue.id });
    assert.equal(recovered.execution.current_phase, "awaiting_plan_approval");
    engineeringEvidence.push(
      await assertPreSuiteAfterRestart(
        recovered.execution,
        home,
        preSuitePath,
        `http://127.0.0.1:${port}`,
        password,
      ),
    );
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
    assert.equal(
      await run(
        git.run(Id.AbsolutePath.make(managedAPI.path), [
          "show",
          `${done.delivered_commit}:AGENTS.md`,
        ]),
      ),
      "Repository navigation: source.txt implements the sample.",
    );
    await assertBrowserWorker(client, home, done.apply_session_id);
    await assertBrowserWorker(client, home, done.review_session_id);
    engineeringEvidence.push(await assertEngineeringWorker(client, done.apply_session_id, "apply"));
    engineeringEvidence.push(
      await assertEngineeringWorker(client, done.review_session_id, "review"),
    );
    const deliveredFiles = await run(
      git.run(Id.AbsolutePath.make(managedAPI.path), [
        "ls-tree",
        "-r",
        "--name-only",
        done.delivered_commit!,
      ]),
    );
    assert.ok(
      !deliveredFiles
        .split("\n")
        .some(
          (file) =>
            file === "GLOSSARY.md" ||
            file.startsWith("docs/verification/") ||
            file.startsWith(".cursor/"),
        ),
    );
    engineeringEvidence.push({
      verification: done.verification_receipt,
      review: done.review_receipt,
      outcome: done.current_phase,
    });
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
        description: "Implement the explicit scoped request. engineering-acceptance",
        workflow_policy: "lightweight-fix",
        scope: { goal: "Return sample", acceptance: ["Source returns sample"], constraints: [] },
        request_id: "native-lightweight",
        dispatch: { apply: { model: { providerID: "fixture", id: "gpt-specialist" } } },
        report_reference: {
          issue_id: researchIssue.id,
          report_id: researchDone.report_receipt.report_id,
          hash: researchDone.report_receipt.hash,
        },
      })
    ).issue;
    assert.deepEqual(lightweightIssue.dependencies, [researchIssue.id]);
    holdApply = true;
    const lightweightStart = await invoke("abra_work_start", { issue_id: lightweightIssue.id });
    assert.equal(lightweightStart.configuration_snapshot.workers.apply.model.id, "gpt-specialist");
    assert.equal(
      lightweightStart.configuration_snapshot.dispatch_sources.apply.source,
      "task.model",
    );
    await eventually(async () => (applyHeld ? true : undefined));
    try {
      const source = await invoke("abra_work_messages", { issue_id: researchIssue.id });
      assert.ok(
        source.entries.some(
          (m: any) =>
            m.record.type === "finding" && m.record.request_id === "native-worker-finding",
        ),
      );
      await invoke("abra_work_message", {
        issue_id: lightweightIssue.id,
        role: "apply",
        request_id: "native-research-handoff",
        body: "Consider retained research within the accepted short scope.",
        kind: "finding",
        response: "acknowledgement",
        source: {
          type: "finding",
          issue_id: researchIssue.id,
          request_id: "native-worker-finding",
        },
      });
      await invoke("abra_work_message", {
        issue_id: lightweightIssue.id,
        role: "apply",
        request_id: "native-unanswered-failure",
        body: "native-request-failure: explain the retained verification evidence.",
        kind: "question",
        response: "answer",
      });
    } finally {
      releaseApply?.();
    }
    let lastFailureStatus: unknown;
    const failedRequestWorker = await eventually(async () => {
      const status = await invoke("abra_work_status", { issue_id: lightweightIssue.id });
      lastFailureStatus = status.execution;
      return status.execution.current_phase === "failed" ? status.execution : undefined;
    }).catch(async (error) => {
      engineeringEvidence.push({
        failed_request_observation: lastFailureStatus,
        provider_failure_triggered: failedCorrelatedRequest,
        native_session: await client.session.get({ sessionID: lightweightStart.apply_session_id }),
        native_inbox: await client.session.inbox.list({
          sessionID: lightweightStart.apply_session_id,
        }),
        native_active: await client.session.active(),
        native_turns: (
          await client.session.context({ sessionID: lightweightStart.apply_session_id })
        )
          .filter((m) => m.type === "user" || m.type === "idle")
          .map((m) => ({
            id: m.id,
            type: m.type,
            ...(m.type === "idle"
              ? { outcome: m.outcome, error: m.error }
              : { text: m.text?.slice(0, 120) }),
            time: m.time,
          })),
      });
      throw error;
    });
    const unresolvedBeforeRestart = await invoke("abra_work_messages", {
      issue_id: lightweightIssue.id,
    });
    const failedRequest = unresolvedBeforeRestart.entries.find(
      (m: any) => m.record.request_id === "native-unanswered-failure",
    ).record;
    assert.equal(unresolvedBeforeRestart.outstanding, 1);
    assert.equal(failedRequest.reply, undefined);
    assert.ok(
      [lightweightStart.prompt_id, failedRequest.prompt_id].includes(
        failedRequestWorker.worker_failure.prompt_id,
      ),
    );
    const unattendedConfiguration = parseDocument(await readFile(personalPath, "utf8"));
    unattendedConfiguration.set("supervision_mode", "unattended");
    unattendedConfiguration.delete("auto_schedule");
    await writeFile(personalPath, unattendedConfiguration.toString());
    child!.kill("SIGTERM");
    await new Promise<void>((done) => child!.once("exit", () => done()));
    start();
    await eventually(() => client.server.info());
    await client.location.get({ location: { directory: home } });
    const unresolvedAfterRestart = await invoke("abra_work_messages", {
      issue_id: lightweightIssue.id,
    });
    assert.equal(unresolvedAfterRestart.outstanding, 1);
    assert.equal(
      unresolvedAfterRestart.entries.find(
        (m: any) => m.record.request_id === "native-research-handoff",
      ).record.status,
      "acknowledged",
    );
    const earlierAnswerAfterRestart = (
      await invoke("abra_work_messages", { issue_id: issue.id })
    ).entries.find((m: any) => m.record.request_id === "native-correlated-answer").record;
    assert.equal(earlierAnswerAfterRestart.status, "answered");
    assert.equal(
      earlierAnswerAfterRestart.reply.body,
      "Native correlated answer: use the documented consumer check.",
    );
    assert.deepEqual(
      unresolvedAfterRestart.entries.find(
        (m: any) => m.record.request_id === failedRequest.request_id,
      ).record,
      failedRequest,
    );
    const failedAfterRestart = (await invoke("abra_work_status", { issue_id: lightweightIssue.id }))
      .execution;
    assert.equal(failedAfterRestart.apply_session_id, lightweightStart.apply_session_id);
    assert.equal(failedAfterRestart.worktree_directory, lightweightStart.worktree_directory);
    assert.equal(failedAfterRestart.current_phase, "failed");
    assert.equal(
      (await invoke("abra_work_status", { issue_id: lightweightIssue.id })).supervision.primary,
      "provider_failure",
    );
    engineeringEvidence.push({
      posture: "unattended",
      provider_failure: lightweightIssue.id,
      approval_granted: false,
      preserved_outstanding: unresolvedAfterRestart.outstanding,
    });

    engineeringEvidence.push({
      unanswered_request_restart: failedRequest.request_id,
      prompt_id: failedRequest.prompt_id,
      outstanding: unresolvedAfterRestart.outstanding,
      session_id: failedAfterRestart.apply_session_id,
    });
    for (const incident of failedAfterRestart.attention ?? [])
      if (
        ["admitted", "user_needed"].includes(incident.status) &&
        incident.code === "worker_failure"
      )
        await invoke("abra_work_attention", {
          issue_id: lightweightIssue.id,
          incident_id: incident.id,
          generation: failedAfterRestart.control_generation,
          action: "handled",
          reason:
            "Inspected retained provider failure and outstanding request; explicitly retrying the same authorized work",
        });
    await invoke("abra_work_control", { issue_id: lightweightIssue.id, action: "retry" });
    const lightweightDone = await eventually(async () => {
      const status = await invoke("abra_work_status", { issue_id: lightweightIssue.id });
      if (["blocked", "failed", "recovery_required"].includes(status.execution.current_phase))
        throw Error(JSON.stringify(status));
      return status.execution.current_phase === "completed" ? status.execution : undefined;
    });
    assert.equal(lightweightDone.archive_path, undefined);
    assert.equal(lightweightDone.rounds.length, 1);
    const handoff = (
      await invoke("abra_work_messages", { issue_id: lightweightIssue.id })
    ).entries.find((m: any) => m.record.request_id === "native-research-handoff").record;
    assert.equal(handoff.status, "acknowledged");
    assert.equal(handoff.recipient_session_id, lightweightStart.apply_session_id);
    assert.equal(lightweightDone.scope.contract.goal, "Return sample");
    engineeringEvidence.push({
      forwarded_finding: "native-worker-finding",
      source_session_id: researchDone.research_session_id,
      recipient_session_id: handoff.recipient_session_id,
      acknowledgement: handoff.status,
    });
    assert.ok(
      lightweightDone.verification_receipt &&
        lightweightDone.review_receipt &&
        lightweightDone.delivery_receipt,
    );
    const exhaustedIssue = (
      await invoke("abra_work_create", {
        repository_id: "research",
        title: "Exhaust native correction budget",
        description: "Keep failed scoped evidence. engineering-acceptance",
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
    const unavailableIssue = (
      await invoke("abra_work_create", {
        repository_id: "worker",
        title: "Unavailable engineering proof",
        description:
          "Implement sample; runtime observation unavailable. engineering-unavailable-evidence",
        request_id: "engineering-unavailable",
      })
    ).issue;
    await invoke("abra_work_start", { issue_id: unavailableIssue.id });
    const unavailablePlan = await eventually(async () => {
      const current = (await invoke("abra_work_status", { issue_id: unavailableIssue.id }))
        .execution;
      return current.current_phase === "awaiting_plan_approval" ? current : undefined;
    });
    const approval = await invoke("abra_work_approve", {
      issue_id: unavailableIssue.id,
      kind: "plan",
    });
    assert.ok(approval?.form_id);
    await client.session.form.reply({
      sessionID: supervisor.id,
      formID: approval.form_id,
      answer: { authorize: true },
    });
    const unavailable = await eventually(async () => {
      const current = (await invoke("abra_work_status", { issue_id: unavailableIssue.id }))
        .execution;
      return current.current_phase === "blocked" && current.review_receipt ? current : undefined;
    });
    assert.equal(unavailable.review_receipt.passed, false);
    assert.equal(unavailable.review_receipt.spec_verification.correctness.status, "not_verified");
    assert.equal(unavailable.delivery_receipt, undefined);
    assert.equal(unavailable.plan_fingerprint, unavailablePlan.plan_fingerprint);
    for (const file of ["docs/verification/README.md", "GLOSSARY.md", ".cursor/skills"])
      await assert.rejects(access(join(unavailable.worktree_directory, file)), /ENOENT/);
    const unavailableApplyMessages = await client.session.context({
      sessionID: unavailable.apply_session_id,
    });
    assert.match(
      JSON.stringify(unavailableApplyMessages),
      /Runtime audit prerequisite is unavailable/,
    );
    assert.ok(unavailable.decisions.some((d: any) => d.status === "open"));
    const unavailableMessages = await client.session.context({
      sessionID: unavailable.review_session_id,
    });
    assert.ok(JSON.stringify(unavailableMessages).includes("unavailable-proof.json"));
    engineeringEvidence.push({
      unavailable_evidence: unavailable.review_receipt,
      phase: unavailable.current_phase,
    });
    // Restore the original conservative intake posture before proving that batch
    // creation itself never dispatches work.
    const conservativeConfiguration = parseDocument(await readFile(personalPath, "utf8"));
    conservativeConfiguration.delete("supervision_mode");
    conservativeConfiguration.set("auto_schedule", false);
    await writeFile(personalPath, conservativeConfiguration.toString());
    child!.kill("SIGTERM");
    await new Promise<void>((done) => child!.once("exit", () => done()));
    start();
    await eventually(() => client.server.info());
    await client.location.get({ location: { directory: home } });
    engineeringEvidence.push({
      posture: "unattended",
      review_blocker: unavailableIssue.id,
      scope_unchanged: true,
      delivery_authorized: false,
    });
    engineeringEvidence.push(await runReports());
    engineeringEvidence.push(await runLeads());
    engineeringEvidence.push(await runModels());
    const nativeBatchInput = {
      request_id: "native-batch-intake",
      tasks: [
        {
          client_key: "consumer",
          repository_id: "research",
          title: "Dependent batch research",
          description: "Inspect source using the prerequisite findings",
          workflow_policy: "research-only",
          scope: {
            goal: "Inspect source",
            acceptance: ["Retain findings"],
            constraints: ["Read only"],
          },
          dependencies: [{ type: "local", client_key: "prerequisite" }],
        },
        {
          client_key: "prerequisite",
          repository_id: "research",
          title: "Prerequisite batch research",
          description: "Investigate the source contract",
          workflow_policy: "research-only",
          scope: {
            goal: "Understand the contract",
            acceptance: ["Retain findings"],
            constraints: ["Read only"],
          },
          dependencies: [{ type: "existing", issue_id: researchIssue.id }],
        },
        {
          client_key: "independent",
          repository_id: "research",
          title: "Independent batch research",
          description: "Inspect source independently",
          workflow_policy: "research-only",
          scope: {
            goal: "Inspect independent evidence",
            acceptance: ["Retain findings"],
            constraints: ["Read only"],
          },
        },
      ],
    };
    const nativeBatch = await invoke("abra_work_create_batch", nativeBatchInput);
    assert.equal(nativeBatch.tasks.length, 3);
    const nativeMapping = nativeBatch.tasks.map((task: any) => [task.client_key, task.issue.id]);
    assert.deepEqual(
      (
        await invoke("abra_work_create_batch", {
          ...nativeBatchInput,
          tasks: nativeBatchInput.tasks.toReversed(),
        })
      ).tasks.map((task: any) => [task.client_key, task.issue.id]),
      nativeMapping,
    );
    const prerequisite = nativeBatch.tasks.find(
      (task: any) => task.client_key === "prerequisite",
    ).issue;
    assert.deepEqual(
      nativeBatch.tasks.find((task: any) => task.client_key === "consumer").issue.dependencies,
      [prerequisite.id],
    );
    assert.deepEqual(prerequisite.dependencies, [researchIssue.id]);
    assert.ok(nativeBatch.tasks.every((task: any) => task.issue.status === "open"));
    assert.ok(
      !(await invoke("abra_work_list", {})).executions.some((execution: any) =>
        nativeBatch.tasks.some((task: any) => task.issue.id === execution.issue_id),
      ),
    );
    await assert.rejects(
      invoke("abra_work_create_batch", {
        ...nativeBatchInput,
        tasks: nativeBatchInput.tasks.map((task) => ({ ...task, description: "Rebound goal" })),
      }),
      /REQUEST_REBIND/,
    );
    engineeringEvidence.push({
      batch_intake: nativeBatchInput.request_id,
      mapping: nativeMapping,
      atomic_tasks: 3,
      dispatch: false,
    });
    engineeringEvidence.push(await runParallel());
    // A recipe may drive just this complete journey; the default suite still exercises all PR/finishing assertions.
    if (process.env.ABRACODE_TEST_JOURNEY === "engineering") {
      engineeringEvidence.push({
        journey: "engineering",
        complete: true,
        limitation: "PR-feedback and post-merge residue scenarios belong to the full native run",
      });
      return;
    }
    const feedbackIssue = await prFeedbackLifecycle({
      root,
      forgeState,
      invoke,
      observeBusy: (tool, args) => invoke(tool, args, true),
      eventually,
      failExploreOnce: () => {
        failFirstExplore = true;
        stallFirstExplore = true;
      },
      answerDisposition: async (formID, answer) => {
        await client.session.form.reply({ sessionID: supervisor.id, formID, answer });
      },
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
        "workers:\n  explore: {agent: central-only}\n  research: {required_skills: [missing-worker-skill]}\n",
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
    assert.deepEqual(
      (await invoke("abra_work_create_batch", nativeBatchInput)).tasks.map((task: any) => [
        task.client_key,
        task.issue.id,
      ]),
      nativeMapping,
    );
    engineeringEvidence.push({
      batch_restart: nativeBatchInput.request_id,
      mapping: nativeMapping,
      identity_preserved: true,
    });
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
    const retainedCleanup = await invoke("abra_work_status", { issue_id: feedbackIssue.id });
    assert.equal(retainedCleanup.execution.current_phase, "cleaning");
    assert.equal(retainedCleanup.outcome.delivery.state, "verified");
    assert.equal(retainedCleanup.outcome.cleanup.state, "blocked");
    assert.equal(
      (await observer.detail({ issue_id: feedbackIssue.id }, loc)).work.outcome?.cleanup.state,
      "blocked",
    );
    assert.ok(retainedCleanup.execution.worktree_directory.startsWith(root + "/"));
    const disposition = await eventually(async () => {
      const status = await invoke("abra_work_status", { issue_id: feedbackIssue.id });
      const question = status.execution.decisions?.find(
        (d: any) => d.status === "open" && d.finishing_target?.kind === "residue" && d.form_id,
      );
      if (
        question &&
        (await client.session.form
          .get({ sessionID: supervisor.id, formID: question.form_id })
          .catch(() => undefined))
      )
        return question;
    });
    const unknown = join(retainedCleanup.execution.worktree_directory, "unknown-note.txt");
    await writeFile(
      unknown,
      "Unknown content must survive the directory-only answer after restart.",
    );
    await client.session.form.reply({
      sessionID: supervisor.id,
      formID: disposition.form_id,
      answer: { action: "generated", generated_paths: [".cleanup-residue"] },
    });
    const retainedUnknown = await eventually(async () => {
      const status = await invoke("abra_work_status", { issue_id: feedbackIssue.id });
      const question = status.execution.decisions?.find(
        (d: any) =>
          d.status === "open" &&
          d.finishing_target?.kind === "residue" &&
          d.finishing_target.paths.some((p: any) => p.path === "unknown-note.txt") &&
          d.form_id,
      );
      if (
        question &&
        (await client.session.form
          .get({ sessionID: supervisor.id, formID: question.form_id })
          .catch(() => undefined))
      )
        return question;
    });
    await access(unknown);
    assert.equal(
      (await invoke("abra_work_status", { issue_id: feedbackIssue.id })).outcome.closure,
      "open",
    );
    await client.session.form.reply({
      sessionID: supervisor.id,
      formID: retainedUnknown.form_id,
      answer: { action: "preserve", preserve_paths: ["unknown-note.txt"] },
    });
    const preservedNote = join(root, "preserved-unknown-note.txt");
    await rename(unknown, preservedNote);
    const cleanupDone = await eventually(async () => {
      const status = await invoke("abra_work_status", { issue_id: feedbackIssue.id });
      return status.outcome.closure === "closed" ? status : undefined;
    });
    assert.equal(cleanupDone.outcome.closure, "closed", JSON.stringify(cleanupDone));
    assert.equal(cleanupDone.outcome.cleanup.state, "retired");
    assert.match(await readFile(preservedNote, "utf8"), /must survive/);
    const feedbackProject = (await invoke("abra_project_list", {})).find(
      (p: any) => p.id === "feedback",
    );
    assert.equal(
      await run(
        git.run(Id.AbsolutePath.make(feedbackProject.path), [
          "show",
          `${cleanupDone.execution.delivered_commit}:source.txt`,
        ]),
      ),
      "sample late validated revision",
    );
    engineeringEvidence.push({
      finishing: cleanupDone.outcome,
      same_pr: cleanupDone.execution.pull_request_reference,
      restart_unknown_preserved: true,
      merge_count: JSON.parse(await readFile(forgeState, "utf8")).counts.merge,
    });
    assert.equal(JSON.parse(await readFile(forgeState, "utf8")).counts.merge, 1);
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
    engineeringEvidence.push(await runAcceptance());
  },
);
