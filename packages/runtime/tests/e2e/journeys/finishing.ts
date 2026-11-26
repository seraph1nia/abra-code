import { nativeObservation } from "../../helpers/native-observation.ts";
import { prFeedbackLifecycle } from "../pr-feedback.ts";
import * as Id from "@abracode/contracts/identities";
import { run } from "../../effects.ts";
import assert from "node:assert/strict";
import { writeFile, rename, readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { type NativeHarness } from "../native-harness.ts";
import { eventually } from "../native-timing.ts";
import { type runResearchContracts } from "./research-contracts.ts";
import { restartWithOverrides, type Baseline } from "./restart-overrides.ts";
export async function runFinishing(
  h: NativeHarness,
  legacy?: Baseline & Awaited<ReturnType<typeof runResearchContracts>>,
) {
  const {
    root,
    git,
    engineeringEvidence,
    forgeState,
    client,
    loc,
    observer,
    observeWork,
    atPhase,
    supervisor,
    invoke,
  } = h;
  const { controls } = h.mock;
  const feedbackIssue = await prFeedbackLifecycle({
    root,
    forgeState,
    invoke,
    observeBusy: (tool, args) => invoke(tool, args, true),
    eventually,
    work: observeWork,
    failExploreOnce: () => {
      controls.failFirstExplore = true;
      controls.stallFirstExplore = true;
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
  await restartWithOverrides(h, legacy);
  if (legacy) {
    assert.deepEqual(
      (await invoke("abra_work_create_batch", legacy.nativeBatchInput)).tasks.map((task: any) => [
        task.client_key,
        task.issue.id,
      ]),
      legacy.nativeMapping,
    );
    engineeringEvidence.push({
      batch_restart: legacy.nativeBatchInput.request_id,
      mapping: legacy.nativeMapping,
      identity_preserved: true,
    });
    assert.ok(
      (await nativeObservation(() => observer.detail({ issue_id: legacy.issue.id }, loc))).archive,
    );
    assert.match(
      (await observer.report({ issue_id: legacy.researchIssue.id }, loc)).content,
      /Research kept/,
    );
    assert.equal(
      (await invoke("abra_work_status", { issue_id: legacy.exhaustedIssue.id })).execution.rounds
        .length,
      1,
    );
  }
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
    (await nativeObservation(() => observer.detail({ issue_id: feedbackIssue.id }, loc))).work
      .outcome?.cleanup.state,
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
  await writeFile(unknown, "Unknown content must survive the directory-only answer after restart.");
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
    if (!(await atPhase(feedbackIssue.id, "completed"))) return undefined;
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
}
