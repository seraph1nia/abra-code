import assert from "node:assert/strict";
import { repo } from "../fixtures.ts";
import { run } from "../effects.ts";

/** A real native omission, one successful reminder and one escalation on the same assignment. */
export async function replyRecoveryJourney(o: {
  root: string;
  supervisor: string;
  client: any;
  invoke: (tool: string, args: unknown) => Promise<any>;
  eventually: <T>(action: () => Promise<T | undefined>, timeout?: number) => Promise<T>;
  holdExplore: () => void;
  held: () => boolean;
  releaseExplore: () => void;
  restart: () => Promise<void>;
  observe: (value: unknown) => void;
}) {
  const path = await run(repo(o.root, "reply-recovery-base"));
  await o.invoke("abra_project_onboard", {
    id: "reply-recovery",
    path,
    action: "register",
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
    diagnostic_turns: 2,
  });
  const issue = (
    await o.invoke("abra_work_create", {
      repository_id: "reply-recovery",
      request_id: "native-reply-recovery-task",
      title: "Verify omitted correlated responses",
      description:
        "native-reply-recovery: prepare the ordinary sample plan within its assigned scope",
      workflow_policy: "full-openspec",
    })
  ).issue;
  const status = () => o.invoke("abra_work_status", { issue_id: issue.id });
  o.holdExplore();
  let execution: any;
  try {
    execution = await o.invoke("abra_work_start", { issue_id: issue.id });
    await o.eventually(async () => (o.held() ? true : undefined));
    for (const [id, response] of [
      ["native-recovery-answer", "answer"],
      ["native-recovery-escalation", "acknowledgement"],
    ])
      await o.invoke("abra_work_message", {
        issue_id: issue.id,
        request_id: id,
        role: "explore",
        kind: "question",
        response,
        body: "Reply to the retained request without repeating or broadening the assigned task.",
      });
  } finally {
    o.releaseExplore();
  }
  const observed = await o
    .eventually(async () => {
      const s = await status();
      const answered = s.execution.messages.find(
        (m: any) => m.request_id === "native-recovery-answer",
      );
      const missing = s.execution.messages.find(
        (m: any) => m.request_id === "native-recovery-escalation",
      );
      const incident = s.execution.attention?.find(
        (a: any) =>
          a.code === "message_pending" &&
          a.message_refs?.some((r: any) => r.request_id === missing?.request_id),
      );
      return answered?.status === "answered" &&
        answered.response_recovery?.status === "admitted" &&
        missing?.response_recovery?.status === "admitted" &&
        incident?.evidence.includes("automatic attempt exhausted")
        ? { s, answered, missing, incident }
        : undefined;
    }, 90000)
    .catch(async (error) => {
      const s = await status();
      const context = await o.client.session.context({ sessionID: execution.explore_session_id });
      o.observe({
        reply_recovery: "failed",
        phase: s.execution.current_phase,
        attention_turns: s.execution.attention_turns,
        messages: s.execution.messages.map((m: any) => ({
          request_id: m.request_id,
          status: m.status,
          prompt_id: m.prompt_id,
          recovery: m.response_recovery && {
            prompt_id: m.response_recovery.prompt_id,
            status: m.response_recovery.status,
          },
        })),
        attention: s.execution.attention?.map((a: any) => ({
          id: a.id,
          code: a.code,
          status: a.status,
          evidence: a.evidence,
          refs: a.message_refs,
        })),
        native_context: context
          .filter((m: any) => ["user", "idle", "assistant"].includes(m.type))
          .map((m: any) => ({
            id: m.id,
            type: m.type,
            ...(m.type === "idle" ? { outcome: m.outcome } : {}),
            time: m.time,
          })),
      });
      throw error;
    });
  assert.equal(observed.missing.reply, undefined);
  assert.equal(observed.s.execution.current_phase, "exploring");
  assert.equal(observed.s.execution.attention_turns, 2);
  assert.deepEqual(observed.s.execution.approval_receipts, []);
  const identities = [observed.answered, observed.missing].map((m) => ({
    request_id: m.request_id,
    prompt_id: m.prompt_id,
    reminder: m.response_recovery.prompt_id,
  }));
  const counts = async () => {
    const messages = await o.client.session.context({ sessionID: execution.explore_session_id });
    return identities.map((m) => ({
      request_id: m.request_id,
      original: messages.filter((n: any) => n.type === "user" && n.id === m.prompt_id).length,
      reminder: messages.filter((n: any) => n.type === "user" && n.id === m.reminder).length,
    }));
  };
  assert.deepEqual(
    await counts(),
    identities.map((m) => ({ request_id: m.request_id, original: 1, reminder: 1 })),
  );
  await o.restart();
  const after = await status();
  for (const identity of identities) {
    const m = after.execution.messages.find((m: any) => m.request_id === identity.request_id);
    assert.equal(m.prompt_id, identity.prompt_id);
    assert.equal(m.response_recovery.prompt_id, identity.reminder);
  }
  assert.equal(
    after.execution.messages.find((m: any) => m.request_id === "native-recovery-answer").status,
    "answered",
  );
  assert.equal(
    after.execution.attention.find((a: any) => a.id === observed.incident.id).id,
    observed.incident.id,
  );
  assert.deepEqual(
    await counts(),
    identities.map((m) => ({ request_id: m.request_id, original: 1, reminder: 1 })),
  );
  await o.invoke("abra_work_control", { issue_id: issue.id, action: "pause" });
  const paused = await o.eventually(async () => {
    const current = (await status()).execution;
    return current.stop_status === "confirmed" ? current : undefined;
  });
  assert.equal(paused.stop_status, "confirmed");
  assert.equal(
    paused.messages.find((m: any) => m.request_id === "native-recovery-escalation").status,
    "superseded",
  );
  assert.equal(
    (await o.client.session.inbox.list({ sessionID: execution.explore_session_id })).length,
    0,
  );
  assert.equal((await o.client.session.active())[execution.explore_session_id], undefined);
  const source = (
    await o.invoke("abra_work_create", {
      repository_id: "reply-recovery",
      request_id: "native-lead-recovery-source",
      title: "Inspect scoped evidence",
      description: "Lead request source with no execution",
      workflow_policy: "research-only",
      scope: {
        goal: "Inspect source",
        acceptance: ["Retain evidence"],
        constraints: ["Read only"],
      },
    })
  ).issue;
  const definition = {
    action: "register",
    id: "reply-recovery-lead",
    expected_revision: 0,
    repositories: ["reply-recovery"],
    model: { providerID: "fixture", id: "gpt-specialist" },
    enabled: true,
  };
  const lead = await o.invoke("abra_lead_control", definition);
  await o.invoke("abra_lead_control", {
    action: "message",
    id: lead.id,
    revision: lead.revision,
    issue_id: source.id,
    request_id: "native-lead-recovery-answer",
    body: "Inspect the scoped retained evidence and reply without creating work.",
  });
  const leadStatus = () =>
    o.invoke("abra_lead_control", { action: "status", id: lead.id }).then((rows) => rows[0]);
  const leadAnswer = await o.eventually(async () => {
    const row = await leadStatus();
    const request = row.requests[0]?.request;
    return request?.status === "answered" && request.response_recovery?.status === "admitted"
      ? row.requests[0]
      : undefined;
  }, 45000);
  assert.equal(leadAnswer.request.reply.body, "Native project-lead recovery answer retained.");
  await assert.rejects(o.invoke("abra_work_status", { issue_id: source.id }), /EXECUTION_MISSING/);
  await o.restart();
  const notifiedLead = await o.eventually(async () => {
    const row = await leadStatus();
    return row.requests[0]?.notified ? row.requests[0] : undefined;
  });
  assert.equal(
    notifiedLead.request.response_recovery.prompt_id,
    leadAnswer.request.response_recovery.prompt_id,
  );
  assert.equal(notifiedLead.request.reply.body, leadAnswer.request.reply.body);
  const leadMessages = await o.client.session.context({ sessionID: lead.session_id });
  const leadCounts = {
    original: leadMessages.filter(
      (m: any) => m.type === "user" && m.id === leadAnswer.request.prompt_id,
    ).length,
    reminder: leadMessages.filter(
      (m: any) => m.type === "user" && m.id === leadAnswer.request.response_recovery.prompt_id,
    ).length,
  };
  assert.deepEqual(leadCounts, { original: 1, reminder: 1 });
  assert.equal(
    (await o.client.session.context({ sessionID: o.supervisor })).filter(
      (m: any) => m.id === notifiedLead.notice_id,
    ).length,
    1,
  );
  await o.invoke("abra_lead_control", {
    ...definition,
    expected_revision: lead.revision,
    enabled: false,
  });
  assert.equal((await o.client.session.inbox.list({ sessionID: lead.session_id })).length, 0);
  return {
    reply_recovery: "pass",
    issue_id: issue.id,
    identities,
    native_instruction_counts: await counts(),
    attempts: 3,
    answered: 2,
    escalated: 1,
    escalation_id: observed.incident.id,
    restart_preserved: true,
    stop_confirmed: true,
    lead_recovery: {
      request_id: leadAnswer.request.request_id,
      prompt_id: leadAnswer.request.prompt_id,
      reminder: leadAnswer.request.response_recovery.prompt_id,
      native_instruction_counts: leadCounts,
      notice_id: notifiedLead.notice_id,
      source_execution_absent: true,
      disabled_after_reply: true,
    },
    limitation:
      "Deterministic loopback provider; task deliberately paused after communication assertions; fixture teardown owns retained resources.",
  };
}
