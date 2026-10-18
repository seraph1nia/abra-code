import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { repo } from "../fixtures.ts";
import { run } from "../effects.ts";

/** Actual native commits with their controller receipts held until service loss. */
export async function communicationCrashJourney(o: {
  root: string;
  evidence: string;
  client: any;
  supervisor: string;
  invoke: (tool: string, args: unknown) => Promise<any>;
  eventually: <T>(action: () => Promise<T | undefined>, timeout?: number) => Promise<T>;
  restart: () => Promise<void>;
  holdExplore: () => void;
  held: () => boolean;
  releaseExplore: () => void;
  observe: (value: unknown) => void;
}) {
  const path = await run(repo(o.root, "crash-window-base"));
  await o.invoke("abra_project_onboard", {
    action: "register",
    id: "crash-window",
    path,
    verification: [
      [
        process.execPath,
        "-e",
        'const fs=require("fs");if(fs.readFileSync("source.txt","utf8")!=="sample\\n")process.exit(1)',
      ],
    ],
    plan_approval: true,
    merge_approval: true,
    delivery: "branch",
    diagnostic_turns: 0,
    max_executions: 2,
    max_workers: 1,
  });
  const outcomes = [];
  for (const point of ["before-admission", "after-admission"]) {
    const issue = (
      await o.invoke("abra_work_create", {
        repository_id: "crash-window",
        request_id: `crash-${point}`,
        title: `Native ${point} window`,
        description: "Prepare the ordinary sample plan within accepted scope",
        workflow_policy: "full-openspec",
      })
    ).issue;
    const status = () => o.invoke("abra_work_status", { issue_id: issue.id });
    o.holdExplore();
    let flight: Promise<unknown> | undefined;
    let transportLost = false;
    try {
      const e = await o.invoke("abra_work_start", { issue_id: issue.id });
      await o.eventually(async () => (o.held() ? true : undefined));
      const request = {
        issue_id: issue.id,
        request_id: `operational-${point}`,
        role: "explore",
        response: "answer",
        body: `operational-${point}: answer this retained request without repeating the task.`,
      };
      flight = o.invoke("abra_work_message", request).catch(() => {
        transportLost = true;
      });
      const trip = await o.eventually(async () =>
        JSON.parse(await readFile(join(o.evidence, `fault-${point}.json`), "utf8")),
      );
      const retained = (await status()).execution.messages.find(
        (m: any) => m.request_id === request.request_id,
      );
      assert.equal(retained.status, "admission_uncertain");
      assert.equal(retained.prompt_id, trip.prompt_id);
      const queued = await o.client.session.inbox.list({ sessionID: e.explore_session_id });
      assert.equal(
        queued.filter((m: any) => m.id === retained.prompt_id).length,
        point === "after-admission" ? 1 : 0,
      );
      o.releaseExplore();
      await o.restart();
      await flight;
      assert.equal(transportLost, true);
      const reconciled = await o.eventually(async () => {
        const current = (await status()).execution.messages.find(
          (m: any) => m.request_id === request.request_id,
        );
        return point === "before-admission"
          ? current
          : current?.status === "answered"
            ? current
            : undefined;
      }, 45000);
      assert.equal(reconciled.prompt_id, retained.prompt_id);
      if (point === "before-admission") {
        assert.equal(reconciled.status, "admission_uncertain");
        assert.equal(reconciled.response_recovery, undefined);
        await o.invoke("abra_work_message", request);
      } else assert.ok(reconciled.reply);
      const context = await o.client.session.context({ sessionID: e.explore_session_id });
      const inputs = context.filter(
        (m: any) => m.type === "user" && m.id === retained.prompt_id,
      ).length;
      assert.equal(inputs, point === "after-admission" ? 1 : 0);
      await o.invoke("abra_work_control", { issue_id: issue.id, action: "pause" });
      const stopped = await o.eventually(async () =>
        (await status()).execution.stop_status === "confirmed"
          ? (await status()).execution
          : undefined,
      );
      const historical = stopped.messages.find((m: any) => m.request_id === request.request_id);
      assert.equal(historical.prompt_id, retained.prompt_id);
      if (point === "after-admission") assert.deepEqual(historical.reply, reconciled.reply);
      else assert.equal(historical.status, "superseded");
      outcomes.push({
        point,
        issue_id: issue.id,
        prompt_id: retained.prompt_id,
        original_inputs: inputs,
        transport_response_lost: transportLost,
        no_replacement_identity: true,
        stop_confirmed: true,
      });
      o.observe({ communication_crash_point: outcomes.at(-1) });
    } finally {
      o.releaseExplore();
    }
  }
  // A distinct no-execution source has one captured management turn available.
  const leadPath = await run(repo(o.root, "crash-notice-source"));
  await o.invoke("abra_project_onboard", {
    action: "register",
    id: "crash-notice-source",
    path: leadPath,
    verification: [],
    diagnostic_turns: 1,
    plan_approval: false,
    merge_approval: false,
    delivery: "branch",
  });
  const scoped = await o.invoke("abra_lead_control", {
    action: "register",
    id: "crash-notice-lead",
    expected_revision: 0,
    repositories: ["crash-notice-source"],
    model: { providerID: "fixture", id: "gpt-specialist" },
    enabled: true,
  });
  const lead = scoped;
  const source = (
    await o.invoke("abra_work_create", {
      repository_id: "crash-notice-source",
      request_id: "crash-notice-source",
      title: "Retain lead notice",
      description: "Inspect scoped retained evidence",
      workflow_policy: "research-only",
      scope: { goal: "Read source", acceptance: ["Retain evidence"], constraints: ["Read only"] },
    })
  ).issue;
  await o.invoke("abra_lead_control", {
    action: "message",
    id: lead.id,
    revision: scoped.revision,
    issue_id: source.id,
    request_id: "operational-lead-notice",
    body: "Inspect and reply with scoped evidence",
  });
  const trip = await o.eventually(async () =>
    JSON.parse(await readFile(join(o.evidence, "fault-lead-notice.json"), "utf8")),
  );
  const row = (await o.invoke("abra_lead_control", { action: "status", id: lead.id }))[0];
  const reply = row.requests.find((r: any) => r.request.request_id === "operational-lead-notice");
  assert.equal(reply.request.status, "answered");
  assert.equal(reply.notice_id, trip.prompt_id);
  assert.notEqual(reply.notified, true);
  await o.restart();
  const notified = await o.eventually(async () => {
    const row = (await o.invoke("abra_lead_control", { action: "status", id: lead.id }))[0];
    return row.requests.find(
      (r: any) => r.request.request_id === "operational-lead-notice" && r.notified,
    );
  });
  assert.deepEqual(notified.request.reply, reply.request.reply);
  assert.equal(notified.notice_id, trip.prompt_id);
  assert.equal(
    (await o.client.session.context({ sessionID: o.supervisor })).filter(
      (m: any) => m.id === trip.prompt_id,
    ).length,
    1,
  );
  await o.invoke("abra_lead_control", {
    action: "register",
    id: lead.id,
    expected_revision: scoped.revision,
    repositories: scoped.repositories,
    model: scoped.model,
    enabled: false,
  });
  const eventIssue = (
    await o.invoke("abra_work_create", {
      repository_id: "crash-notice-source",
      request_id: "operational-event-loss",
      title: "Complete with dropped native events",
      description: "Read source and retain evidence while completion events are unavailable",
      workflow_policy: "research-only",
      scope: {
        goal: "Read source",
        acceptance: ["Identify the source behavior"],
        constraints: ["Read only"],
      },
    })
  ).issue;
  await o.invoke("abra_work_start", { issue_id: eventIssue.id });
  const completed = await o
    .eventually(async () => {
      const s = await o.invoke("abra_work_status", { issue_id: eventIssue.id });
      return s.issue.status === "closed" ? s.execution : undefined;
    }, 45000)
    .catch(async (error) => {
      const s = await o.invoke("abra_work_status", { issue_id: eventIssue.id });
      o.observe({
        event_fault_failure: {
          issue_id: eventIssue.id,
          phase: s.execution.current_phase,
          active_role: s.execution.active_role,
          decisions: s.execution.decisions?.map((d: any) => ({
            key: d.key,
            owner: d.owner,
            status: d.status,
          })),
          stop_status: s.execution.stop_status,
          worker_failure_type: s.execution.worker_failure?.error?.type,
        },
      });
      throw error;
    });
  assert.equal(completed.current_phase, "completed");
  assert.ok(completed.report_receipt);
  await o.restart();
  const eventCounts = (await readFile(join(o.evidence, "fault-events.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const injected = eventCounts.reduce(
    (total, item) => ({
      dropped: total.dropped + item.dropped_completions,
      duplicated: total.duplicated + item.duplicated_tools,
      reordered: total.reordered + item.reordered_tools,
    }),
    { dropped: 0, duplicated: 0, reordered: 0 },
  );
  assert.ok(injected.dropped > 0 && injected.duplicated > 0 && injected.reordered > 0);
  let reportResponseLost = false;
  const building = o
    .invoke("abra_work_report", {
      issue_id: eventIssue.id,
      action: "generate",
      request_id: "operational-report-publication",
    })
    .catch(() => {
      reportResponseLost = true;
    });
  const linked = await o.eventually(
    async () =>
      JSON.parse(await readFile(join(o.evidence, "fault-report-publication.json"), "utf8")),
    90000,
  );
  assert.equal(
    createHash("sha256")
      .update(await readFile(linked.path))
      .digest("hex"),
    linked.hash,
  );
  await o.restart();
  await building;
  assert.equal(reportResponseLost, true);
  const report = await o.eventually(async () => {
    const rows = await o.invoke("abra_work_report", {
      issue_id: eventIssue.id,
      action: "artifacts",
    });
    return rows.find(
      (b: any) =>
        b.request.request_id === "operational-report-publication" && b.status === "published",
    );
  }, 90000);
  assert.equal(report.artifact.hash, linked.hash);
  assert.equal(report.artifact.path, linked.path);
  assert.equal(
    (await readFile(join(o.evidence, "report-builds.jsonl"), "utf8")).trim().split("\n").length,
    1,
  );
  const retry = await o.invoke("abra_work_report", {
    issue_id: eventIssue.id,
    action: "generate",
    request_id: "operational-report-publication",
  });
  assert.deepEqual(retry, report);
  return {
    communication_crash_windows: "pass",
    workers: outcomes,
    lead_notice: {
      request_id: "operational-lead-notice",
      notice_id: trip.prompt_id,
      native_notices: 1,
      accepted_reply_preserved: true,
    },
    event_faults: {
      issue_id: eventIssue.id,
      ...injected,
      verified_completion: true,
      report_retained: true,
    },
    report_publication: {
      request_id: "operational-report-publication",
      hash: linked.hash,
      render_attempts: 1,
      response_lost: true,
      identical_artifact_after_restart: true,
    },
    limitation:
      "Four specific commit windows plus completion-event loss; delivery/cleanup uses its separately mapped full journey",
  };
}
