import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { repo } from "../fixtures.ts";
import { Git } from "../../src/git/repository.ts";
import { run } from "../effects.ts";
import { AbsolutePath } from "../../src/identities.ts";

/** Runs against the main test's isolated service, native sessions and local bare remotes. */
export async function workerContextCapabilities(options: {
  root: string;
  git: Git;
  invoke: (tool: string, input: object) => Promise<any>;
  eventually: <T>(action: () => Promise<T | undefined>) => Promise<T>;
  providerCalls: () => number;
}) {
  const { root, git, invoke, eventually } = options;
  for (const [id, role] of [
    ["context-skill", "research"],
    ["context-agent", "explore"],
    ["context-tools", "apply"],
  ] as const) {
    const path = await run(repo(root, id));
    if (role === "apply") {
      await writeFile(
        join(path, ".missing-worker-tool"),
        "Remove a required tool in the test plugin registry\n",
      );
      await run(git.run(AbsolutePath.make(path), ["add", ".missing-worker-tool"]));
      await run(git.run(AbsolutePath.make(path), ["commit", "-m", "Missing native tool fixture"]));
      await run(git.run(AbsolutePath.make(path), ["push", "origin", "main"]));
    }
    await invoke("abra_project_onboard", {
      id,
      path,
      action: "register",
      verification: [["node", "-e", "process.exit(0)"]],
      plan_approval: false,
      merge_approval: false,
      delivery: "branch",
    });
    const issue = (
      await invoke("abra_work_create", {
        repository_id: id,
        title: `Worker context ${role}`,
        description:
          role === "apply"
            ? "worker-context-provider-must-not-run"
            : "Inspect capability prerequisites",
        workflow_policy:
          role === "research"
            ? "research-only"
            : role === "apply"
              ? "lightweight-fix"
              : "full-openspec",
        scope:
          role === "explore"
            ? undefined
            : {
                goal: "Inspect prerequisite behavior",
                acceptance: ["Report native evidence"],
                constraints: [],
              },
        request_id: id,
      })
    ).issue;
    if (role !== "apply") {
      await assert.rejects(
        invoke("abra_work_start", { issue_id: issue.id }),
        role === "research" ? /required skill/ : /absent from the worker location/,
      );
      const diag = await invoke("abra_work_diagnostics", { issue_id: issue.id, role });
      assert.equal(diag.sessions.length, 0);
      assert.equal(
        diag.contexts[0].status.blocker.code,
        role === "research" ? "SKILL_UNAVAILABLE" : "AGENT_UNAVAILABLE",
      );
      const state = (await invoke("abra_work_status", { issue_id: issue.id })).execution;
      assert.equal(state.capacity_reservation, undefined);
      assert.ok(state.worktree_directory);
    } else {
      const started = await invoke("abra_work_start", { issue_id: issue.id });
      assert.ok(started.apply_session_id);
      const diag = await eventually(async () => {
        const current = await invoke("abra_work_diagnostics", { issue_id: issue.id, role });
        return current.contexts[0]?.status?.blocker?.code === "TOOLS_UNAVAILABLE"
          ? current
          : undefined;
      });
      assert.equal(diag.contexts[0].status.stage, "blocked");
      assert.ok(
        diag.contexts[0].status.observation.missing.some((group: any) =>
          group.any_of.includes("abra_worker_wait"),
        ),
      );
      assert.equal(
        options.providerCalls(),
        0,
        "Missing tools must fail before their provider request",
      );
    }
  }
}
