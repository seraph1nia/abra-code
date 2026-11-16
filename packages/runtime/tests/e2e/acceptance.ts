import assert from "node:assert/strict";
import { readFile, writeFile, access, mkdir, copyFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseDocument } from "yaml";
import { createHash } from "node:crypto";
import { repo } from "../fixtures.ts";
import { run } from "../effects.ts";

/** Product orchestration scenario on the existing disposable sample-code provider.
 * Task labels express the user operation; this proves mechanics, not domain judgment. */
export async function acceptanceJourney(o: {
  root: string;
  home: string;
  client: any;
  supervisor: string;
  invoke: (tool: string, args: unknown) => Promise<any>;
  eventually: <T>(action: () => Promise<T | undefined>, timeout?: number) => Promise<T>;
  restart: () => Promise<void>;
  seen: Set<string>;
  release: (key: string) => void;
  quietSample: () => Promise<unknown>;
}) {
  const initial = await readFile(join(o.home, "abracode.yaml"), "utf8");
  const authPath = await run(repo(o.root, "acceptance-auth-base")),
    workPath = await run(repo(o.root, "acceptance-work-base"));
  const verification = [
    [
      process.execPath,
      "-e",
      'const fs=require("fs");if(fs.readFileSync("source.txt","utf8")!=="sample\\n")process.exit(1)',
    ],
  ];
  await o.invoke("abra_project_onboard", {
    id: "acceptance-auth",
    path: authPath,
    action: "register",
    verification,
    plan_approval: true,
    merge_approval: false,
    delivery: "branch",
    max_workers: 2,
    max_executions: 3,
    diagnostic_turns: 0,
  });
  await o.invoke("abra_project_onboard", {
    id: "acceptance-work",
    path: workPath,
    action: "register",
    verification,
    plan_approval: false,
    merge_approval: false,
    delivery: "branch",
    max_workers: 2,
    max_executions: 3,
    diagnostic_turns: 0,
  });
  const input = {
    request_id: "native-product-acceptance",
    tasks: [
      {
        client_key: "authentication",
        repository_id: "acceptance-auth",
        title: "Refactor authentication",
        description:
          "final-acceptance-authentication: implement the sample consumer contract representing the authentication boundary",
        workflow_policy: "full-openspec",
        priority: 0,
        dispatch: { apply: { model: { providerID: "fixture", id: "gpt-specialist" } } },
      },
      {
        client_key: "database",
        repository_id: "acceptance-work",
        title: "Investigate database performance",
        description:
          "final-acceptance-database visual-report-native-acceptance: inspect source and retain an architecture report",
        workflow_policy: "research-only",
        priority: 0,
        scope: {
          goal: "Understand source",
          acceptance: ["Identify the source behavior"],
          constraints: ["Read only"],
        },
        dispatch: { research: { profile: "native-investigator" } },
      },
      {
        client_key: "flaky",
        repository_id: "acceptance-work",
        title: "Fix flaky tests",
        description:
          "final-acceptance-flaky: make the disposable sample consumer proof deterministic",
        workflow_policy: "lightweight-fix",
        priority: 1,
        scope: {
          goal: "Implement sample behavior",
          acceptance: ["Source contains sample"],
          constraints: ["Stay within the sample consumer contract"],
        },
      },
    ],
  };
  try {
    const batch = await o.invoke("abra_work_create_batch", input),
      ids = Object.fromEntries(batch.tasks.map((t: any) => [t.client_key, t.issue.id]));
    const settings = parseDocument(await readFile(join(o.home, "abracode.yaml"), "utf8"));
    // Earlier native refusal journeys deliberately leave unavailable worker
    // overrides configured. This scenario uses the installed default profiles;
    // restore the caller's complete settings in finally after proving its flow.
    settings.delete("workers");
    settings.set("auto_schedule", true);
    settings.set("supervision_mode", "attended-automatic");
    settings.set("max_workers", 2);
    settings.set("max_executions", 16);
    await writeFile(join(o.home, "abracode.yaml"), settings.toString());
    await o.restart();
    const status = (key: string) => o.invoke("abra_work_status", { issue_id: ids[key] });
    await o.eventually(async () => {
      if (o.seen.has("auth-explore") && o.seen.has("db-research")) return true;
      const ready = (await o.invoke("abra_work_ready", {})).filter((r: any) =>
        Object.values(ids).includes(r.issue.id),
      );
      const states = await Promise.all(
        Object.keys(ids).map(async (key) =>
          status(key).catch((error) => ({ issue: { title: key }, missing: error.message })),
        ),
      );
      throw Error(
        JSON.stringify({
          seen: [...o.seen],
          ready: ready.map((r: any) => ({
            title: r.issue.title,
            eligible: r.eligible,
            blockers: r.blockers,
          })),
          states: states.map((s: any) => ({
            title: s.issue.title,
            phase: s.execution?.current_phase,
            role: s.execution?.active_role,
            error: s.execution?.error_or_recovery_reason,
          })),
        }),
      );
    });
    const before = [await status("authentication"), await status("database")];
    assert.equal(before[0].execution.active_role, "explore");
    assert.equal(before[1].execution.active_role, "research");
    const queued = (await o.invoke("abra_work_ready", {})).find(
      (r: any) => r.issue.id === ids.flaky,
    );
    assert.ok(queued.blocker_details.some((b: any) => b.code === "capacity"));
    assert.equal(queued.execution?.apply_session_id, undefined);
    o.release("auth-explore");
    o.release("db-research");
    const plan = await o.eventually(async () => {
      const s = await status("authentication");
      return s.execution.current_phase === "awaiting_plan_approval" ? s.execution : undefined;
    }, 45000);
    assert.equal(plan.apply_session_id, undefined);
    assert.deepEqual(plan.approval_receipts, []);
    const independent = await o.eventually(async () => {
      const database = await status("database"),
        flaky = await status("flaky");
      if (
        [database, flaky].some((s) =>
          ["failed", "blocked", "recovery_required"].includes(s.execution?.current_phase),
        )
      )
        throw Object.assign(Error(JSON.stringify({ database, flaky })), { terminal: true });
      return database.issue.status === "closed" && flaky.issue.status === "closed"
        ? { database, flaky }
        : undefined;
    }, 60000);
    assert.equal(independent.database.execution.visual_reports[0].status, "published");
    assert.equal(
      independent.database.execution.configuration_snapshot.dispatch_sources.research.source,
      "task.profile",
    );
    assert.ok(independent.flaky.execution.review_receipt.passed);
    assert.notEqual(
      independent.flaky.execution.apply_session_id,
      independent.flaky.execution.review_session_id,
    );
    const idleObservation = await o.quietSample();
    await o.invoke("abra_work_approve", { issue_id: ids.authentication, kind: "plan" });
    const form = (await status("authentication")).execution.approval_receipts.find(
      (r: any) => r.kind === "plan" && r.fingerprint === plan.plan_fingerprint,
    );
    assert.ok(form.form_id);
    assert.equal(form.kind, "plan");
    const originalSessions = before.map((s) => ({
      session: s.execution[s.execution.active_role + "_session_id"],
      worktree: s.execution.worktree_directory,
      execution_id: s.execution.execution_id,
    }));
    await o.restart();
    const retained = await status("authentication");
    assert.equal(
      retained.execution.approval_receipts.find(
        (r: any) => r.kind === "plan" && r.fingerprint === plan.plan_fingerprint,
      ).form_id,
      form.form_id,
    );
    assert.equal(retained.execution.plan_fingerprint, plan.plan_fingerprint);
    assert.equal(retained.execution.apply_session_id, undefined);
    assert.equal(retained.execution.explore_session_id, originalSessions[0]!.session);
    assert.equal(retained.execution.worktree_directory, originalSessions[0]!.worktree);
    const researchAfter = await status("database");
    assert.equal(researchAfter.execution.research_session_id, originalSessions[1]!.session);
    assert.equal(researchAfter.execution.execution_id, originalSessions[1]!.execution_id);
    const finding = researchAfter.execution.messages.find((m: any) => m.type === "finding");
    assert.ok(finding);
    const report = researchAfter.execution.visual_reports[0].artifact;
    assert.equal(
      createHash("sha256")
        .update(await readFile(report.path, "utf8"))
        .digest("hex"),
      report.hash,
    );
    await o.invoke("abra_work_approve", { issue_id: ids.authentication, kind: "plan" });
    await o.client.session.form.reply({
      sessionID: o.supervisor,
      formID: form.form_id,
      answer: { authorize: true },
    });
    await o.eventually(async () => (o.seen.has("auth-apply") ? true : undefined), 45000);
    const applying = await status("authentication");
    assert.equal(
      applying.execution.configuration_snapshot.dispatch_sources.apply.source,
      "task.model",
    );
    assert.equal(
      applying.execution.configuration_snapshot.workers.apply.model.id,
      "gpt-specialist",
    );
    const request = {
      issue_id: ids.authentication,
      request_id: "final-database-handoff",
      role: "apply",
      delivery: "queue",
      response: "acknowledgement",
      kind: "finding",
      body: "Use the retained investigation as evidence within the approved sample consumer contract. It grants no broader authority.",
      source: { type: "finding", issue_id: ids.database, request_id: finding.request_id },
    };
    await o.invoke("abra_work_message", request);
    await o.invoke("abra_work_message", request);
    const sent = await o.invoke("abra_work_messages", { issue_id: ids.authentication });
    const intent = sent.entries.find((m: any) => m.record.request_id === request.request_id).record;
    assert.equal(intent.recipient_session_id, applying.execution.apply_session_id);
    o.release("auth-apply");
    const done = await o.eventually(async () => {
      const s = await status("authentication");
      if (["failed", "blocked", "recovery_required"].includes(s.execution.current_phase))
        throw Object.assign(Error(JSON.stringify(s)), { terminal: true });
      return s.issue.status === "closed" ? s : undefined;
    }, 60000);
    const messages = await o.invoke("abra_work_messages", { issue_id: ids.authentication });
    const acknowledged = messages.entries.find(
      (m: any) => m.record.request_id === request.request_id,
    ).record;
    assert.equal(acknowledged.status, "acknowledged");
    assert.equal(acknowledged.prompt_id, intent.prompt_id);
    assert.ok(
      done.execution.approval_receipts.some(
        (r: any) => r.kind === "plan" && r.fingerprint === plan.plan_fingerprint,
      ),
    );
    assert.ok(done.execution.review_receipt.passed);
    assert.notEqual(done.execution.apply_session_id, done.execution.review_session_id);
    assert.ok(done.execution.verification_receipt);
    assert.equal(done.execution.configuration_snapshot.workers.review.model.id, "gpt-fixture");
    assert.ok(done.execution.delivery_receipt);
    await assert.rejects(access(done.execution.worktree_directory));
    const repeated = await o.invoke("abra_work_create_batch", input);
    assert.deepEqual(
      repeated.tasks.map((t: any) => [t.client_key, t.issue.id]),
      batch.tasks.map((t: any) => [t.client_key, t.issue.id]),
    );
    const summary = await o.invoke("abra_work_list", {});
    for (const id of Object.values(ids))
      assert.equal(summary.issues.find((i: any) => i.id === id).status, "closed");
    let portable_artifact: string | undefined;
    if (process.env.ABRACODE_TEST_EVIDENCE_DIR) {
      const dir = resolve(process.env.ABRACODE_TEST_EVIDENCE_DIR);
      assert.ok(dir !== o.root && !dir.startsWith(o.root + "/"));
      await mkdir(dir, { recursive: true });
      portable_artifact = join(dir, `acceptance-architecture-${report.hash}.html`);
      await copyFile(report.path, portable_artifact);
    }
    return {
      feature: "final-product-acceptance",
      result: "pass",
      tasks: ids,
      capacity: 2,
      initial_sessions: originalSessions,
      human_plan_form: form.form_id,
      approved_plan: plan.plan_fingerprint,
      correlated_handoff: {
        request_id: request.request_id,
        prompt_id: intent.prompt_id,
        status: acknowledged.status,
      },
      visual_report: report,
      portable_artifact,
      independent_review: true,
      idle_observation: idleObservation,
      verified_branch_delivery: true,
      restart: true,
      judgment_limit:
        "Disposable sample consumer behavior proves orchestration mechanics; no real authentication refactor or database performance claim.",
    };
  } finally {
    for (const key of ["auth-explore", "db-research", "auth-apply"]) o.release(key);
    await writeFile(join(o.home, "abracode.yaml"), initial);
    await o.restart();
  }
}
