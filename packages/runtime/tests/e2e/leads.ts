import * as Id from "../../src/identities.ts";
import type {
  LeadEvidenceQuery,
  LeadEvidencePageSchema,
} from "../../src/visibility/lead-observation.ts";
import assert from "node:assert/strict";
import { repo } from "../fixtures.ts";
import { run } from "../effects.ts";
import { type WorkSnapshot } from "../../src/visibility/protocol.ts";

export async function leadJourney(o: {
  root: string;
  home: string;
  client: any;
  supervisor: string;
  invoke: (tool: string, args: unknown) => Promise<any>;
  leadTool: (session: string, tool: string, args: unknown) => Promise<any>;
  eventually: <T>(action: () => Promise<T | undefined>, timeout?: number) => Promise<T>;
  restart: () => Promise<void>;
  holdResearch: () => void;
  held: () => boolean;
  releaseResearch: () => void;
  observe: (value: unknown) => void;
  snapshot: () => Promise<WorkSnapshot>;
  leadEvidence: (
    query: typeof LeadEvidenceQuery.Type,
  ) => Promise<typeof LeadEvidencePageSchema.Type>;
}) {
  const path = await run(repo(o.root, "lead-base"));
  await o.invoke("abra_project_onboard", {
    id: "lead-project",
    path,
    action: "register",
    plan_approval: false,
    merge_approval: false,
    verification: [],
    delivery: "branch",
    // Intake, decision routing and completion reporting consume three lead
    // turns; concurrent central attention shares this same finite allowance.
    diagnostic_turns: 5,
  });
  const issue = (
    await o.invoke("abra_work_create", {
      repository_id: "lead-project",
      request_id: "lead-native-source",
      title: "Database research",
      description: "lead-blocker-investigation: investigate current source",
      workflow_policy: "research-only",
      scope: {
        goal: "Understand source",
        acceptance: ["Identify the source behavior"],
        constraints: ["Read only"],
      },
    })
  ).issue;
  const privatePath = await run(repo(o.root, "lead-private-base"));
  await o.invoke("abra_project_onboard", {
    id: "lead-private",
    path: privatePath,
    action: "register",
    verification: [],
    plan_approval: false,
    merge_approval: false,
    delivery: "branch",
    diagnostic_turns: 0,
  });
  const privateIssue = (
    await o.invoke("abra_work_create", {
      repository_id: "lead-private",
      request_id: "lead-private-source",
      title: "Private project",
      description: "Private out-of-scope project details",
      workflow_policy: "research-only",
      scope: {
        goal: "Understand source",
        acceptance: ["Identify the source behavior"],
        constraints: ["Read only"],
      },
    })
  ).issue;
  const definition = {
    action: "register",
    id: "native-project",
    expected_revision: 0,
    repositories: ["lead-project"],
    model: { providerID: "fixture", id: "gpt-specialist" },
    enabled: true,
  };
  const lead = await o.invoke("abra_lead_control", definition);
  assert.equal(lead.provisioned, true);
  assert.equal(lead.revision, 1);
  const visible = (await o.snapshot()).leads!.find((l) => l.id === lead.id)!;
  assert.equal(visible.enabled, true);
  assert.equal(visible.session_available, true);
  assert.deepEqual(visible.repositories, ["lead-project"]);
  assert.deepEqual(visible.assigned_work, [issue.id]);
  assert.equal((await o.invoke("abra_lead_control", definition)).session_id, lead.session_id);
  const actual = await o.client.session.get({ sessionID: lead.session_id });
  assert.equal(actual.agent, "project-lead");
  assert.equal(actual.location.directory, o.home);
  assert.equal(actual.parentID, o.supervisor);
  assert.equal(actual.model.id, "gpt-specialist");
  assert.deepEqual(
    actual.permissions.map((p: any) => [p.action, p.effect]),
    [
      ["*", "deny"],
      ["abra_lead_action", "allow"],
    ],
  );
  await assert.rejects(
    o.client.session.prompt({
      sessionID: lead.session_id,
      text: "Unauthorized management prompt",
      delivery: "steer",
      metadata: { source: "abracode" },
    }),
  );
  for (const tool of [
    "abra_work_list",
    "abra_work_control",
    "abra_work_finish",
    "abra_lead_control",
    "abra_config",
  ])
    await assert.rejects(o.leadTool(lead.session_id, tool, {}));
  await assert.rejects(
    o.leadTool(lead.session_id, "abra_lead_action", {
      action: "status",
      revision: 1,
      issue_id: "issue-does-not-exist",
    }),
  );
  await assert.rejects(
    o.leadTool(lead.session_id, "abra_lead_action", {
      action: "status",
      revision: 1,
      issue_id: privateIssue.id,
    }),
    (error: any) => error.data?.code === "LEAD_SCOPE",
  );
  const scoped = await o.leadTool(lead.session_id, "abra_lead_action", {
    action: "status",
    revision: 1,
  });
  assert.ok(!JSON.stringify(scoped).includes("Private out-of-scope"));
  await o.invoke("abra_work_start", { issue_id: privateIssue.id });
  await o.eventually(async () =>
    (await o.invoke("abra_work_status", { issue_id: privateIssue.id })).execution.current_phase ===
    "completed"
      ? true
      : undefined,
  );
  const request = {
    action: "message",
    id: lead.id,
    revision: 1,
    issue_id: issue.id,
    request_id: "native-lead-request",
    body: "lead-native-acceptance: inspect this project and propose a read-only investigation",
  };
  try {
    await o.invoke("abra_lead_control", request);
  } catch (error) {
    // Keep only controller identities/dispositions, never prompts or provider bodies.
    const fleet = await o.invoke("abra_work_list", {});
    o.observe({
      lead_admission_failed: request.request_id,
      occupied_incidents: fleet.executions.flatMap((e: any) =>
        (e.attention ?? [])
          .filter((a: any) => ["uncertain", "admitted"].includes(a.status))
          .map((a: any) => ({
            issue_id: e.issue_id,
            phase: e.current_phase,
            current_generation: e.control_generation,
            id: a.id,
            generation: a.generation,
            code: a.code,
            status: a.status,
            created_at: a.created_at,
            prompt_id: a.prompt_id,
            session_id: a.session_id,
          })),
      ),
    });
    throw error;
  }
  const status = () =>
    o.invoke("abra_lead_control", { action: "status", id: lead.id }).then((rows: any[]) => rows[0]);
  const answered = await o.eventually(async () => {
    const current = await status();
    return current.requests[0]?.request.status === "answered" && current.proposals.length === 1
      ? current
      : undefined;
  });
  assert.equal(
    answered.requests[0].request.reply.body,
    "Native project-lead correlated findings retained.",
  );
  assert.equal(
    (await o.invoke("abra_work_list", {})).issues.filter(
      (w: any) => w.repository_id === "lead-project",
    ).length,
    1,
  );
  const projection = () =>
    o.leadEvidence({ issue_id: Id.IssueId.make(issue.id), lead_id: Id.LeadId.make(lead.id) });
  const leadInputs = (await o.client.session.context({ sessionID: lead.session_id })).filter(
    (message: any) => message.type === "user",
  ).length;
  const projected = await projection();
  assert.equal(projected.detail?.proposals[0]?.accepted, false);
  assert.equal(
    projected.detail?.requests[0]?.reply?.body,
    "Native project-lead correlated findings retained.",
  );
  assert.ok(
    (await o.snapshot()).management?.entries.some(
      (entry) => entry.lead_id === lead.id && entry.proposals > 0,
    ),
  );
  await assert.rejects(
    o.leadEvidence({
      issue_id: Id.IssueId.make(privateIssue.id),
      lead_id: Id.LeadId.make(lead.id),
    }),
  );
  assert.equal(
    (await o.client.session.context({ sessionID: lead.session_id })).filter(
      (message: any) => message.type === "user",
    ).length,
    leadInputs,
  );
  await o.restart();
  const retained = await status();
  assert.deepEqual((await projection()).detail?.proposals, projected.detail?.proposals);
  assert.equal(retained.session_id, lead.session_id);
  assert.equal(retained.requests[0].request.prompt_id, answered.requests[0].request.prompt_id);
  assert.deepEqual(retained.proposals, answered.proposals);
  await o.invoke("abra_lead_control", request);
  const context = await o.client.session.context({ sessionID: lead.session_id });
  assert.equal(
    context.filter((m: any) => m.id === answered.requests[0].request.prompt_id).length,
    1,
  );
  const used = context
    .filter((m: any) => m.type === "assistant")
    .flatMap((m: any) => m.content ?? [])
    .filter((p: any) => p.type === "tool");
  // The actual model turn must have used the scoped controller endpoint.
  assert.ok(JSON.stringify(context).includes("abra_lead_action"));
  const accepted = await o.invoke("abra_lead_control", {
    action: "accept",
    id: lead.id,
    revision: 1,
    request_id: "native-lead-proposal",
  });
  assert.equal(accepted.accepted.tasks.length, 1);
  assert.deepEqual(
    await o.invoke("abra_lead_control", {
      action: "accept",
      id: lead.id,
      revision: 1,
      request_id: "native-lead-proposal",
    }),
    accepted,
  );
  // An answered request can precede native idle and release of its management
  // slot. Start the routing assertion only after earlier attention has settled.
  await o.eventually(async () => {
    const current = await status();
    const fleet = await o.invoke("abra_work_list", {});
    const occupied = fleet.executions.some((e: any) =>
      (e.attention ?? []).some((a: any) => ["uncertain", "admitted"].includes(a.status)),
    );
    return !current.active && !occupied ? true : undefined;
  });
  o.holdResearch();
  const started = await o.invoke("abra_work_start", { issue_id: issue.id });
  await o.eventually(async () => (o.held() ? true : undefined));
  await o.leadTool(started.research_session_id, "abra_worker_question", {
    key: "native-lead-decision",
    generation: started.control_generation,
    owner: "supervisor",
    scope: "Existing accepted source investigation",
    question: "Which retained scope should guide this investigation?",
  });
  const decisionAnswer = await o
    .eventually(async () => {
      const decision = (
        await o.invoke("abra_work_status", { issue_id: issue.id })
      ).execution.decisions?.find(
        (d: any) => d.key === "native-lead-decision" && d.status === "answered",
      );
      return decision ?? undefined;
    })
    .catch(async (error) => {
      const current = await status();
      const execution = (await o.invoke("abra_work_status", { issue_id: issue.id })).execution;
      const fleet = await o.invoke("abra_work_list", {});
      const context = await o.client.session.context({ sessionID: lead.session_id });
      o.observe({
        lead_decision_timeout: execution.decisions,
        lead_active: current.active,
        root_attention_turns: execution.attention_turns,
        occupied_attention: fleet.executions.flatMap((e: any) =>
          (e.attention ?? [])
            .filter((a: any) => ["uncertain", "admitted"].includes(a.status))
            .map((a: any) => ({
              issue_id: e.issue_id,
              status: a.status,
              code: a.code,
              generation: a.generation,
            })),
        ),
        lead_requests: current.requests.slice(-12),
        lead_tools: context
          .flatMap((m: any) =>
            m.type === "assistant"
              ? m.content
                  .filter((p: any) => p.type === "tool")
                  .map((p: any) => ({
                    name: p.name,
                    status: p.state.status,
                    error: p.state.error,
                  }))
              : [],
          )
          .slice(-12),
      });
      throw error;
    });
  assert.equal(
    decisionAnswer.answer,
    "Use the existing retained read-only source scope; no additional changes are authorized.",
  );
  assert.ok((await status()).requests.some((r: any) => r.request.body.includes("decision:")));
  o.releaseResearch();
  await o.eventually(async () =>
    (await o.invoke("abra_work_status", { issue_id: issue.id })).execution.current_phase ===
    "completed"
      ? true
      : undefined,
  );
  await o
    .eventually(async () =>
      (await status()).requests.some(
        (r: any) => r.request.body.includes("completed") && r.request.status === "answered",
      )
        ? true
        : undefined,
    )
    .catch(async (error) => {
      const current = await status();
      const execution = (await o.invoke("abra_work_status", { issue_id: issue.id })).execution;
      o.observe({
        lead_completion_timeout: {
          active: current.active,
          root_turns: execution.attention_turns,
          budget: execution.effective_policy.diagnostic_turns,
          requests: current.requests.map((r: any) => ({
            issue_id: r.issue_id,
            status: r.request.status,
            recovery: r.request.response_recovery?.status,
          })),
        },
      });
      throw error;
    });
  const routed = await status();
  const completed = (await o.invoke("abra_work_status", { issue_id: issue.id })).execution;
  const leadTurns = routed.requests
    .filter((r: any) => r.issue_id === issue.id)
    .reduce((total: number, r: any) => total + 1 + (r.request.response_recovery ? 1 : 0), 0);
  const managementTurns = leadTurns + (completed.attention_turns ?? 0);
  assert.ok(leadTurns >= 3);
  assert.ok(managementTurns <= completed.effective_policy.diagnostic_turns);
  o.observe({
    lead_routing_turns: leadTurns,
    shared_management_turns: managementTurns,
    finite_budget: completed.effective_policy.diagnostic_turns,
  });
  assert.ok(used.length >= 3);
  assert.ok(used.every((p: any) => p.name === "abra_lead_action"));
  const parentContext = await o.client.session.context({ sessionID: o.supervisor });
  assert.ok(
    parentContext.some(
      (m: any) => m.type === "synthetic" && m.text.includes("native-lead-request"),
    ),
  );
  const proposedIssue = accepted.accepted.tasks[0].issue;
  await o.invoke("abra_work_start", { issue_id: proposedIssue.id });
  await o.eventually(async () =>
    (await o.invoke("abra_work_status", { issue_id: proposedIssue.id })).execution.current_phase ===
    "completed"
      ? true
      : undefined,
  );
  const disabled = await o.invoke("abra_lead_control", {
    ...definition,
    expected_revision: 1,
    enabled: false,
  });
  assert.equal(disabled.stop_pending, false);
  assert.equal(disabled.active, false);
  await assert.rejects(
    o.leadTool(lead.session_id, "abra_lead_action", {
      action: "status",
      revision: disabled.revision,
    }),
  );
  const newLead = await o.invoke("abra_lead_control", {
    ...definition,
    expected_revision: disabled.revision,
    model: { providerID: "fixture", id: "gpt-fixture" },
  });
  assert.notEqual(newLead.session_id, lead.session_id);
  assert.ok(newLead.retired_sessions.includes(lead.session_id));
  await assert.rejects(
    o.leadTool(lead.session_id, "abra_lead_action", {
      action: "status",
      revision: newLead.revision,
    }),
  );
  await o.invoke("abra_lead_control", {
    ...definition,
    expected_revision: newLead.revision,
    enabled: false,
    model: { providerID: "fixture", id: "gpt-fixture" },
  });
  const disabledProjection = (await o.snapshot()).leads!.find((l) => l.id === lead.id)!;
  assert.equal(disabledProjection.state, "disabled");
  assert.equal(disabledProjection.enabled, false);
  assert.ok(disabledProjection.latest_outcome);
  const disabledEvidence = await projection();
  assert.equal(disabledEvidence.entries[0]?.enabled, false);
  assert.ok(disabledEvidence.detail?.requests.some((request) => request.reply));
  assert.ok(disabledEvidence.detail?.proposals.some((proposal) => proposal.accepted));
  o.observe({
    browser_lead_evidence: {
      source_issue: issue.id,
      observed_requests: disabledEvidence.detail?.request_total,
      proposals: disabledEvidence.detail?.proposal_total,
      state: disabledEvidence.entries[0]?.state,
      read_after_restart: true,
      foreign_scope_refused: true,
    },
  });

  return {
    feature: "persistent-project-leads",
    result: "pass",
    source_issue: issue.id,
    original_session: lead.session_id,
    replacement_session: newLead.session_id,
    correlated_prompt: answered.requests[0].request.prompt_id,
    retained_proposal: accepted.accepted.request_id,
    actual_controller_calls: used.length,
    restart: true,
    approvals_unchanged: true,
  };
}
