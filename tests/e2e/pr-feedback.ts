import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { type FormId, type IssueId } from "../../src/identities.ts";
import { type toolOutputs } from "../../src/opencode/tool-contracts.ts";
import { type FeedbackPageSchema } from "../../src/workflow/feedback-contracts.ts";
import { join } from "node:path";
import { repo } from "../fixtures.ts";
import { run } from "../effects.ts";
import { Git } from "../../src/git/repository.ts";
import { ProcessRunner } from "../../src/process.ts";
import { AbsolutePath } from "../../src/identities.ts";

type Execution = (typeof toolOutputs)["work_pr_action"]["Type"];
type Invoke = <K extends keyof typeof toolOutputs>(
  tool: `abra_${K}`,
  args: Record<string, unknown>,
) => Promise<(typeof toolOutputs)[K]["Type"]>;
interface Context {
  root: string;
  forgeState: string;
  invoke: Invoke;
  observeBusy: Invoke;
  approve: (form: FormId) => Promise<void>;
  answerDisposition: (form: FormId, answer: Record<string, string | string[]>) => Promise<void>;
  failExploreOnce: () => void;
  feedback: (issue: IssueId) => Promise<typeof FeedbackPageSchema.Type>;
  eventually: <T>(action: () => Promise<T | undefined>, timeout?: number) => Promise<T>;
}
export async function prFeedbackLifecycle({
  root,
  forgeState,
  invoke,
  observeBusy,
  approve,
  answerDisposition,
  failExploreOnce,
  feedback,
  eventually,
}: Context) {
  // Complete PR feedback lifecycle against a recording local forge, with real native workers and Git preservation.
  const feedbackPath = await run(repo(root, "feedback"));
  await writeFile(
    join(feedbackPath, ".git/info/exclude"),
    "\n.cleanup-residue/\n.generated-residue/\n",
  );
  await writeFile(
    forgeState,
    JSON.stringify({
      remote: `${feedbackPath}.git`,
      check: "pass",
      attempt: 1,
      counts: {},
      permission_unavailable: true,
      merge_hold: true,
    }),
  );
  await invoke("abra_project_onboard", {
    id: "feedback",
    path: feedbackPath,
    action: "register",
    verification: [
      [
        process.execPath,
        "-e",
        'if(!require("fs").readFileSync("source.txt","utf8").startsWith("sample"))process.exit(1)',
      ],
    ],
    delivery: "github-pr",
    plan_approval: false,
    repair_rounds: 1,
    diagnostic_turns: 0,
    publication: "draft-until-verified",
    ci_retry: { max_reruns: 1, workflows: [".github/workflows/ci.yml"] },
    reviewers: {
      users: ["reviewer"],
      teams: [],
      request: "on-ready",
      rerequest_after_correction: false,
    },
    discussion: { replies: "verified", resolve_threads: "addressed" },
  });
  const feedbackIssue = (
    await invoke("abra_work_create", {
      repository_id: "feedback",
      title: "Maintain sample through PR feedback",
      description: "Implement the sample and preserve the accepted behavior",
      request_id: "native-pr-feedback",
    })
  ).issue;
  failExploreOnce();
  await invoke("abra_work_start", { issue_id: feedbackIssue.id });
  const feedbackStatus = () => invoke("abra_work_status", { issue_id: feedbackIssue.id });
  const exhausted = await eventually(async () => {
    const current = (await feedbackStatus()).execution!;
    return current.current_phase === "failed" &&
      current.attention?.some((a) => a.code === "suspected_stall" && a.status === "exhausted")
      ? current
      : undefined;
  }, 40000);
  await invoke("abra_work_control", { issue_id: feedbackIssue.id, action: "retry" });
  let feedbackExecution: Execution = await eventually(async () => {
    const status = await feedbackStatus();
    if (["blocked", "failed", "recovery_required"].includes(status.execution!.current_phase))
      throw Error(JSON.stringify(status));
    return status.execution!.current_phase === "awaiting_merge" &&
      status.execution!.feedback?.actions.some(
        (a) => a.kind === "reviewers" && a.schema_version === 2 && a.preflight?.retryable,
      )
      ? status.execution!
      : undefined;
  }, 40000);
  const initialForge = JSON.parse(await readFile(forgeState, "utf8"));
  assert.equal(initialForge.created_draft, true);
  assert.match(initialForge.created_body, /pending; provisional/);
  assert.equal(initialForge.counts.create, 1);
  assert.equal(initialForge.counts.ready, 1);
  assert.equal(initialForge.counts.reviewers ?? 0, 0);
  const preparedReviewers = feedbackExecution.feedback!.actions.find(
    (a) => a.kind === "reviewers",
  )!;
  assert.equal(preparedReviewers.status, "prepared");
  assert.equal(
    preparedReviewers.schema_version === 2 && preparedReviewers.submission.stage,
    "unsubmitted",
  );
  const feedbackHead = feedbackExecution.delivered_commit!,
    feedbackArchive = feedbackExecution.archive_path!;
  const oldMerge = await invoke("abra_work_approve", {
    issue_id: feedbackIssue.id,
    kind: "merge",
  });
  assert.ok("form_id" in oldMerge);
  assert.equal(oldMerge.approval_required, true);
  await approve(oldMerge.form_id);
  await invoke("abra_work_approve", { issue_id: feedbackIssue.id, kind: "merge" });
  const waiting = (await feedbackStatus()).execution!;
  assert.equal(waiting.current_phase, "awaiting_merge");
  assert.ok(
    waiting.approval_receipts.some(
      (a) => a.form_id === oldMerge.form_id && a.authorized_at !== undefined,
    ),
  );
  assert.equal(JSON.parse(await readFile(forgeState, "utf8")).counts.merge ?? 0, 0);
  initialForge.permission_unavailable = false;
  initialForge.two_jobs = true;
  initialForge.defer_rerun_attempt = true;
  initialForge.check = "fail";
  await writeFile(forgeState, JSON.stringify(initialForge));
  const requested = await invoke("abra_work_pr_action", {
    issue_id: feedbackIssue.id,
    generation: feedbackExecution.control_generation,
    expected_head: feedbackHead,
    kind: "reviewers",
    action_id: preparedReviewers.id,
  });
  assert.equal(
    requested.feedback!.actions.find((a) => a.id === preparedReviewers.id)!.status,
    "confirmed",
  );
  const transient = (await invoke("abra_work_findings", { issue_id: feedbackIssue.id })).filter(
    (f) => f.kind === "check",
  );
  assert.equal(transient.length, 2);
  await invoke("abra_work_feedback", {
    issue_id: feedbackIssue.id,
    generation: feedbackExecution.control_generation,
    expected_head: feedbackHead,
    finding_ids: transient.map((f) => f.id),
    disposition: "transient",
    reason: "Fixture runner infrastructure unavailable",
  });
  const rerunning = await invoke("abra_work_pr_action", {
    issue_id: feedbackIssue.id,
    generation: feedbackExecution.control_generation,
    expected_head: feedbackHead,
    kind: "rerun",
    finding_id: transient[0].id,
  });
  const rerun = rerunning.feedback!.actions.find((a) => a.kind === "rerun");
  assert.ok(rerun);
  assert.equal(rerunning.rounds?.length ?? 0, 0);
  assert.equal(rerun.schema_version === 2 && rerun.kind === "rerun" && rerun.findings.length, 2);
  const duplicate = await invoke("abra_work_pr_action", {
    issue_id: feedbackIssue.id,
    generation: feedbackExecution.control_generation,
    expected_head: feedbackHead,
    kind: "rerun",
    finding_id: transient[1].id,
  });
  assert.equal(duplicate.feedback!.actions.filter((a) => a.kind === "rerun").length, 1);
  const retriedForge = JSON.parse(await readFile(forgeState, "utf8"));
  retriedForge.check = "pass";
  retriedForge.attempt = 2;
  retriedForge.defer_rerun_attempt = false;
  retriedForge.two_jobs = false;
  await writeFile(forgeState, JSON.stringify(retriedForge));
  const reconciledRerun = await invoke("abra_work_pr_action", {
    issue_id: feedbackIssue.id,
    generation: feedbackExecution.control_generation,
    expected_head: feedbackHead,
    kind: "rerun",
    action_id: rerun.id,
  });
  assert.equal(
    reconciledRerun.feedback!.actions.find((a) => a.id === rerun.id)!.status,
    "confirmed",
  );
  Object.assign(initialForge, JSON.parse(await readFile(forgeState, "utf8")));
  assert.equal(initialForge.counts.rerun, 1);
  initialForge.attempt = 3;
  initialForge.check = "fail";
  initialForge.lose_reply_response = true;
  initialForge.threads = [
    {
      id: "PRRT_fixture",
      isResolved: false,
      viewerCanResolve: true,
      path: "source.txt",
      comments: {
        nodes: [
          {
            id: "PRRC_fixture",
            databaseId: 11,
            body: "Preserve the accepted sample behavior during correction",
            url: `${initialForge.pr.url}#discussion_r11`,
            updatedAt: "2026-10-16T00:00:00Z",
            author: { login: "reviewer" },
            originalCommit: { oid: feedbackHead },
            pullRequestReview: { state: "COMMENTED" },
          },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    },
  ];
  await writeFile(forgeState, JSON.stringify(initialForge));
  const feedbackFindings = await invoke("abra_work_findings", { issue_id: feedbackIssue.id });
  const threadFinding = feedbackFindings.find((x) => x.kind === "thread");
  assert.ok(threadFinding);
  await invoke("abra_work_feedback", {
    issue_id: feedbackIssue.id,
    generation: feedbackExecution.control_generation,
    expected_head: feedbackHead,
    finding_ids: feedbackFindings.map((x) => x.id),
    disposition: "in_scope",
    reason: "Retain accepted sample behavior without expanding scope",
  });
  // Disabled diagnostics retain feedback-inspection questions too. Record the
  // explicit inspection above through their native forms before correcting.
  for (const d of (await feedbackStatus()).execution!.decisions ?? []) {
    if (d.status !== "open" || !d.key.startsWith("feedback-budget-")) continue;
    const collected = await invoke("abra_work_decision", {
      issue_id: feedbackIssue.id,
      key: d.key,
      generation: d.generation,
      action: "collect",
    });
    await answerDisposition(collected.form_id!, {
      answer:
        "Inspected the exact retained feedback and classified it in scope; proceed through the configured corrective policy.",
    });
    await invoke("abra_work_decision", {
      issue_id: feedbackIssue.id,
      key: d.key,
      generation: d.generation,
      action: "collect",
    });
  }
  feedbackExecution = await invoke("abra_work_correct", {
    issue_id: feedbackIssue.id,
    expected_head: feedbackHead,
    finding_ids: [threadFinding.id],
    scope: "in_scope",
    instructions: "Keep accepted sample behavior and verify the error case",
  });
  const correctingForge = JSON.parse(await readFile(forgeState, "utf8"));
  correctingForge.check = "pass";
  await writeFile(forgeState, JSON.stringify(correctingForge));
  feedbackExecution = await eventually(async () => {
    const status = await feedbackStatus();
    if (["blocked", "failed", "recovery_required"].includes(status.execution!.current_phase))
      throw Error(JSON.stringify(status));
    return status.execution!.current_phase === "awaiting_merge" &&
      status.execution!.delivered_commit !== feedbackHead &&
      status.execution!.feedback?.actions.some(
        (a) => a.kind === "reply" && a.status === "uncertain",
      )
      ? status.execution!
      : undefined;
  }, 40000);
  assert.equal(feedbackExecution.rounds!.length, 1);
  assert.notEqual(feedbackExecution.archive_path, feedbackArchive);
  assert.equal(feedbackExecution.rounds![0].archive_path, feedbackArchive);
  assert.equal(feedbackExecution.pull_request_reference, initialForge.pr.url);
  assert.equal(
    feedbackExecution.feedback!.actions.find((a) => a.kind === "reply")!.status,
    "uncertain",
  );
  await invoke("abra_work_pr_action", {
    issue_id: feedbackIssue.id,
    generation: feedbackExecution.control_generation,
    expected_head: feedbackExecution.delivered_commit,
    kind: "reply",
    finding_id: threadFinding.id,
  });
  await invoke("abra_work_pr_action", {
    issue_id: feedbackIssue.id,
    generation: feedbackExecution.control_generation,
    expected_head: feedbackExecution.delivered_commit,
    kind: "resolve",
    finding_id: threadFinding.id,
  });
  const releasableForge = JSON.parse(await readFile(forgeState, "utf8"));
  releasableForge.merge_hold = true;
  await writeFile(forgeState, JSON.stringify(releasableForge));
  const staleMerge = await invoke("abra_work_approve", {
    issue_id: feedbackIssue.id,
    kind: "merge",
  });
  assert.ok("form_id" in staleMerge);
  const lateHead = feedbackExecution.delivered_commit;
  const git = new Git(new ProcessRunner());
  const directory = AbsolutePath.make(feedbackExecution.worktree_directory!);
  await writeFile(join(directory, "source.txt"), "sample late validated revision\n");
  await run(git.run(directory, ["add", "source.txt"]));
  await run(git.run(directory, ["commit", "-m", "Existing accepted late revision"]));
  await approve(staleMerge.form_id);
  await invoke("abra_work_approve", { issue_id: feedbackIssue.id, kind: "merge" });
  const adoption = await eventually(async () => {
    const current = (await feedbackStatus()).execution!;
    return current.decisions?.find(
      (d) => d.status === "open" && d.finishing_target?.kind === "adopt" && d.form_id,
    );
  }, 40000);
  await answerDisposition(adoption.form_id!, { action: "authorize" });
  feedbackExecution = await eventually(async () => {
    const current = (await feedbackStatus()).execution!;
    if (["blocked", "failed", "recovery_required"].includes(current.current_phase))
      throw Error(JSON.stringify(current));
    return current.current_phase === "awaiting_merge" && current.delivered_commit !== lateHead
      ? current
      : undefined;
  }, 40000);
  assert.equal(feedbackExecution.finishing!.synchronization!.length, 1);
  for (const incident of exhausted.attention!.filter((a) => a.code === "suspected_stall"))
    assert.equal(
      feedbackExecution.attention!.find((a) => a.id === incident.id)!.status,
      "superseded",
    );
  assert.equal(feedbackExecution.apply_session_id, undefined);
  assert.equal(feedbackExecution.pull_request_reference, initialForge.pr.url);
  assert.ok(
    !feedbackExecution.approval_receipts.some(
      (a) =>
        a.kind === "merge" &&
        a.fingerprint === feedbackExecution.delivered_commit &&
        a.authorized_at,
    ),
  );
  await mkdir(join(directory, ".generated-residue"));
  await writeFile(join(directory, ".generated-residue/cache"), "Generated fixture output");
  await invoke("abra_work_approve", { issue_id: feedbackIssue.id, kind: "merge" });
  const residue = await eventually(async () =>
    (await feedbackStatus()).execution!.decisions?.find(
      (d) => d.status === "open" && d.finishing_target?.kind === "residue" && d.form_id,
    ),
  );
  assert.equal((await feedbackStatus()).execution!.attention_turns ?? 0, 0);
  await answerDisposition(residue.form_id!, {
    action: "generated",
    generated_paths: [".generated-residue"],
  });
  await eventually(async () =>
    (await feedbackStatus()).execution!.finishing?.authorizations?.length ? true : undefined,
  );
  const newMerge = await invoke("abra_work_approve", {
    issue_id: feedbackIssue.id,
    kind: "merge",
  });
  assert.ok("form_id" in newMerge);
  assert.notEqual(newMerge.form_id, oldMerge.form_id);
  assert.notEqual(newMerge.form_id, staleMerge.form_id);
  assert.equal(newMerge.approval_required, true);
  await approve(newMerge.form_id);
  const acceptedMerge = await invoke("abra_work_approve", {
    issue_id: feedbackIssue.id,
    kind: "merge",
  });
  assert.ok("current_phase" in acceptedMerge);
  assert.equal(acceptedMerge.outcome!.approval.state, "recorded");
  assert.notEqual(acceptedMerge.outcome!.delivery.state, "verified");
  const authorizedForge = JSON.parse(await readFile(forgeState, "utf8"));
  assert.equal(authorizedForge.counts.merge ?? 0, 0);
  authorizedForge.merge_hold = false;
  authorizedForge.merge_delay_ms = 3000;
  await writeFile(forgeState, JSON.stringify(authorizedForge));
  // Reconciliation or explicit finish owns the delayed local merge; an overlapping
  // approval collection observes busy ownership and must not repeat the mutation.
  const finishing = invoke("abra_work_finish", { issue_id: feedbackIssue.id }).then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  await eventually(
    async () => (JSON.parse(await readFile(forgeState, "utf8")).merge_started ? true : undefined),
    40000,
  );
  // Residue arrives after the guarded merge was submitted, exercising post-merge cleanup.
  await mkdir(join(feedbackExecution.worktree_directory!, ".cleanup-residue"));
  await writeFile(
    join(feedbackExecution.worktree_directory!, ".cleanup-residue/keep.txt"),
    "Fixture-owned residue; preserve until explicit test disposition.",
  );
  const busy = await observeBusy("abra_work_approve", {
    issue_id: feedbackIssue.id,
    kind: "merge",
  });
  assert.ok("category" in busy);
  assert.equal(busy.category, "operation_in_progress");
  assert.equal(busy.performed, false);
  const finishResult = await finishing;
  if ("error" in finishResult) throw finishResult.error;
  const blockedStatus = await eventually(async () => {
    const status = await feedbackStatus();
    if (["blocked", "failed", "recovery_required"].includes(status.execution.current_phase))
      throw Error(JSON.stringify(status));
    return status.execution.current_phase === "cleaning" && status.execution.cleanup_blocker
      ? status
      : undefined;
  }, 40000);
  const feedbackDone: Execution = blockedStatus.execution;
  assert.equal(blockedStatus.outcome!.approval.state, "recorded");
  assert.equal(blockedStatus.outcome!.delivery.state, "verified");
  assert.equal(blockedStatus.outcome!.cleanup.state, "blocked");
  assert.equal(blockedStatus.outcome!.closure, "open");
  assert.equal(feedbackDone.cleanup_blocker!.paths[0].path, ".cleanup-residue");
  const collected = await invoke("abra_work_approve", {
    issue_id: feedbackIssue.id,
    kind: "merge",
  });
  assert.ok("current_phase" in collected);
  assert.equal(collected.outcome!.approval.state, "recorded");
  const finalForge = JSON.parse(await readFile(forgeState, "utf8"));
  assert.equal(finalForge.counts.create, 1);
  assert.equal(finalForge.counts.rerun, 1);
  assert.equal(finalForge.counts.reviewers, 1);
  assert.equal(finalForge.counts.reply, 1);
  assert.equal(finalForge.counts.resolve, 1);
  assert.equal(finalForge.counts.merge, 1);
  assert.ok(feedbackDone.delivery_receipt);
  assert.equal(
    (await feedback(feedbackIssue.id)).actions.filter(
      (a) => a.kind === "reply" && a.status === "confirmed",
    ).length,
    1,
  );
  return feedbackIssue;
}
