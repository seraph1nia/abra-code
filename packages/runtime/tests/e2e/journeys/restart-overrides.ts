import { nativeObservation } from "../../helpers/native-observation.ts";
import { parseDocument } from "yaml";
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { type Issue } from "../../../src/domain.ts";
import { type NativeHarness } from "../native-harness.ts";
export type Baseline = { issue: Issue; nativeAttention: { id: string; prompt_id: string } };
export async function restartWithOverrides(h: NativeHarness, baseline?: Baseline) {
  const { home, client, loc, observer, invoke, restart } = h;
  const retainedContext = baseline
    ? (await invoke("abra_work_diagnostics", { issue_id: baseline.issue.id, role: "explore" }))
        .contexts[0]
    : undefined;
  await mkdir(join(home, ".opencode/agents"), { recursive: true });
  await writeFile(
    join(home, ".opencode/agents/central-only.md"),
    "---\ndescription: Only registered in the central test project\nmode: subagent\n---\nCentral fixture profile.\n",
  );
  const configBeforeRestart = await readFile(join(home, "abracode.yaml"), "utf8");
  const restartConfiguration = parseDocument(configBeforeRestart);
  restartConfiguration.set(
    "workers",
    restartConfiguration.createNode({
      explore: { agent: "central-only" },
      research: { required_skills: ["missing-worker-skill"] },
    }),
  );
  await writeFile(join(home, "abracode.yaml"), restartConfiguration.toString());
  await restart();
  if (baseline) {
    assert.equal(
      (await invoke("abra_work_status", { issue_id: baseline.issue.id })).execution.current_phase,
      "completed",
    );
    assert.equal(
      (await nativeObservation(() => observer.snapshot({}, loc))).work.find(
        (work) => work.issue_id === baseline.issue.id,
      )?.issue_status,
      "closed",
    );
  }
  if (baseline) {
    const recoveredAttention = (await invoke("abra_work_status", { issue_id: baseline.issue.id }))
      .execution.attention;
    assert.equal(
      recoveredAttention.find((a: any) => a.id === baseline.nativeAttention.id).prompt_id,
      baseline.nativeAttention.prompt_id,
    );
    const retiredDiff = await observer.diff(
      { issue_id: baseline.issue.id, scope: "all", file: "source.txt" },
      loc,
    );
    assert.ok(retiredDiff.historical);
    assert.match(retiredDiff.patch!, /original/);
    assert.equal(
      (await invoke("abra_work_diagnostics", { issue_id: baseline.issue.id, role: "explore" }))
        .contexts[0].context_id,
      retainedContext.context_id,
    );
  }
  assert.ok((await client.agent.list(loc)).data.some((agent) => agent.id === "central-only"));
}
