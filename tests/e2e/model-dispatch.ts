import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseDocument } from "yaml";
import { repo } from "../fixtures.ts";
import { run } from "../effects.ts";

/** Real inventory, sessions and controller recovery; no additional harness. */
export async function modelDispatchJourney(options: {
  root: string;
  home: string;
  invoke: (tool: string, input: unknown) => Promise<any>;
  eventually: <T>(action: () => Promise<T | undefined>, timeout?: number) => Promise<T>;
  restart: () => Promise<void>;
  hold: () => void;
  held: () => boolean;
  release: () => void;
}) {
  const { root, home, invoke, eventually } = options;
  const catalog = await invoke("abra_config", { action: "status" });
  assert.equal(catalog.dispatch.profiles["native-investigator"].role, "research");
  assert.equal(catalog.dispatch.inventory, "not_observed");
  const path = await run(repo(root, "model-base"));
  await invoke("abra_project_onboard", {
    id: "models",
    path,
    action: "register",
    verification: [],
    plan_approval: false,
    merge_approval: false,
    delivery: "branch",
    max_workers: 1,
    max_executions: 3,
    diagnostic_turns: 0,
    dispatch: { research: { model: { providerID: "fixture", id: "gpt-fixture" } } },
  });
  const create = async (request_id: string, selection: unknown, description = "Read source") =>
    (
      await invoke("abra_work_create", {
        repository_id: "models",
        title: request_id,
        description,
        request_id,
        workflow_policy: "research-only",
        scope: {
          goal: "Understand source",
          acceptance: ["Identify the source behavior"],
          constraints: ["Read only"],
        },
        dispatch: { research: selection },
      })
    ).issue;
  const status = (issue_id: string) => invoke("abra_work_status", { issue_id });
  options.hold();
  const first = await create(
    "native-model-profile",
    { profile: "native-investigator" },
    "Read-only model-capture-acceptance",
  );
  const started = await invoke("abra_work_start", { issue_id: first.id });
  try {
    await eventually(async () => (options.held() ? true : undefined));
    const before = await status(first.id);
    assert.equal(before.sessions[0].available_tools.model.id, "gpt-specialist");
    assert.equal(
      before.execution.configuration_snapshot.dispatch_sources.research.source,
      "task.profile",
    );
    const configPath = join(home, "abracode.yaml");
    const settings = parseDocument(await readFile(configPath, "utf8"));
    settings.setIn(["profiles", "native-investigator", "model"], {
      providerID: "fixture",
      id: "gpt-fixture",
    });
    await writeFile(configPath, settings.toString());
    await options.restart();
    const retained = (await status(first.id)).execution;
    assert.equal(retained.research_session_id, started.research_session_id);
    assert.equal(retained.worktree_directory, started.worktree_directory);
    assert.equal(retained.configuration_snapshot.workers.research.model.id, "gpt-specialist");
    assert.equal(
      retained.configuration_snapshot.dispatch_sources.research.profile,
      "native-investigator",
    );
    await invoke("abra_work_control", { issue_id: first.id, action: "pause" });
    await eventually(async () =>
      (await status(first.id)).execution.stop_status === "confirmed" ? true : undefined,
    );
    options.release();
    await invoke("abra_work_control", { issue_id: first.id, action: "resume" });
    await eventually(async () =>
      (await status(first.id)).execution.current_phase === "completed" ? true : undefined,
    );
    const actual = await invoke("abra_work_diagnostics", { issue_id: first.id });
    assert.equal(actual.sessions[0].model.id, "gpt-specialist");
    assert.equal(actual.sessions[0].configured_model.id, "gpt-specialist");
    assert.equal(actual.sessions[0].model_source.source, "task.profile");
    const toolErrors = actual.sessions[0].recent_messages
      .flatMap((m: any) => m.tools ?? [])
      .filter((t: any) => t.status === "error");
    for (const name of ["patch", "shell", "abra_work_finish"])
      assert.ok(toolErrors.some((t: any) => t.name === name));
  } finally {
    options.release();
  }
  await invoke("abra_project_onboard", {
    id: "models",
    path,
    action: "register",
    dispatch: { research: { model: { providerID: "fixture", id: "gpt-specialist" } } },
  });
  const second = await create("native-model-explicit", {
    model: { providerID: "fixture", id: "gpt-fixture" },
  });
  await invoke("abra_work_start", { issue_id: second.id });
  await eventually(async () =>
    (await status(second.id)).execution.current_phase === "completed" ? true : undefined,
  );
  const explicit = await status(second.id);
  assert.equal(explicit.sessions[0].model.id, "gpt-fixture");
  assert.equal(
    explicit.execution.configuration_snapshot.dispatch_sources.research.source,
    "task.model",
  );
  const unavailable = [];
  for (const [key, model, expected] of [
    [
      "native-missing-model",
      { providerID: "fixture", id: "gpt-not-installed" },
      /MODEL_UNAVAILABLE/,
    ],
    [
      "native-missing-variant",
      { providerID: "fixture", id: "gpt-fixture", variant: "not-installed" },
      /MODEL_VARIANT_UNAVAILABLE/,
    ],
  ] as const) {
    const issue = await create(key, { model });
    await assert.rejects(invoke("abra_work_start", { issue_id: issue.id }), expected);
    const failed = (await status(issue.id)).execution;
    const ready = await invoke("abra_work_ready", {});
    assert.ok(
      ready
        .find((r: any) => r.issue.id === issue.id)
        .blockers.some((reason: string) => reason.includes("absent")),
    );
    assert.equal(failed.research_session_id, undefined);
    assert.equal(failed.capacity_reservation, undefined);
    assert.equal(failed.configuration_snapshot.workers.research.model.id, model.id);
    unavailable.push({
      issue_id: issue.id,
      selection: failed.configuration_snapshot.workers.research.model,
      reason: failed.error_or_recovery_reason,
    });
  }
  return {
    task_profile: first.id,
    explicit_task: second.id,
    captured_model: "gpt-specialist",
    profile_edit_ignored_by_active_execution: true,
    retained_session: started.research_session_id,
    retained_worktree: started.worktree_directory,
    read_only_permissions_preserved: true,
    unavailable,
  };
}
