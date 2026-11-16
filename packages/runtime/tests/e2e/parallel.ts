import assert from "node:assert/strict";
import { OpenCode } from "@opencode/client";
import { parseDocument } from "yaml";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { repo } from "../fixtures.ts";
import { run } from "../effects.ts";
import { type SessionId } from "../../src/identities.ts";

type Invoke = (tool: string, args: unknown) => Promise<any>;
type Execution = {
  issue_id: string;
  research_session_id: string;
  prompt_id: string;
  worktree_directory: string;
  current_phase: string;
  stop_status?: "requested" | "confirmed";
};
/** Existing server/provider, controller tools and disposable repository factory. */
export async function parallelJourney(options: {
  root: string;
  home: string;
  client: ReturnType<typeof OpenCode.make>;
  supervisor: SessionId;
  workerQuestion: (session: string, input: unknown) => Promise<unknown>;
  invoke: Invoke;
  eventually: <T>(action: () => Promise<T | undefined>, timeout?: number) => Promise<T>;
  restart: () => Promise<void>;
  seen: Set<string>;
  release: (key: string) => void;
}) {
  const { root, home, client, invoke, eventually, seen, release } = options;
  const path = await run(repo(root, "parallel-base"));
  await invoke("abra_project_onboard", {
    id: "parallel",
    path,
    action: "register",
    verification: [],
    plan_approval: false,
    merge_approval: false,
    delivery: "branch",
    max_workers: 2,
    max_executions: 4,
    diagnostic_turns: 0,
  });
  const scope = {
    goal: "Understand source",
    acceptance: ["Identify the source behavior"],
    constraints: ["Read only"],
  };
  const input = {
    request_id: "native-parallel-batch",
    tasks: ["one", "two", "three"].map((client_key) => ({
      client_key,
      repository_id: "parallel",
      title: `Parallel research ${client_key}`,
      description: `Read-only parallel-lane-${client_key}`,
      workflow_policy: "research-only",
      scope,
      priority: 0,
      ...(client_key === "one"
        ? { dispatch: { research: { model: { providerID: "fixture", id: "gpt-specialist" } } } }
        : client_key === "two"
          ? { dispatch: { research: { profile: "native-investigator" } } }
          : {}),
    })),
  };
  const batch = await invoke("abra_work_create_batch", input);
  const sorted = [...batch.tasks].sort((a, b) => (a.issue.id < b.issue.id ? -1 : 1));
  const parent = sorted[0],
    other = sorted[1],
    queued = sorted[2];
  const dependent = (
    await invoke("abra_work_create", {
      repository_id: "parallel",
      title: "Dependent research",
      description: "Read-only parallel-lane-dependent",
      workflow_policy: "research-only",
      scope,
      priority: 1,
      dependencies: [parent.issue.id],
      request_id: "native-parallel-dependent",
    })
  ).issue;
  const toggle = async (enabled: boolean, mode?: "attended-automatic" | "unattended") => {
    const path = join(home, "abracode.yaml"),
      settings = parseDocument(await readFile(path, "utf8"));
    if (settings.get("auto_schedule") === enabled && settings.get("supervision_mode") === mode)
      return;
    settings.set("auto_schedule", enabled);
    if (mode) settings.set("supervision_mode", mode);
    else settings.delete("supervision_mode");
    await writeFile(path, settings.toString());
    await options.restart();
  };
  const executions = async (): Promise<Execution[]> => {
    const all = await invoke("abra_work_list", {});
    return all.executions.filter(
      (e: Execution) =>
        batch.tasks.some((task: any) => task.issue.id === e.issue_id) ||
        e.issue_id === dependent.id,
    );
  };
  const state = async (id: string) =>
    (await invoke("abra_work_status", { issue_id: id })).execution as Execution;
  let active: Execution[] = [];
  let stage = "enable";
  try {
    await toggle(true, "attended-automatic");
    stage = "initial two slots";
    active = await eventually(async () => {
      const current = await executions();
      return current.length === 2 && current.every((e) => e.research_session_id) && seen.size === 2
        ? current
        : undefined;
    });
    assert.deepEqual(
      active.map((e) => e.issue_id).sort(),
      [parent.issue.id, other.issue.id].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    );
    const waiting = (await invoke("abra_work_ready", {})).find(
      (row: any) => row.issue.id === queued.issue.id,
    );
    assert.ok(
      waiting.blocker_details.some(
        (block: any) => block.code === "capacity" && block.capacity_kind === "active",
      ),
    );
    assert.ok(
      (await invoke("abra_work_ready", {}))
        .find((row: any) => row.issue.id === dependent.id)
        .blocker_details.some((block: any) => block.code === "dependency"),
    );
    stage = "parent completion";
    release(parent.client_key);
    await eventually(async () =>
      (await state(parent.issue.id)).current_phase === "completed" ? true : undefined,
    );
    stage = "third admission";
    const third = await eventually(async () => {
      const current = await executions();
      assert.ok(
        !current.some((e) => e.issue_id === dependent.id),
        "Dependent cannot consume the slot ahead of eligible higher-priority work",
      );
      return current.find(
        (e) =>
          e.issue_id === queued.issue.id && e.research_session_id && seen.has(queued.client_key),
      );
    });
    assert.equal(
      (await invoke("abra_work_status", { issue_id: parent.issue.id })).issue.status,
      "closed",
    );
    const dependentWait = (await invoke("abra_work_ready", {})).find(
      (row: any) => row.issue.id === dependent.id,
    );
    assert.ok(!dependentWait.blocker_details.some((block: any) => block.code === "dependency"));
    assert.ok(dependentWait.blocker_details.some((block: any) => block.code === "capacity"));
    stage = "dependent admission";
    release(queued.client_key);
    const dependentWorker = await eventually(async () => {
      const current = await executions();
      return current.find(
        (e) => e.issue_id === dependent.id && e.research_session_id && seen.has("dependent"),
      );
    });
    const restarting = [await state(other.issue.id), dependentWorker];
    stage = "restart active workers";
    await toggle(true, "unattended");
    const retained = await eventually(async () => {
      const current = await executions();
      return current.length === 4 && current.every((e) => e.research_session_id)
        ? current
        : undefined;
    });
    for (const before of restarting) {
      const after = retained.find((e) => e.issue_id === before.issue_id)!;
      for (const field of ["research_session_id", "prompt_id", "worktree_directory"] as const)
        assert.equal(after[field], before[field]);
      assert.equal(
        (await client.session.context({ sessionID: after.research_session_id })).filter(
          (message) => message.type === "user" && message.id === after.prompt_id,
        ).length,
        1,
      );
    }
    assert.equal(seen.size, 4);
    stage = "unattended human decision";
    const question = {
      key: "parallel-human-question",
      generation: 0,
      owner: "user",
      scope: "Read-only accepted investigation",
      question: "May the existing read-only investigation continue?",
    };
    await options.workerQuestion(dependentWorker.research_session_id, question);
    const human = await eventually(async () => {
      const status = await invoke("abra_work_status", { issue_id: dependent.id });
      return status.execution.attention?.find(
        (a: any) => a.code === "decision_pending" && a.status === "pending",
      );
    });
    assert.equal(human.prompt_id, undefined);
    const rootPrompts = async () =>
      (await client.session.context({ sessionID: options.supervisor }))
        .filter((m) => m.type === "user" && JSON.stringify(m).includes(human.id))
        .map((m) => m.id);
    const rootBefore = await rootPrompts();
    await assert.rejects(
      invoke("abra_work_decision", {
        issue_id: dependent.id,
        key: question.key,
        generation: 0,
        action: "answer",
        answer: "Model suggestion",
      }),
      /User-owned answers/,
    );
    const form = await invoke("abra_work_decision", {
      issue_id: dependent.id,
      key: question.key,
      generation: 0,
      action: "collect",
    });
    assert.ok(form.form_id);
    assert.equal(form.form_session, options.supervisor);
    await options.restart();
    const preserved = await invoke("abra_work_status", { issue_id: dependent.id });
    assert.equal(
      preserved.execution.decisions.find((d: any) => d.key === question.key).form_id,
      form.form_id,
    );
    assert.equal(preserved.execution.attention.filter((a: any) => a.id === human.id).length, 1);
    assert.deepEqual(await rootPrompts(), rootBefore);
    await eventually(async () =>
      (await client.session.form.get({ sessionID: options.supervisor, formID: form.form_id })).state
        .status === "pending"
        ? true
        : undefined,
    );
    await client.session.form.reply({
      sessionID: options.supervisor,
      formID: form.form_id,
      answer: { answer: "Continue within the accepted read-only scope" },
    });
    await invoke("abra_work_decision", {
      issue_id: dependent.id,
      key: question.key,
      generation: 0,
      action: "collect",
    });
    assert.deepEqual(
      (await invoke("abra_work_status", { issue_id: dependent.id })).execution.approval_receipts,
      [],
    );

    // Keep both remaining workers held until automatic admission is disabled;
    // older unrelated fixture goals retain their original conservative posture.
    stage = "final completion";
    await toggle(false);
    for (const id of [other.issue.id, dependent.id]) {
      await invoke("abra_work_control", { issue_id: id, action: "pause" });
      await eventually(async () =>
        (await state(id)).stop_status === "confirmed" ? true : undefined,
      );
      await invoke("abra_work_control", { issue_id: id, action: "resume" });
    }
    release(other.client_key);
    release("dependent");
    await eventually(async () => {
      const current = await executions();
      return current.length === 4 && current.every((e) => e.current_phase === "completed")
        ? true
        : undefined;
    });
    const done = await executions();
    assert.equal(new Set(done.map((e) => e.research_session_id)).size, 4);
    assert.equal(new Set(done.map((e) => e.worktree_directory)).size, 4);
    assert.equal((await invoke("abra_work_create_batch", input)).tasks.length, 3);
    return {
      parallel_batch: input.request_id,
      capacity: 2,
      postures: ["attended-automatic", "unattended"],
      unattended_human_notice: {
        id: human.id,
        form_id: form.form_id,
        incident_prompts_added: 0,
        approval_granted: false,
      },
      initial: active.map((e) => ({ issue_id: e.issue_id, session_id: e.research_session_id })),
      queued_issue: queued.issue.id,
      third_session: third.research_session_id,
      dependent_issue: dependent.id,
      dependent_session: dependentWorker.research_session_id,
      restart_identity_preserved: true,
      consumed_turn_recovery:
        "explicit pause/resume; same sessions/worktrees, new authorized assignment IDs",
      completed: 4,
    };
  } catch (error) {
    const diagnostics = await invoke("abra_work_ready", {}).catch(() => []);
    const details = await Promise.all(
      (await executions()).map(async (e) => ({
        issue_id: e.issue_id,
        diagnostics: await invoke("abra_work_diagnostics", { issue_id: e.issue_id })
          .then((d) => ({ phase: d.current_phase, error: d.last_error, sessions: d.sessions }))
          .catch(String),
      })),
    );

    throw new Error(
      `Parallel journey ${stage}: ${String(error)}; seen=${JSON.stringify([...seen])}; native=${JSON.stringify(details)}; readiness=${JSON.stringify(diagnostics.filter((r: any) => r.repository_id === "parallel").map((r: any) => ({ id: r.issue.id, blockers: r.blockers, phase: r.execution?.current_phase, role: r.execution?.active_role, error: r.execution?.error_or_recovery_reason })))}`,
    );
  } finally {
    for (const key of ["one", "two", "three", "dependent"]) release(key);
    await toggle(false);
  }
}
