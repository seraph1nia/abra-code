import assert from "node:assert/strict";
import { access, readFile, mkdir, copyFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { repo } from "../fixtures.ts";
import { run } from "../effects.ts";
import { diagnosticText } from "../../src/opencode/diagnostics.ts";

export async function reportJourney(o: {
  root: string;
  home: string;
  client: any;
  supervisor: string;
  invoke: (tool: string, args: unknown) => Promise<any>;
  workerTool: (session: string, tool: string, args: unknown) => Promise<any>;
  eventually: <T>(action: () => Promise<T | undefined>, timeout?: number) => Promise<T>;
  restart: () => Promise<void>;
  observe: (value: unknown) => void;
  compilerRunning?: () => Promise<boolean>;
}) {
  const path = await run(repo(o.root, "visual-report-base"));
  await o.invoke("abra_project_onboard", {
    id: "visual-reports",
    path,
    action: "register",
    verification: [],
    plan_approval: false,
    merge_approval: false,
    delivery: "branch",
    diagnostic_turns: 0,
  });
  const issue = (
    await o.invoke("abra_work_create", {
      repository_id: "visual-reports",
      request_id: "native-visual-research",
      title: "Database architecture investigation",
      description:
        "visual-report-native-acceptance: investigate source and publish visual evidence",
      workflow_policy: "research-only",
      scope: {
        goal: "Understand source",
        acceptance: ["Identify the source behavior"],
        constraints: ["Read only"],
      },
      dispatch: { research: { model: { providerID: "fixture", id: "gpt-specialist" } } },
    })
  ).issue;
  const started = await o.invoke("abra_work_start", { issue_id: issue.id });
  const status = () => o.invoke("abra_work_status", { issue_id: issue.id }),
    artifacts = () => o.invoke("abra_work_report", { issue_id: issue.id, action: "artifacts" });
  const completed = await o.eventually(async () => {
    const current = await status();
    if (current.execution.current_phase === "failed")
      throw Object.assign(Error(JSON.stringify(current)), { terminal: true });
    return current.execution.current_phase === "completed" ? current : undefined;
  }, 90000);
  const first = (await artifacts())[0];
  assert.equal(first.status, "published");
  assert.equal(first.artifact.source_report.report_id, "native-findings");
  assert.equal(first.artifact.generation, started.control_generation);
  assert.equal(first.snapshot, undefined);
  await assert.rejects(access(started.worktree_directory));
  const html = await readFile(first.artifact.path, "utf8"),
    hash = createHash("sha256").update(html).digest("hex");
  assert.equal(hash, first.artifact.hash);
  assert.ok(html.includes("abracode-license-notices"));
  assert.ok(html.includes("abracode-report-data"));
  assert.equal(completed.execution.report_receipt.hash, first.artifact.source_report.hash);
  assert.equal(completed.execution.current_phase, "completed");
  assert.deepEqual(completed.execution.approval_receipts, []);
  await assert.rejects(
    o.workerTool(started.research_session_id, "abra_work_report", {
      issue_id: issue.id,
      action: "generate",
      request_id: "forbidden-worker-generation",
    }),
  );
  const source = await o.client.session.context({ sessionID: started.research_session_id });
  const errors = source
    .filter((m: any) => m.type === "assistant")
    .flatMap((m: any) => m.content ?? [])
    .filter((p: any) => p.type === "tool" && p.state.status === "error");
  for (const name of ["patch", "shell", "abra_work_finish"])
    assert.ok(errors.some((p: any) => p.name === name));
  const terminal = await o.invoke("abra_work_report", {
    issue_id: issue.id,
    action: "generate",
    request_id: "native-terminal-visual",
    title: "Retained architecture report",
  });
  assert.equal(terminal.status, "published");
  assert.equal(terminal.generation, started.control_generation);
  assert.notEqual(terminal.artifact.path, first.artifact.path);
  const before = await status();
  let responseLost = false;
  const inFlight = o
    .invoke("abra_work_report", {
      issue_id: issue.id,
      action: "generate",
      request_id: "native-restarted-visual",
    })
    .catch(() => {
      responseLost = true;
    });
  const captured = await o.eventually(async () => {
    const b = (await artifacts()).find(
      (b: any) => b.request.request_id === "native-restarted-visual",
    );
    return b?.status === "building" ? b : undefined;
  });
  if (o.compilerRunning) {
    let last: { status?: string; error?: string; artifact_retained: boolean } | undefined;
    try {
      await o.eventually(async () => {
        const build = (await artifacts()).find(
          (b: any) => b.request.request_id === captured.request.request_id,
        );
        last = {
          status: build?.status,
          error: build?.error ? diagnosticText(build.error, 2048) : undefined,
          artifact_retained: !!build?.artifact,
        };
        if (build?.status === "failed")
          throw Object.assign(Error("REPORT_FAILED_BEFORE_RESTART"), { terminal: true });
        if (build?.status === "published")
          throw Object.assign(Error("REPORT_COMPILER_WINDOW_MISSED"), { terminal: true });
        return (await o.compilerRunning!()) ? true : undefined;
      }, 15000);
    } catch (error) {
      o.observe({
        report_compiler_probe_failed: { request_id: captured.request.request_id, ...last },
      });
      throw error;
    }
    o.observe({
      report_compiler_running_before_restart: {
        request_id: captured.request.request_id,
        verified_owned_child: true,
      },
    });
  }
  await o.restart();
  await inFlight;
  const recovered = await o.eventually(async () => {
    const b = (await artifacts()).find(
      (b: any) => b.request.request_id === "native-restarted-visual",
    );
    if (b?.status === "failed") {
      o.observe({
        report_restart_failed: {
          request_id: b.request.request_id,
          status: b.status,
          error: b.error ? diagnosticText(b.error, 2048) : undefined,
          input_hash: b.input_hash,
          template_hash: b.template_hash,
          artifact_retained: !!b.artifact,
        },
      });
      throw Object.assign(Error("REPORT_RESTART_FAILED"), { terminal: true });
    }
    return b?.status === "published" ? b : undefined;
  }, 90000);
  assert.equal(recovered.input_hash, captured.input_hash);
  assert.equal(recovered.request.request_id, captured.request.request_id);
  const retry = await o.invoke("abra_work_report", {
    issue_id: issue.id,
    action: "generate",
    request_id: "native-restarted-visual",
  });
  assert.deepEqual(retry, recovered);
  const after = await status();
  assert.equal(after.execution.current_phase, "completed");
  assert.equal(after.execution.control_generation, before.execution.control_generation);
  assert.equal(after.execution.research_session_id, before.execution.research_session_id);
  assert.equal(after.execution.worktree_directory, before.execution.worktree_directory);
  assert.equal(after.execution.report_receipt.hash, before.execution.report_receipt.hash);
  assert.deepEqual(after.execution.approval_receipts, before.execution.approval_receipts);
  assert.equal(
    createHash("sha256")
      .update(await readFile(first.artifact.path, "utf8"))
      .digest("hex"),
    hash,
  );
  await o.eventually(async () => {
    const context = await o.client.session.context({ sessionID: o.supervisor });
    return context.some(
      (m: any) => m.type === "synthetic" && m.text.includes(recovered.artifact.path),
    )
      ? true
      : undefined;
  });
  let portable_artifact: string | undefined;
  if (process.env.ABRACODE_TEST_EVIDENCE_DIR) {
    const dir = resolve(process.env.ABRACODE_TEST_EVIDENCE_DIR);
    assert.ok(dir !== o.root && !dir.startsWith(o.root + "/"));
    await mkdir(dir, { recursive: true });
    portable_artifact = join(dir, `research-architecture-${first.artifact.hash}.html`);
    await copyFile(first.artifact.path, portable_artifact);
  }
  return {
    feature: "controller-owned-visual-reports",
    result: "pass",
    issue_id: issue.id,
    worker_session: started.research_session_id,
    portable_artifact,
    worker_render: first.artifact,
    terminal_render: terminal.artifact,
    recovered: recovered.artifact,
    lost_response: responseLost,
    retired_worktree: true,
    native_file_link_source: "OpenCode v2.0.28 graphical file renderer/artifact viewer",
    native_gui_clickthrough: "not_run: no paired graphical client",
    permissions_unchanged: true,
  };
}
