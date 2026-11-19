import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Git } from "../../src/git/repository.ts";
import { ProcessRunner } from "../../src/process.ts";
import { AbsolutePath } from "../../src/identities.ts";
import { repo } from "../fixtures.ts";
import { run } from "../effects.ts";

export function planningCalls(
  user: string,
  role: string,
  calls: Array<{ name: string; args: any }>,
) {
  if (!user.includes("planning-recovery:") || role !== "apply") return;
  calls.find((c) => c.args.path === "source.txt")!.args.content = user.includes(
    "planning-recovery:second-apply",
  )
    ? "sample\n"
    : "broken sample\n";
  calls.push({
    name: "write",
    args: { path: "native-proof.txt", content: "Retained untracked Apply proof\n" },
  });
}

/** Scripted provider decisions prove native boundaries, not autonomous judgment. */
export async function planningRecoveryJourney(o: {
  root: string;
  supervisor: string;
  client: any;
  invoke: (tool: string, args: any) => Promise<any>;
  eventually: <T>(action: () => Promise<T | undefined>, timeout?: number) => Promise<T>;
  work: (id: string) => Promise<{ phase?: string }>;
  restart: () => Promise<void>;
  holdExplore: () => void;
  held: () => boolean;
  releaseExplore: () => void;
}) {
  const git = new Git(new ProcessRunner());
  const path = AbsolutePath.make(await run(repo(o.root, "planning-recovery")));
  await o.invoke("abra_project_onboard", {
    id: "planning-recovery",
    path,
    action: "register",
    delivery: "branch",
    plan_approval: true,
    repair_rounds: 0,
    diagnostic_turns: 0,
    max_workers: 2,
    max_executions: 5,
    verification: [
      [
        process.execPath,
        "-e",
        'if(require("fs").readFileSync("source.txt","utf8")!=="sample\\n")process.exit(1)',
      ],
    ],
  });
  const create = async (kind: string) =>
    (
      await o.invoke("abra_work_create", {
        repository_id: "planning-recovery",
        title: `Planning recovery ${kind}`,
        description: `planning-recovery:${kind} Implement source.txt and native-proof.txt through retained source baselines.`,
        request_id: `planning-recovery-${kind}`,
        openspec_schema: "spec-driven",
        require_plan_approval: true,
      })
    ).issue;
  const status = async (id: string) =>
    (await o.invoke("abra_work_status", { issue_id: id })).execution;
  const wait = (id: string, phase: string) => {
    let lastObservation = Date.now();
    return o.eventually(async () => {
      const observed = (await o.work(id)).phase;
      if (observed === phase) return status(id);
      if (["failed", "recovery_required", "blocked"].includes(observed ?? "")) {
        const e = await status(id);
        throw Object.assign(
          Error(
            JSON.stringify({
              expected: phase,
              actual: observed,
              error: e.error_or_recovery_reason,
              progress: e.progress,
            }),
          ),
          { terminal: true },
        );
      }
      if (Date.now() - lastObservation > 10000) {
        lastObservation = Date.now();
        const current = await status(id);
        const decisions = current.decisions?.filter((d: any) => d.status === "open");
        if (decisions?.length)
          throw Object.assign(
            Error(
              JSON.stringify({
                expected: phase,
                actual: observed,
                decisions: decisions.map((d: any) => ({ key: d.key, scope: d.scope })),
              }),
            ),
            { terminal: true },
          );
      }
      return undefined;
    }, 90000);
  };
  const approve = async (id: string) => {
    const form = await o.invoke("abra_work_approve", { issue_id: id, kind: "plan" });
    assert.ok(form.form_id);
    await o.client.session.form.reply({
      sessionID: o.supervisor,
      formID: form.form_id,
      answer: { authorize: true },
    });
    return form.form_id;
  };
  const begin = async (kind: string) => {
    const issue = await create(kind);
    await o.invoke("abra_work_start", { issue_id: issue.id });
    await wait(issue.id, "awaiting_plan_approval");
    await approve(issue.id);
    const e = await wait(issue.id, "blocked");
    assert.equal(e.resume_phase, "verifying");
    assert.ok(e.finishing.attribution);
    for (const d of e.decisions ?? [])
      if (d.status === "open" && d.key.startsWith("correction-"))
        await o.invoke("abra_work_decision", {
          issue_id: e.issue_id,
          key: d.key,
          generation: e.control_generation,
          action: "supersede",
          answer:
            "Fixture operator selects explicit replanning instead of a correction round; retain failed check and budget history.",
        });
    return e;
  };
  // A paused companion must remain untouched by restart and recovery.
  const companion = await create("paused");
  await o.invoke("abra_work_start", { issue_id: companion.id });
  await wait(companion.id, "awaiting_plan_approval");
  await o.invoke("abra_work_control", { issue_id: companion.id, action: "pause" });
  const paused = await o.eventually(async () => {
    const e = await status(companion.id);
    return e.stop_status === "confirmed" ? e : undefined;
  });
  let e = await begin("retained");
  const initialPlan = e.plan_fingerprint,
    originalApproval = e.approval_receipts[0];
  const root = AbsolutePath.make(e.worktree_directory);
  const originalHead = await run(git.head(root));
  const replan = {
    issue_id: e.issue_id,
    action: "replan",
    request_id: "native-replan",
    text: "planning-recovery:second-apply Retain existing Apply source; revise planning only.",
  };
  await o.invoke("abra_work_control", replan);
  await o.invoke("abra_work_control", replan); // lost-response style same-intent reuse
  e = await wait(e.issue_id, "awaiting_plan_approval");
  const baseline = structuredClone(e.planning.attempts[0]);
  assert.equal(baseline.admissions.length, 1);
  assert.notEqual(e.plan_fingerprint, initialPlan);
  assert.equal(await readFile(join(root, "source.txt"), "utf8"), "broken sample\n");
  assert.equal(
    await readFile(join(root, "native-proof.txt"), "utf8"),
    "Retained untracked Apply proof\n",
  );
  assert.equal(await run(git.head(root)), originalHead);
  const freshForm = await o.invoke("abra_work_approve", { issue_id: e.issue_id, kind: "plan" });
  assert.notEqual(freshForm.form_id, originalApproval.form_id);
  await o.restart();
  e = await status(e.issue_id);
  assert.deepEqual(e.planning.attempts[0], baseline);
  assert.equal(e.current_phase, "awaiting_plan_approval");
  const recreated = await o.invoke("abra_work_approve", { issue_id: e.issue_id, kind: "plan" });
  assert.equal(recreated.form_id, freshForm.form_id);
  await o.client.session.form.reply({
    sessionID: o.supervisor,
    formID: recreated.form_id,
    answer: { authorize: true },
  });
  const completed = await wait(e.issue_id, "completed");
  assert.equal(completed.review_receipt.passed, true);
  assert.equal(completed.review_receipt.fingerprint, completed.verification_receipt.fingerprint);
  assert.deepEqual(completed.approval_receipts[0], originalApproval);

  // An actual post-capture outside-source mutation must remain a proven violation.
  e = await begin("violation");
  o.holdExplore();
  await o.invoke("abra_work_control", {
    ...replan,
    issue_id: e.issue_id,
    request_id: "native-negative",
  });
  await o.eventually(async () => (o.held() ? true : undefined));
  const negativeRoot = AbsolutePath.make(e.worktree_directory);
  await writeFile(join(negativeRoot, "source.txt"), "External source mutation\n");
  o.releaseExplore();
  e = await wait(e.issue_id, "recovery_required");
  const failed = structuredClone(e.planning.attempts[0]);
  assert.equal(failed.stage, "violated");
  assert.ok(failed.violations.length);
  await assert.rejects(
    o.invoke("abra_work_control", {
      ...replan,
      issue_id: e.issue_id,
      request_id: "cannot-hide-violation",
    }),
    /PLANNING_UNRESOLVED/,
  );
  const offer = async (key: string) => {
    await o.invoke("abra_work_control", {
      issue_id: e.issue_id,
      action: "recover_planning",
      request_id: key,
      text: "planning-recovery:second-apply Adopt prospectively only.",
    });
    const current = await status(e.issue_id);
    const d = current.decisions.find(
      (d: any) => d.status === "open" && d.finishing_target?.kind === "planning_baseline_adoption",
    );
    assert.ok(d);
    const form = await o.invoke("abra_work_decision", {
      issue_id: e.issue_id,
      key: d.key,
      generation: current.control_generation,
      action: "collect",
    });
    return form;
  };
  const answer = async (d: any, action: string) => {
    const f = await o.client.session.form.get({ sessionID: o.supervisor, formID: d.form_id });
    assert.ok(
      f.fields.find((field: any) => field.key === "action").description.includes("NEW baseline"),
    );
    await o.client.session.form.reply({
      sessionID: o.supervisor,
      formID: d.form_id,
      answer: { action },
    });
    await o.invoke("abra_work_decision", {
      issue_id: e.issue_id,
      key: d.key,
      generation: e.control_generation,
      action: "collect",
    });
  };
  const rejected = await offer("native-offer-rejected");
  await answer(rejected, "reject");
  await o.invoke("abra_work_control", {
    issue_id: e.issue_id,
    action: "recover_planning",
    request_id: "native-offer-rejected",
    text: "planning-recovery:second-apply Adopt prospectively only.",
  });
  assert.equal((await status(e.issue_id)).current_phase, "recovery_required");
  const stale = await offer("native-offer-stale");
  await answer(stale, "authorize");
  await writeFile(join(negativeRoot, "source.txt"), "Changed after answered offer\n");
  await assert.rejects(
    o.invoke("abra_work_control", {
      issue_id: e.issue_id,
      action: "recover_planning",
      request_id: "native-offer-stale",
      text: "planning-recovery:second-apply Adopt prospectively only.",
    }),
    /PLANNING_OFFER_CHANGED/,
  );
  const accepted = await offer("native-offer-current");
  await answer(accepted, "authorize");
  await o.invoke("abra_work_control", {
    issue_id: e.issue_id,
    action: "recover_planning",
    request_id: "native-offer-current",
    text: "planning-recovery:second-apply Adopt prospectively only.",
  });
  e = await wait(e.issue_id, "awaiting_plan_approval");
  assert.deepEqual(e.planning.attempts[0], failed);
  assert.equal(e.planning.attempts.at(-1).provenance.kind, "prospective_adoption");
  const adoptionPlan = await approve(e.issue_id);
  assert.notEqual(adoptionPlan, accepted.form_id);
  e = await wait(e.issue_id, "completed");
  assert.equal(e.review_receipt.passed, true);
  const companionAfter = await status(companion.id);
  for (const key of [
    "current_phase",
    "stop_status",
    "control_generation",
    "worktree_directory",
    "approval_receipts",
  ])
    assert.deepEqual(companionAfter[key], paused[key], key);
  return {
    replan: {
      issue: completed.issue_id,
      baseline,
      fresh_form: freshForm.form_id,
      checks: completed.verification_receipt,
      review: completed.review_receipt,
    },
    recovery: {
      issue: e.issue_id,
      original_violation: failed,
      rejected: rejected.form_id,
      stale: stale.form_id,
      adoption: accepted.form_id,
      plan: adoptionPlan,
      history: e.planning.attempts.map((a: any) => ({
        id: a.id,
        stage: a.stage,
        provenance: a.provenance,
      })),
    },
    paused_companion: {
      issue: companion.id,
      generation: companionAfter.control_generation,
      preserved: true,
    },
  };
}
