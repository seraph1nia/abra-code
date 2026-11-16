import assert from "node:assert/strict";
import { access, readFile, mkdir, copyFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { repo } from "../fixtures.ts";
import { run } from "../effects.ts";
import { webGateway } from "../../src/web/protocol.ts";

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
  assert.equal(first.status, "published", JSON.stringify(first));
  assert.equal(first.artifact.source_report.report_id, "native-findings");
  assert.equal(first.artifact.generation, started.control_generation);
  assert.equal(first.snapshot, undefined);
  await assert.rejects(access(started.worktree_directory));
  const json = await readFile(first.artifact.path, "utf8"),
    hash = createHash("sha256").update(json).digest("hex");
  assert.equal(hash, first.artifact.hash);
  assert.equal(JSON.parse(json).format, "a2ui-snapshot");
  assert.equal(first.format, "a2ui-snapshot");
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
  const captured = await o.invoke("abra_work_report", {
    issue_id: issue.id,
    action: "generate",
    request_id: "native-restarted-visual",
  });
  await o.restart();
  const recovered = (await artifacts()).find(
    (b: any) => b.request.request_id === "native-restarted-visual",
  );
  assert.equal(recovered.status, "published");
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
  const gateway = o.client.rpc(webGateway),
    options = { location: { directory: o.home } },
    target = {
      session_id: o.supervisor,
      issue_id: issue.id,
      request_id: first.request.request_id,
      hash: first.artifact.hash,
    };
  const exported = await gateway.exportDocument(target, options);
  assert.deepEqual(await gateway.exportDocument(target, options), exported);
  const portable = await gateway.readExport(
    { ...target, exporter_hash: exported.exporter_hash },
    options,
  );
  assert.equal(createHash("sha256").update(portable.html).digest("hex"), exported.hash);
  assert.equal(Buffer.byteLength(portable.html), exported.bytes);
  assert.ok(portable.html.includes("abracode-license-notices"));
  assert.ok(portable.html.includes("abracode-report-document"));
  let portable_artifact: string | undefined;
  if (process.env.ABRACODE_TEST_EVIDENCE_DIR) {
    const dir = resolve(process.env.ABRACODE_TEST_EVIDENCE_DIR);
    assert.ok(dir !== o.root && !dir.startsWith(o.root + "/"));
    await mkdir(dir, { recursive: true });
    portable_artifact = join(dir, `research-architecture-${first.artifact.hash}.html`);
    await import("node:fs/promises").then((fs) => fs.writeFile(portable_artifact!, portable.html));
    await copyFile(
      first.artifact.path,
      join(dir, `research-architecture-${first.artifact.hash}.json`),
    );
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
    exact_json_reopened_after_restart: true,
    portable_export: exported,
    retired_worktree: true,
    native_file_link_source:
      "OpenCode v2.3.0 graphical file renderer/artifact viewer (source inspection)",
    native_gui_clickthrough: "not_run: no paired graphical client",
    permissions_unchanged: true,
  };
}
