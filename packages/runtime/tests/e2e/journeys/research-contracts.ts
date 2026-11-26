import { parseDocument } from "yaml";
import { assertBrowserWorker } from "../browser.ts";
import * as Id from "@abracode/contracts/identities";
import { run } from "../../effects.ts";
import assert from "node:assert/strict";
import { writeFile, readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { repo } from "../../fixtures.ts";
import { type Issue } from "../../../src/domain.ts";
import { type NativeHarness } from "../native-harness.ts";
import { eventually } from "../native-timing.ts";
import { type CompanionJourneys } from "./companions.ts";
export async function runResearchContracts(
  h: NativeHarness,
  companions: CompanionJourneys,
  previous?: { issue: Issue; configDigest: string },
) {
  const personalPath = join(h.home, "abracode.yaml");
  const {
    root,
    git,
    engineeringEvidence,
    home,
    client,
    loc,
    observer,
    atPhase,
    supervisor,
    invoke,
    restart,
  } = h;
  const { controls } = h.mock;
  const { runParallel, runReports, runLeads, runModels } = companions;
  const researchPath = await run(repo(root, "research-base"));
  await run(git.run(Id.AbsolutePath.make(researchPath), ["rm", "-r", "openspec"]));
  await run(
    git.run(Id.AbsolutePath.make(researchPath), [
      "commit",
      "-m",
      "Research repository without OpenSpec",
    ]),
  );
  await run(git.run(Id.AbsolutePath.make(researchPath), ["push", "origin", "main"]));
  const researchProject = await invoke("abra_project_onboard", {
    id: "research",
    path: researchPath,
    action: "register",
    verification: [],
    plan_approval: false,
    merge_approval: false,
    delivery: "branch",
  });
  assert.equal(researchProject.project.openspec, false);
  const researchIssue = (
    await invoke("abra_work_create", {
      repository_id: "research",
      title: "Research source behavior",
      description: "Read only investigation. browser-acceptance",
      workflow_policy: "research-only",
      scope: {
        goal: "Understand source",
        acceptance: ["Identify the source behavior"],
        constraints: ["Read only"],
      },
      request_id: "native-research",
    })
  ).issue;
  const researchStart = await invoke("abra_work_start", { issue_id: researchIssue.id });
  const researchDone = await eventually(async () => {
    if (!(await atPhase(researchIssue.id, "completed"))) return undefined;
    const status = await invoke("abra_work_status", { issue_id: researchIssue.id });
    if (["blocked", "failed", "recovery_required"].includes(status.execution.current_phase)) {
      const messages = await client.session.context({
        sessionID: status.execution.research_session_id,
      });
      const output = messages.flatMap((m: any) =>
        m.type === "assistant"
          ? m.content
              .filter((p: any) => p.type === "tool" && p.name === "abra_research_report")
              .map((p: any) => p.state.content ?? p.state.error)
          : [],
      );
      throw Object.assign(
        new Error(
          `${status.execution.error_or_recovery_reason}; report submission: ${JSON.stringify(output)}`,
        ),
        { terminal: true },
      );
    }
    return status.execution.current_phase === "completed" ? status.execution : undefined;
  });
  await assertBrowserWorker(client, home, researchDone.research_session_id);
  assert.equal(researchDone.delivery_receipt, undefined);
  assert.equal(researchDone.pull_request_reference, undefined);
  assert.ok(researchDone.report_receipt);
  assert.equal(researchDone.research_session_id, researchStart.research_session_id);
  assert.equal(researchDone.configuration_snapshot.workers.research.model.variant, "default");
  if (previous) assert.notEqual(researchDone.configuration_snapshot.digest, previous.configDigest);
  const researchTools = await invoke("abra_work_diagnostics", {
    issue_id: researchIssue.id,
    role: "research",
  });
  for (const forbidden of ["patch", "write", "edit", "bash", "abra_work_finish"])
    assert.ok(!researchTools.sessions[0].available_tools.names.includes(forbidden));
  assert.match(
    (await observer.report({ issue_id: researchIssue.id }, loc)).content,
    /Research kept/,
  );
  assert.match(
    (await observer.report({ issue_id: researchIssue.id }, loc)).content,
    /scratch evidence, not durable report attachments/,
  );
  assert.equal(await readFile(join(researchPath, "source.txt"), "utf8"), "original\n");
  await invoke("abra_project_onboard", {
    id: "research",
    path: researchPath,
    action: "register",
    repair_rounds: 1,
    verification: [
      [
        "node",
        "-e",
        "if(!require('fs').readFileSync('source.txt','utf8').startsWith('sample'))process.exit(1)",
      ],
    ],
    plan_approval: false,
    merge_approval: false,
    delivery: "branch",
  });

  const lightweightIssue = (
    await invoke("abra_work_create", {
      repository_id: "research",
      title: "Small native fix",
      description: "Implement the explicit scoped request. engineering-acceptance",
      workflow_policy: "lightweight-fix",
      scope: { goal: "Return sample", acceptance: ["Source returns sample"], constraints: [] },
      request_id: "native-lightweight",
      dispatch: { apply: { model: { providerID: "fixture", id: "gpt-specialist" } } },
      report_reference: {
        issue_id: researchIssue.id,
        report_id: researchDone.report_receipt.report_id,
        hash: researchDone.report_receipt.hash,
      },
    })
  ).issue;
  assert.deepEqual(lightweightIssue.dependencies, [researchIssue.id]);
  controls.holdApply = true;
  const lightweightStart = await invoke("abra_work_start", { issue_id: lightweightIssue.id });
  assert.equal(lightweightStart.configuration_snapshot.workers.apply.model.id, "gpt-specialist");
  assert.equal(lightweightStart.configuration_snapshot.dispatch_sources.apply.source, "task.model");
  await eventually(async () => (controls.applyHeld ? true : undefined));
  try {
    const source = await invoke("abra_work_messages", { issue_id: researchIssue.id });
    assert.ok(
      source.entries.some(
        (m: any) => m.record.type === "finding" && m.record.request_id === "native-worker-finding",
      ),
    );
    await invoke("abra_work_message", {
      issue_id: lightweightIssue.id,
      role: "apply",
      request_id: "native-research-handoff",
      body: "Consider retained research within the accepted short scope.",
      kind: "finding",
      response: "acknowledgement",
      source: {
        type: "finding",
        issue_id: researchIssue.id,
        request_id: "native-worker-finding",
      },
    });
    await invoke("abra_work_message", {
      issue_id: lightweightIssue.id,
      role: "apply",
      request_id: "native-unanswered-failure",
      body: "native-request-failure: explain the retained verification evidence.",
      kind: "question",
      response: "answer",
    });
  } finally {
    controls.releaseApply?.();
  }
  let lastFailureStatus: unknown;
  const failedRequestWorker = await eventually(async () => {
    const status = await invoke("abra_work_status", { issue_id: lightweightIssue.id });
    lastFailureStatus = status.execution;
    return status.execution.current_phase === "failed" ? status.execution : undefined;
  }).catch(async (error) => {
    engineeringEvidence.push({
      failed_request_observation: lastFailureStatus,
      provider_failure_triggered: controls.failedCorrelatedRequest,
      native_session: await client.session.get({
        sessionID: lightweightStart.apply_session_id,
      }),
      native_inbox: await client.session.inbox.list({
        sessionID: lightweightStart.apply_session_id,
      }),
      native_active: await client.session.active(),
      native_turns: (await client.session.context({ sessionID: lightweightStart.apply_session_id }))
        .filter((m) => m.type === "user" || m.type === "idle")
        .map((m) => ({
          id: m.id,
          type: m.type,
          ...(m.type === "idle"
            ? { outcome: m.outcome, error: m.error }
            : { text: m.text?.slice(0, 120) }),
          time: m.time,
        })),
    });
    throw error;
  });
  const unresolvedBeforeRestart = await invoke("abra_work_messages", {
    issue_id: lightweightIssue.id,
  });
  const failedRequest = unresolvedBeforeRestart.entries.find(
    (m: any) => m.record.request_id === "native-unanswered-failure",
  ).record;
  assert.equal(unresolvedBeforeRestart.outstanding, 1);
  assert.equal(failedRequest.reply, undefined);
  assert.ok(
    [lightweightStart.prompt_id, failedRequest.prompt_id].includes(
      failedRequestWorker.worker_failure.prompt_id,
    ),
  );
  const unattendedConfiguration = parseDocument(await readFile(personalPath, "utf8"));
  unattendedConfiguration.set("supervision_mode", "unattended");
  unattendedConfiguration.delete("auto_schedule");
  await writeFile(personalPath, unattendedConfiguration.toString());
  await restart();
  const unresolvedAfterRestart = await invoke("abra_work_messages", {
    issue_id: lightweightIssue.id,
  });
  assert.equal(unresolvedAfterRestart.outstanding, 1);
  assert.equal(
    unresolvedAfterRestart.entries.find(
      (m: any) => m.record.request_id === "native-research-handoff",
    ).record.status,
    "acknowledged",
  );
  if (previous) {
    const earlierAnswerAfterRestart = (
      await invoke("abra_work_messages", { issue_id: previous.issue.id })
    ).entries.find((m: any) => m.record.request_id === "native-correlated-answer").record;
    assert.equal(earlierAnswerAfterRestart.status, "answered");
    assert.equal(
      earlierAnswerAfterRestart.reply.body,
      "Native correlated answer: use the documented consumer check.",
    );
  }
  assert.deepEqual(
    unresolvedAfterRestart.entries.find(
      (m: any) => m.record.request_id === failedRequest.request_id,
    ).record,
    failedRequest,
  );
  const failedAfterRestart = (await invoke("abra_work_status", { issue_id: lightweightIssue.id }))
    .execution;
  assert.equal(failedAfterRestart.apply_session_id, lightweightStart.apply_session_id);
  assert.equal(failedAfterRestart.worktree_directory, lightweightStart.worktree_directory);
  assert.equal(failedAfterRestart.current_phase, "failed");
  assert.equal(
    (await invoke("abra_work_status", { issue_id: lightweightIssue.id })).supervision.primary,
    "provider_failure",
  );
  engineeringEvidence.push({
    posture: "unattended",
    provider_failure: lightweightIssue.id,
    approval_granted: false,
    preserved_outstanding: unresolvedAfterRestart.outstanding,
  });

  engineeringEvidence.push({
    unanswered_request_restart: failedRequest.request_id,
    prompt_id: failedRequest.prompt_id,
    outstanding: unresolvedAfterRestart.outstanding,
    session_id: failedAfterRestart.apply_session_id,
  });
  for (const incident of failedAfterRestart.attention ?? [])
    if (["admitted", "user_needed"].includes(incident.status) && incident.code === "worker_failure")
      await invoke("abra_work_attention", {
        issue_id: lightweightIssue.id,
        incident_id: incident.id,
        generation: failedAfterRestart.control_generation,
        action: "handled",
        reason:
          "Inspected retained provider failure and outstanding request; explicitly retrying the same authorized work",
      });
  await invoke("abra_work_control", { issue_id: lightweightIssue.id, action: "retry" });
  const lightweightDone = await eventually(async () => {
    if (!(await atPhase(lightweightIssue.id, "completed"))) return undefined;
    const status = await invoke("abra_work_status", { issue_id: lightweightIssue.id });
    if (["blocked", "failed", "recovery_required"].includes(status.execution.current_phase))
      throw Error(JSON.stringify(status));
    return status.execution.current_phase === "completed" ? status.execution : undefined;
  });
  assert.equal(lightweightDone.archive_path, undefined);
  assert.equal(lightweightDone.rounds.length, 1);
  const handoff = (
    await invoke("abra_work_messages", { issue_id: lightweightIssue.id })
  ).entries.find((m: any) => m.record.request_id === "native-research-handoff").record;
  assert.equal(handoff.status, "acknowledged");
  assert.equal(handoff.recipient_session_id, lightweightStart.apply_session_id);
  assert.equal(lightweightDone.scope.contract.goal, "Return sample");
  engineeringEvidence.push({
    forwarded_finding: "native-worker-finding",
    source_session_id: researchDone.research_session_id,
    recipient_session_id: handoff.recipient_session_id,
    acknowledgement: handoff.status,
  });
  assert.ok(
    lightweightDone.verification_receipt &&
      lightweightDone.review_receipt &&
      lightweightDone.delivery_receipt,
  );

  const exhaustedIssue = (
    await invoke("abra_work_create", {
      repository_id: "research",
      title: "Exhaust native correction budget",
      description: "Keep failed scoped evidence. engineering-acceptance",
      workflow_policy: "lightweight-fix",
      scope: { goal: "Return sample", acceptance: ["Source returns sample"], constraints: [] },
      request_id: "native-exhausted",
    })
  ).issue;
  await invoke("abra_work_start", { issue_id: exhaustedIssue.id });
  const exhausted = await eventually(async () => {
    if (!(await atPhase(exhaustedIssue.id, "blocked"))) return undefined;
    const status = await invoke("abra_work_status", { issue_id: exhaustedIssue.id });
    if (status.execution.current_phase === "blocked" && !status.execution.decisions?.length)
      throw Error(JSON.stringify(status.execution));
    return status.execution.current_phase === "blocked" &&
      status.execution.decisions?.some((d: any) => d.status === "open")
      ? status.execution
      : undefined;
  });
  assert.equal(exhausted.rounds.length, 1);
  assert.match(
    exhausted.decisions.find((d: any) => d.status === "open").question,
    /budget exhausted/,
  );

  const unavailableIssue = (
    await invoke("abra_work_create", {
      repository_id: "worker",
      title: "Unavailable engineering proof",
      description:
        "Implement sample; runtime observation unavailable. engineering-unavailable-evidence",
      request_id: "engineering-unavailable",
    })
  ).issue;
  await invoke("abra_work_start", { issue_id: unavailableIssue.id });
  const unavailablePlan = await eventually(async () => {
    if (!(await atPhase(unavailableIssue.id, "awaiting_plan_approval"))) return undefined;
    const current = (await invoke("abra_work_status", { issue_id: unavailableIssue.id })).execution;
    return current.current_phase === "awaiting_plan_approval" ? current : undefined;
  });
  const approval = await invoke("abra_work_approve", {
    issue_id: unavailableIssue.id,
    kind: "plan",
  });
  assert.ok(approval?.form_id);
  await client.session.form.reply({
    sessionID: supervisor.id,
    formID: approval.form_id,
    answer: { authorize: true },
  });
  const unavailable = await eventually(async () => {
    if (!(await atPhase(unavailableIssue.id, "blocked"))) return undefined;
    const current = (await invoke("abra_work_status", { issue_id: unavailableIssue.id })).execution;
    return current.current_phase === "blocked" && current.review_receipt ? current : undefined;
  });
  assert.equal(unavailable.review_receipt.passed, false);
  assert.equal(unavailable.review_receipt.spec_verification.correctness.status, "not_verified");
  assert.equal(unavailable.delivery_receipt, undefined);
  assert.equal(unavailable.plan_fingerprint, unavailablePlan.plan_fingerprint);
  for (const file of ["docs/verification/README.md", "GLOSSARY.md", ".cursor/skills"])
    await assert.rejects(access(join(unavailable.worktree_directory, file)), /ENOENT/);
  const unavailableApplyMessages = await client.session.context({
    sessionID: unavailable.apply_session_id,
  });
  assert.match(
    JSON.stringify(unavailableApplyMessages),
    /Runtime audit prerequisite is unavailable/,
  );
  assert.ok(unavailable.decisions.some((d: any) => d.status === "open"));
  const unavailableMessages = await client.session.context({
    sessionID: unavailable.review_session_id,
  });
  assert.ok(JSON.stringify(unavailableMessages).includes("unavailable-proof.json"));
  engineeringEvidence.push({
    unavailable_evidence: unavailable.review_receipt,
    phase: unavailable.current_phase,
  });
  // Restore the original conservative intake posture before proving that batch
  // creation itself never dispatches work.
  const conservativeConfiguration = parseDocument(await readFile(personalPath, "utf8"));
  conservativeConfiguration.delete("supervision_mode");
  conservativeConfiguration.set("auto_schedule", false);
  await writeFile(personalPath, conservativeConfiguration.toString());
  await restart();
  engineeringEvidence.push({
    posture: "unattended",
    review_blocker: unavailableIssue.id,
    scope_unchanged: true,
    delivery_authorized: false,
  });
  if (process.env.ABRACODE_TEST_COMBINED === "1") engineeringEvidence.push(await runReports());
  if (process.env.ABRACODE_TEST_COMBINED === "1") engineeringEvidence.push(await runLeads());
  if (process.env.ABRACODE_TEST_COMBINED === "1") engineeringEvidence.push(await runModels());

  const nativeBatchInput = {
    request_id: "native-batch-intake",
    tasks: [
      {
        client_key: "consumer",
        repository_id: "research",
        title: "Dependent batch research",
        description: "Inspect source using the prerequisite findings",
        workflow_policy: "research-only",
        scope: {
          goal: "Inspect source",
          acceptance: ["Retain findings"],
          constraints: ["Read only"],
        },
        dependencies: [{ type: "local", client_key: "prerequisite" }],
      },
      {
        client_key: "prerequisite",
        repository_id: "research",
        title: "Prerequisite batch research",
        description: "Investigate the source contract",
        workflow_policy: "research-only",
        scope: {
          goal: "Understand the contract",
          acceptance: ["Retain findings"],
          constraints: ["Read only"],
        },
        dependencies: [{ type: "existing", issue_id: researchIssue.id }],
      },
      {
        client_key: "independent",
        repository_id: "research",
        title: "Independent batch research",
        description: "Inspect source independently",
        workflow_policy: "research-only",
        scope: {
          goal: "Inspect independent evidence",
          acceptance: ["Retain findings"],
          constraints: ["Read only"],
        },
      },
    ],
  };
  const nativeBatch = await invoke("abra_work_create_batch", nativeBatchInput);
  assert.equal(nativeBatch.tasks.length, 3);
  const nativeMapping = nativeBatch.tasks.map((task: any) => [task.client_key, task.issue.id]);
  assert.deepEqual(
    (
      await invoke("abra_work_create_batch", {
        ...nativeBatchInput,
        tasks: nativeBatchInput.tasks.toReversed(),
      })
    ).tasks.map((task: any) => [task.client_key, task.issue.id]),
    nativeMapping,
  );
  const prerequisite = nativeBatch.tasks.find(
    (task: any) => task.client_key === "prerequisite",
  ).issue;
  assert.deepEqual(
    nativeBatch.tasks.find((task: any) => task.client_key === "consumer").issue.dependencies,
    [prerequisite.id],
  );
  assert.deepEqual(prerequisite.dependencies, [researchIssue.id]);
  assert.ok(nativeBatch.tasks.every((task: any) => task.issue.status === "open"));
  assert.ok(
    !(await invoke("abra_work_list", {})).executions.some((execution: any) =>
      nativeBatch.tasks.some((task: any) => task.issue.id === execution.issue_id),
    ),
  );
  await assert.rejects(
    invoke("abra_work_create_batch", {
      ...nativeBatchInput,
      tasks: nativeBatchInput.tasks.map((task) => ({ ...task, description: "Rebound goal" })),
    }),
    /REQUEST_REBIND/,
  );
  engineeringEvidence.push({
    batch_intake: nativeBatchInput.request_id,
    mapping: nativeMapping,
    atomic_tasks: 3,
    dispatch: false,
  });
  if (process.env.ABRACODE_TEST_COMBINED === "1") engineeringEvidence.push(await runParallel());
  return { researchIssue, exhaustedIssue, nativeBatchInput, nativeMapping };
}
