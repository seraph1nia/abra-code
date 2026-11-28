import { MemoryFixture } from "./agent-memory.ts";
import { roadExcerpt, roadQuestion } from "./memos-thoughts.ts";
import { briefingFixtureAnswer, briefingQuestion } from "./work-briefing.ts";
import { simplifyCalls } from "./simplify-loop.ts";
import { planningCalls as planningWorkerCalls } from "./planning-recovery.ts";
import { acceptanceJourney } from "./acceptance.ts";
import { leadJourney } from "./leads.ts";
import { parallelJourney } from "./parallel.ts";

import { browserCalls, browserPage } from "./browser.ts";
import { engineeringCalls } from "./engineering.ts";
import { assertSpecialistRequest } from "./agents.ts";
import * as Id from "@abracode/contracts/identities";
import { run } from "../effects.ts";

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { join } from "node:path";
import { Git } from "../../src/git/repository.ts";
import { delay } from "./native-timing.ts";
export async function startMockProvider(
  journey: string | undefined,
  git: Git,
  frontend: string,
  engineeringEvidence: unknown[],
) {
  const controls = {
    failFirstExplore: true,
    stallFirstExplore: false,
    missingToolProviderCalls: 0,
    directWorkerProviderCalls: 0,
    releaseCockpit: undefined as (() => void) | undefined,
    holdExplore: false,
    exploreHeld: false,
    releaseExplore: undefined as (() => void) | undefined,
    steeringProviderCalls: 0,
    cancelledSteeringProviderCalls: 0,
    holdModelWorker: false,
    modelWorkerHeld: false,
    releaseModelWorker: undefined as (() => void) | undefined,
    holdApply: false,
    applyHeld: false,
    releaseApply: undefined as (() => void) | undefined,
    failedCorrelatedRequest: false,
  };
  const agentRequests: unknown[] = [];
  const memory = journey === "agent-memory" ? new MemoryFixture() : undefined;
  const providerRequests: Record<string, number> = {};
  const reviewedTrees = new Set<string>();
  const leads = leadJourney();
  const parallel = parallelJourney();
  const acceptance = acceptanceJourney();
  const streamProof = { tool: false, text: false };
  const releaseStreamProof: { tool?: () => void; text?: () => void } = {};
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
      controls.directWorkerProviderCalls++;
    if (JSON.stringify(input.messages ?? []).includes("worker-context-provider-must-not-run"))
      controls.missingToolProviderCalls++;
    const messages = input.messages ?? [];
    const hasUserMarker = (marker: string) =>
      messages.some((m: any) => m.role === "user" && JSON.stringify(m.content).includes(marker));
    if (hasUserMarker("controller-steering-native-marker")) controls.steeringProviderCalls++;
    if (hasUserMarker("controller-cancel-native-marker")) controls.cancelledSteeringProviderCalls++;
    const user =
      messages.findLast(
        (m: any) =>
          m.role === "user" &&
          typeof m.content === "string" &&
          /You are the AbraCode (explore|apply|review|research) for issue/.test(m.content),
      )?.content ??
      messages.findLast(
        (m: any) =>
          m.role === "user" &&
          typeof m.content === "string" &&
          (m.content.includes("AbraCode") ||
            m.content.startsWith("Controller project-lead request")),
      )?.content ??
      messages.findLast((m: any) => m.role === "user")?.content ??
      "";
    const independent =
      journey === "proposal-review" &&
      typeof user === "string" &&
      user.startsWith("What goal, boundaries and observable success");
    if (independent) {
      const tools = (input.tools ?? []).map((t: any) => t.function?.name);
      const users = messages.filter((m: any) => m.role === "user");
      const clean =
        users.length === 1 &&
        !JSON.stringify(messages).includes("AUTHOR_CONTEXT_ONLY") &&
        tools.length === 1 &&
        tools[0] === "read";
      engineeringEvidence.push({
        reader_input: user,
        tools,
        clean,
        system: messages.filter((m: any) => m.role === "system").map((m: any) => m.content),
      });
      if (!clean) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ error: { message: "Reader received context outside the proposal" } }),
        );
        return;
      }
    }
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
    if (
      journey === "cockpit" &&
      !controls.releaseCockpit &&
      hasUserMarker("Hold the cockpit supervisor turn")
    ) {
      await new Promise<void>((finish) => {
        controls.releaseCockpit = finish;
        res.once("close", finish);
      });
    }
    if (user.includes("engineering-acceptance") && ["explore", "apply", "review"].includes(role)) {
      const system = JSON.stringify(messages.filter((message: any) => message.role === "system"));
      const marker = `You are ${role[0].toUpperCase()}${role.slice(1)}.`;
      const count = system.split(marker).length - 1;
      assert.equal(count, 1, `${role} static instructions must be supplied exactly once`);
      const toolNames = (input.tools ?? []).map((tool: any) => tool.function?.name ?? tool.name);
      if (journey === "engineering") assertSpecialistRequest(role, system, toolNames);
      if (
        journey === "engineering" &&
        role === "apply" &&
        !user.includes("Approved short scope:")
      ) {
        assert.ok(system.includes("External native override guidance marker."));
        assert.ok(!system.includes("Native later role source changed after snapshot."));
      }
      agentRequests.push({
        role,
        static_instruction_count: count,
        tools: toolNames,
      });
    }
    providerRequests[role] = (providerRequests[role] ?? 0) + 1;
    await acceptance.observe(role, user);
    await parallel.observe(role, user);
    await leads.observe(role, user);
    if (
      role === "research" &&
      controls.holdModelWorker &&
      user.includes("model-capture-acceptance")
    ) {
      controls.holdModelWorker = false;
      controls.modelWorkerHeld = true;
      await new Promise<void>((done) => {
        controls.releaseModelWorker = done;
      });
    }
    if (role === "explore" && controls.holdExplore) {
      controls.holdExplore = false;
      controls.exploreHeld = true;
      await new Promise<void>((done) => (controls.releaseExplore = done));
    }
    if (role === "apply" && controls.holdApply) {
      controls.holdApply = false;
      controls.applyHeld = true;
      await new Promise<void>((done) => (controls.releaseApply = done));
    }
    if (
      role === "review" &&
      user.includes("engineering-acceptance") &&
      !user.includes("Approved short scope:") &&
      !reviewedTrees.has(user)
    ) {
      reviewedTrees.add(user);
      const directory = /Worktree: ([^\n]+)/.exec(user)![1];
      const status = await run(git.run(Id.AbsolutePath.make(directory), ["status", "--porcelain"]));
      assert.match(status, / M source.txt/);
      assert.match(status, /\?\? sample-proof.mjs/);
      engineeringEvidence.push({ review_tree: directory, status });
    }
    if (role === "explore" && controls.failFirstExplore) {
      controls.failFirstExplore = false;
      if (controls.stallFirstExplore) {
        controls.stallFirstExplore = false;
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
      !controls.failedCorrelatedRequest &&
      hasUserMarker("native-request-failure") &&
      messages.some(
        (m: any) =>
          m.role === "assistant" &&
          m.tool_calls?.some((call: any) =>
            call.function.arguments.includes("native-research-handoff"),
          ),
      )
    ) {
      controls.failedCorrelatedRequest = true;
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
    // Review coverage belongs to the current assignment even when its session is reused.
    const scopedMessages =
      role === "review" ||
      briefingQuestion(user) ||
      user.startsWith("AbraCode workspace operation ") ||
      user.includes("simplify-loop:") ||
      user.includes("planning-recovery:")
        ? messages.slice(
            messages.findLastIndex((m: any) => m.role === "user" && m.content === user),
          )
        : messages;
    const used = new Set(
      scopedMessages
        .filter((m: any) => m.role === "assistant")
        .flatMap((m: any) => m.tool_calls ?? [])
        .map((call: any) => call.function.arguments),
    );
    const calls: Array<{
      name: string;
      args: any;
    }> = [];
    if (memory)
      calls.push(
        ...memory.calls(
          role,
          user,
          (input.tools ?? []).map((tool: any) => tool.function?.name),
        ),
      );
    const briefing = journey === "work-briefing" && role === "supervisor" && briefingQuestion(user);
    if (briefing) calls.push({ name: "abra_work_briefing", args: {} });
    const roadDiscussion = journey === "memos-thoughts" && user.startsWith(roadQuestion);
    if (roadDiscussion)
      calls.push({ name: "abra_thought_get", args: JSON.parse(user.split("\n").at(-1)) });
    if (role === "supervisor" && user.startsWith("AbraCode workspace operation ")) {
      const operation = JSON.parse(user.slice("AbraCode workspace operation ".length));
      calls.push({ name: operation.tool, args: operation.args });
    }
    if (role === "supervisor" && user === "What AbraCode work is currently retained?")
      calls.push({ name: "abra_work_list", args: {} });
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
        response[2] !== "native-recovery-escalation" &&
        (response[2] !== "native-recovery-answer" ||
          hasUserMarker(
            "AbraCode response-only reminder for original request native-recovery-answer",
          )) &&
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
    const leadCalls = leads.calls(user);
    if (leadCalls) calls.push(...leadCalls);
    else if (role === "supervisor" && user.includes("Validate AbraCode tool input contracts")) {
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
            conclusions: user.includes("Privately review https://inbox.invalid")
              ? "Reviewed retry messaging at the recorded PR head. The added retry message is consistent."
              : "Research kept the source unchanged.",
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
                criterion: user.includes("Privately review https://inbox.invalid")
                  ? `Report findings for base ${"b".repeat(40)} and head ${"a".repeat(40)}. Assessed 1 of 1 files with complete patch coverage. Identify files assessed and coverage limits.`
                  : "Identify the source behavior",
                met: true,
                evidence: user.includes("Privately review https://inbox.invalid")
                  ? "Examined the added retry() line in retry.ts."
                  : "Read source.txt",
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
        { name: "read", args: { path: join(frontend, "source.txt") } },
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
        { name: "read", args: { path: join(frontend, "source.txt") } },
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
          ...acceptance.review(user),
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
                    evidence: "source.txt behavior agrees with the configured deterministic check.",
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
        const notice = leads.decisionNotice(decision.key, issueID, user);
        if (notice) calls.push(notice);
        else
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
      else calls.push({ name: "abra_work_control", args: { issue_id: issueID, action: "retry" } });
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
    if (role === "review")
      calls.unshift(
        { name: "skill", args: { id: "abra-open-code-review-delegate" } },
        { name: "abra_review_changes", args: { offset: 0 } },
      );
    if (role === "research" && user.includes("Use its private PR procedure"))
      calls.unshift({ name: "skill", args: { id: "abra-open-code-review-delegate" } });
    await simplifyCalls(user, role, calls);
    planningWorkerCalls(user, role, calls);
    calls.unshift(...browserCalls(user, role, `http://127.0.0.1:${address.port}`, messages));
    calls.unshift(...engineeringCalls(user, role, journey === "engineering"));
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
      !(user.includes("engineering-acceptance") && ["abra_work_finish", "task"].includes(next.name))
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
              content: independent
                ? JSON.stringify({
                    reading: "The proposal adds a sample response.",
                    findings: [
                      {
                        owner: "human",
                        question: "Should previews include the sample?",
                        evidence: "The proposal describes only a sample response.",
                      },
                    ],
                  })
                : briefing
                  ? briefingFixtureAnswer(user, scopedMessages)
                  : roadDiscussion &&
                      messages.some(
                        (m: any) =>
                          m.role === "tool" && JSON.stringify(m.content).includes(roadExcerpt),
                      )
                    ? "I found the weekly planning thought."
                    : user.includes("browser-acceptance")
                      ? "Observed the browser counter change from 0 to 1, captured and read scratch screenshot evidence, and closed the assigned browser. Completed assigned role."
                      : "Completed assigned role.",
            },
            finish_reason: "stop",
          },
        ];
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const send = (chunk: unknown) =>
      res.write(
        `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 0, model: "fixture", choices: [{ index: 0, ...(chunk as object) }] })}\n\n`,
      );
    const controlled =
      journey === "workspace" &&
      role === "supervisor" &&
      user.startsWith("AbraCode workspace operation ");
    if (controlled && next && streamProof.tool) {
      streamProof.tool = false;
      const args = JSON.stringify(next.args),
        split = Math.max(1, Math.floor(args.length / 2));
      send({
        delta: {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: "call_workspace_stream",
              type: "function",
              function: { name: next.name, arguments: "" },
            },
          ],
        },
        finish_reason: null,
      });
      send({
        delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(0, split) } }] },
        finish_reason: null,
      });
      await new Promise<void>((resolve) => {
        releaseStreamProof.tool = resolve;
      });
      send({
        delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(split) } }] },
        finish_reason: null,
      });
      send({ delta: {}, finish_reason: "tool_calls" });
    } else if (controlled && !next && streamProof.text) {
      streamProof.text = false;
      send({
        delta: { role: "assistant", content: "Streaming native text " },
        finish_reason: null,
      });
      await new Promise<void>((resolve) => {
        releaseStreamProof.text = resolve;
      });
      send({ delta: { content: "completed." }, finish_reason: "stop" });
    } else for (const chunk of chunks) send(chunk);
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((done) => provider.listen(0, "127.0.0.1", done));
  const address = provider.address() as {
    port: number;
  };
  return {
    provider,
    address,
    controls,
    parallel,
    acceptance,
    leads,
    memory,
    streamProof,
    releaseStreamProof,
    providerRequests,
    agentRequests,
  };
}
