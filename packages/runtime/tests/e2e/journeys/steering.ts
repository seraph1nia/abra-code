import { portableRpc } from "../../helpers/portable-rpc.ts";
import { nativeObservation } from "../../helpers/native-observation.ts";
import { configuration } from "../../../src/config/protocol.ts";
import * as Id from "@abracode/contracts/identities";
import { run } from "../../effects.ts";
import assert from "node:assert/strict";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Schema } from "effect";
import { repo } from "../../fixtures.ts";
import { type Execution, type Issue } from "../../../src/domain.ts";
import { type NativeHarness } from "../native-harness.ts";
import { eventually } from "../native-timing.ts";
export async function runSteering(h: NativeHarness) {
  const {
    journey,
    root,
    git,
    engineeringEvidence,
    home,
    projects,
    client,
    api,
    loc,
    observer,
    tools,
    supervisor,
    progressUpdates,
    invoke,
    restart,
    t,
  } = h;
  const { controls } = h.mock;
  let managedAPI: any;
  for (let i = 0; i < projects.length; i++) {
    const report = await invoke("abra_project_onboard", {
      id: ["frontend", "api", "worker"][i],
      ...(i === 1 ? { remote: `${projects[i]}.git` } : { path: projects[i] }),
      action: "register",
      verification: [
        [
          process.execPath,
          "-e",
          'const fs=require("fs");if(fs.readFileSync("source.txt","utf8")!=="sample\\n")process.exit(1)',
        ],
        ...(i === 1 ? [[process.execPath, "sample-proof.mjs"]] : []),
      ],
      delivery: "branch",
    });
    if (i === 1) managedAPI = report.project;
  }
  assert.equal((await invoke("abra_project_list", {})).length, 3);
  const beforeInvalid = (await invoke("abra_work_list", {})).issues.length;
  await client.session.prompt({
    sessionID: supervisor.id,
    text: "Validate AbraCode tool input contracts.",
  });
  await client.session.wait({ sessionID: supervisor.id });
  const validationContext = await client.session.context({ sessionID: supervisor.id });
  const invalidCalls = validationContext.flatMap((message) =>
    message.type === "assistant"
      ? message.content.filter((part) => part.type === "tool" && part.name === "abra_work_create")
      : [],
  );
  assert.equal(invalidCalls.length, 2);
  assert.ok(
    invalidCalls.every((part) => part.type === "tool" && part.state.status === "error"),
    JSON.stringify(invalidCalls),
  );
  assert.equal((await invoke("abra_work_list", {})).issues.length, beforeInvalid);
  await assert.rejects(
    observer.detail({ issue_id: Id.IssueId.make("missing") }, loc),
    (error: any) => error.type === "not_found",
  );
  const changes: Array<{ home: string; directory: string }> = [];
  const observeChanges = () =>
    observer.events.on("changed", (event) => {
      changes.push({ home: event.data.home, directory: event.location.directory });
    });
  const stopChanges = observeChanges();
  t.onTestFinished(stopChanges);
  assert.equal((await nativeObservation(() => observer.snapshot({}, loc))).home, home);
  assert.ok(managedAPI.managed);
  await run(git.run(managedAPI.path, ["config", "user.email", "fixture@example.invalid"]));
  await run(git.run(managedAPI.path, ["config", "user.name", "Fixture"]));
  await writeFile(join(projects[1], "fresh.txt"), "Fetched after onboarding.\n");
  await run(git.run(Id.AbsolutePath.make(projects[1]), ["add", "."]));
  await run(
    git.run(Id.AbsolutePath.make(projects[1]), ["commit", "-m", "Advance remote after onboarding"]),
  );
  await run(git.run(Id.AbsolutePath.make(projects[1]), ["push", "origin", "main"]));
  const freshBase = await run(git.head(Id.AbsolutePath.make(projects[1])));
  assert.notEqual(await run(git.head(managedAPI.path)), freshBase);
  // Bootstrap OpenSpec through the real native API without modifying the cache clone.
  const bootstrap = await run(repo(root, "bootstrap"));
  await run(git.run(Id.AbsolutePath.make(bootstrap), ["rm", "openspec/config.yaml"]));
  await writeFile(join(bootstrap, "AGENTS.md"), "Preserve bootstrap instructions.\n");
  await run(git.run(Id.AbsolutePath.make(bootstrap), ["add", "."]));
  await run(git.run(Id.AbsolutePath.make(bootstrap), ["commit", "-m", "Unconfigured remote"]));
  await run(git.run(Id.AbsolutePath.make(bootstrap), ["push", "origin", "main"]));
  const pendingSetup = await invoke("abra_project_onboard", {
    id: "bootstrap",
    remote: `${bootstrap}.git`,
    action: "register",
    verification: [[process.execPath, "-e", "process.exit(0)"]],
    delivery: "branch",
  });
  assert.ok(pendingSetup.setup_blockers.some((s: string) => s.includes("OpenSpec")));
  await run(
    git.run(pendingSetup.project.path, ["config", "user.email", "fixture@example.invalid"]),
  );
  await run(git.run(pendingSetup.project.path, ["config", "user.name", "Fixture"]));
  const preparedSetup = await invoke("abra_project_setup", {
    id: "bootstrap",
    action: "prepare",
    initialize_openspec: true,
  });
  assert.ok(
    progressUpdates.some((update) => update.stage === "setup" && update.status === "completed"),
  );
  assert.equal(
    await readFile(join(preparedSetup.worktree_directory, "AGENTS.md"), "utf8"),
    "Preserve bootstrap instructions.\n",
  );
  assert.equal(await run(git.dirty(pendingSetup.project.path)), "");
  await invoke("abra_project_setup", { id: "bootstrap", action: "deliver" });
  const finishedSetup = await invoke("abra_project_setup", { id: "bootstrap", action: "finish" });
  assert.equal(finishedSetup.current_phase, "completed");
  const setupRegistry = (await invoke("abra_project_list", {})).find(
    (p: any) => p.id === "bootstrap",
  );
  assert.equal(
    setupRegistry.openspec,
    false,
    "Preserving a setup branch does not change the remote default branch",
  );
  assert.equal(
    (await client.worktree.list({ projectID: setupRegistry.project_id })).some(
      (w) => w.directory === preparedSetup.worktree_directory,
    ),
    false,
  );
  assert.ok(tools.tools.some((tool) => tool.id === "abra_work_create"));
  const goal = {
    repository_id: "api",
    title: "Sample API",
    description:
      "Add the sample API behavior and update AGENTS.md navigation through a full OpenSpec flow. browser-acceptance decision-routing-acceptance instruction-edit-acceptance engineering-acceptance",
    request_id: "sample-api",
  };
  const intake = await invoke("abra_work_create", goal);
  const issue = intake.issue as Issue;
  assert.equal(intake.readiness.eligible, true);
  assert.equal((await invoke("abra_work_create", goal)).issue.id, issue.id);
  const frontendIssue = (
    await invoke("abra_work_create", {
      repository_id: "frontend",
      title: "Frontend contract",
      description: "Consume the API contract.",
      dependencies: [issue.id],
      request_id: "frontend-contract",
    })
  ).issue as Issue;
  const workerIssue = (
    await invoke("abra_work_create", {
      repository_id: "worker",
      title: "Worker contract",
      description: "Use the frontend contract.",
      dependencies: [frontendIssue.id],
      request_id: "worker-contract",
    })
  ).issue as Issue;
  assert.equal((await invoke("abra_work_list", {})).issues.length, 3);
  const queue = await invoke("abra_work_ready", {});
  assert.deepEqual(
    queue.filter((row: any) => row.eligible).map((row: any) => row.issue.id),
    [issue.id],
  );
  assert.equal(
    queue.find((row: any) => row.issue.id === frontendIssue.id).dependencies[0].id,
    issue.id,
  );
  let e = (await invoke("abra_work_start", { issue_id: issue.id })) as Execution;
  assert.equal(e.base_commit, freshBase);
  assert.equal(e.target_branch, "main");
  assert.equal(
    await readFile(join(e.worktree_directory!, "fresh.txt"), "utf8"),
    "Fetched after onboarding.\n",
  );
  const failed = await eventually(async () => {
    const status = await invoke("abra_work_status", { issue_id: issue.id });
    return status.execution.current_phase === "failed" ? status.execution : undefined;
  });
  assert.equal(failed.worker_failure.error.status, 403);
  assert.match(failed.error_or_recovery_reason, /authentication denied/);
  const failureDiagnostics = await invoke("abra_work_diagnostics", { issue_id: issue.id });
  assert.equal(failureDiagnostics.sessions[0].error.status, 403);
  assert.equal(failureDiagnostics.sessions[0].model.id, "gpt-fixture");
  assert.ok(!JSON.stringify(failureDiagnostics).includes("fixture-private-token"));
  const nativeAttention = await eventually(async () => {
    const status = await invoke("abra_work_status", { issue_id: issue.id });
    return status.execution.attention?.find((a: any) => a.status === "admitted");
  });
  assert.equal(nativeAttention.code, "worker_failure");
  assert.ok(nativeAttention.prompt_id);
  await eventually(async () => {
    const messages = await client.session.context({ sessionID: supervisor.id });
    return messages.some(
      (m: any) =>
        m.type === "assistant" &&
        m.content.some(
          (part: any) =>
            part.type === "tool" &&
            part.name === "abra_work_control" &&
            part.state.status === "error" &&
            JSON.stringify(part.state.error).includes("ATTENTION_AUTHORITY"),
        ),
    );
  });
  assert.equal(
    (await invoke("abra_work_status", { issue_id: issue.id })).execution.current_phase,
    "failed",
  );
  await invoke("abra_work_attention", {
    issue_id: issue.id,
    incident_id: nativeAttention.id,
    generation: nativeAttention.generation,
    action: "handled",
    reason: "Inspected the fixture provider failure; an explicit retry follows.",
  });
  // Simulate a pre-browser rollout session. Only a deliberate new turn refreshes permissions.
  await client.session.update({
    sessionID: e.explore_session_id!,
    permissions: [{ action: "*", resource: "*", effect: "deny" }],
  });
  for (const delivery of ["steer", "queue"] as const) {
    await assert.rejects(
      client.session.prompt({
        sessionID: e.explore_session_id!,
        text: "direct-worker-must-not-run",
        delivery,
      }),
    );
  }
  assert.equal(controls.directWorkerProviderCalls, 0);
  await assert.rejects(
    client
      .rpc(portableRpc(configuration))
      .reconcile({ session_id: e.explore_session_id!, action: "apply" }, loc),
    (error: any) => error.type === "refused" && error.data.code === "ABRA_REQUIRED",
  );
  controls.holdExplore = true;
  const retry = await invoke("abra_work_control", { issue_id: issue.id, action: "retry" });
  assert.equal(retry.explore_session_id, e.explore_session_id);
  assert.equal(retry.worktree_directory, e.worktree_directory);
  assert.equal(retry.configuration_snapshot.workers.explore.model.id, "gpt-fixture");
  await eventually(async () => (controls.exploreHeld ? true : undefined));
  try {
    if (journey === "engineering") {
      const workerLocation = { location: { directory: retry.worktree_directory! } };
      const direct = Schema.decodeUnknownSync(Schema.Struct({ prepared: Schema.Finite }))(
        await api.invoke(
          {
            tool: "inspect-specialist",
            args: { task: issue.id },
            session: retry.explore_session_id!,
            message: retry.prompt_id,
          },
          workerLocation,
        ),
      );
      assert.ok(direct.prepared >= 1);
      await assert.rejects(
        api.invoke(
          {
            tool: "inspect-denied",
            args: {},
            session: retry.explore_session_id!,
            message: retry.prompt_id,
          },
          workerLocation,
        ),
        (error: any) => error.type === "action_failed" && error.data.code === "AGENT_TOOL",
      );
      await assert.rejects(
        api.invoke(
          {
            tool: "inspect-specialist",
            args: { task: issue.id },
            session: retry.explore_session_id!,
            message: e.prompt_id,
          },
          workerLocation,
        ),
        (error: any) => error.type === "action_failed" && error.data.code === "AGENT_TOOL",
      );
      engineeringEvidence.push({
        native_contribution_direct: {
          allowed_current_call: true,
          explicit_denial: true,
          stale_message_denial: true,
          current_prompt: retry.prompt_id,
          stale_prompt: e.prompt_id,
        },
      });
    }
    const replay = await client.session.prompt({
      sessionID: retry.explore_session_id!,
      id: retry.prompt_id!,
      text: "direct-worker-must-not-run: changed payload under an already admitted assignment ID",
      delivery: "queue",
    });
    assert.equal(replay.id, retry.prompt_id);
    assert.ok(!replay.payload.text.includes("direct-worker-must-not-run"));
    engineeringEvidence.push({
      steering_identity_replay: "native returns original payload before invoking the prompt hook",
      assignment_prompt_id: retry.prompt_id,
      session_id: retry.explore_session_id,
      changed_payload_accepted: false,
      native_request_rejected: false,
      direct_provider_calls: controls.directWorkerProviderCalls,
    });
    await invoke("abra_work_control", {
      issue_id: issue.id,
      action: "steer",
      request_id: "native-steering",
      text: "controller-steering-native-marker: Continue the retained assignment within its approved scope.",
    });
    await invoke("abra_work_control", {
      issue_id: issue.id,
      action: "steer",
      request_id: "native-steering",
      text: "controller-steering-native-marker: Continue the retained assignment within its approved scope.",
    });
    await assert.rejects(
      invoke("abra_work_control", {
        issue_id: issue.id,
        action: "steer",
        request_id: "native-steering",
        text: "Changed instruction",
      }),
      /MESSAGE_REBIND/,
    );
    const retained = (await invoke("abra_work_status", { issue_id: issue.id })).execution;
    assert.equal(retained.prompt_id, retry.prompt_id);
    assert.equal(retained.worker_context_id, retry.worker_context_id);
    assert.equal(retained.messages.length, 1);
    assert.notEqual(retained.messages[0].prompt_id, retry.prompt_id);
    const inbox = await client.session.inbox.list({ sessionID: retry.explore_session_id! });
    assert.equal(inbox.filter((m) => m.id === retained.messages[0].prompt_id).length, 1);
    for (const delivery of ["queue", "steer"] as const)
      await assert.rejects(
        client.session.prompt({
          sessionID: retry.explore_session_id!,
          text: "direct-worker-must-not-run",
          delivery,
          metadata: { source: "abracode" },
        }),
      );
    // Let the first steer reach the provider, then hold that request while a
    // second instruction is queued. Pause must withdraw it before another turn.
    controls.exploreHeld = false;
    controls.holdExplore = true;
    controls.releaseExplore?.();
    await eventually(async () => (controls.exploreHeld ? true : undefined));
    assert.ok(controls.steeringProviderCalls > 0);
    const queued = await invoke("abra_work_control", {
      issue_id: issue.id,
      action: "steer",
      request_id: "native-steering-cancel",
      text: "controller-cancel-native-marker: This pending instruction must be withdrawn.",
    });
    const withdrawnID = queued.messages.find(
      (m: any) => m.request_id === "native-steering-cancel",
    ).prompt_id;
    assert.ok(
      (await client.session.inbox.list({ sessionID: retry.explore_session_id! })).some(
        (m) => m.id === withdrawnID,
      ),
    );
    await invoke("abra_work_control", { issue_id: issue.id, action: "pause" });
    const paused = await eventually(async () => {
      const current = (await invoke("abra_work_status", { issue_id: issue.id })).execution;
      return current.stop_status === "confirmed" ? current : undefined;
    });
    assert.equal(paused.stop_status, "confirmed");
    assert.ok(paused.messages.every((m: any) => m.status === "superseded"));
    assert.equal(
      (await client.session.inbox.list({ sessionID: retry.explore_session_id! })).length,
      0,
    );
    await assert.rejects(
      invoke("abra_work_control", {
        issue_id: issue.id,
        action: "steer",
        request_id: "native-stale-generation",
        text: "Must not run",
      }),
      /STEER/,
    );
    await assert.rejects(
      client.session.prompt({
        sessionID: retry.explore_session_id!,
        text: "direct-worker-must-not-run",
        delivery: "steer",
        metadata: { source: "abracode", generation: retry.control_generation },
      }),
    );
    engineeringEvidence.push({
      steering_pause: "queued instruction withdrawn; generation superseded",
      prompt_id: withdrawnID,
      stop_status: paused.stop_status,
      pending_native_items: 0,
    });
  } catch (error) {
    engineeringEvidence.push({
      steering: "controller admission refused",
      assignment_prompt_id: retry.prompt_id,
      session_id: retry.explore_session_id,
      provider_marker_calls: controls.steeringProviderCalls,
      error: String(error),
    });
    throw error;
  } finally {
    controls.releaseExplore?.();
  }
  controls.exploreHeld = false;
  controls.holdExplore = true;
  const resumedSteering = await invoke("abra_work_control", {
    issue_id: issue.id,
    action: "resume",
  });
  assert.equal(resumedSteering.explore_session_id, retry.explore_session_id);
  assert.equal(resumedSteering.worktree_directory, retry.worktree_directory);
  assert.equal(resumedSteering.configuration_snapshot.workers.explore.model.id, "gpt-fixture");
  await eventually(async () => (controls.exploreHeld ? true : undefined));
  try {
    const message = {
      issue_id: issue.id,
      request_id: "native-correlated-answer",
      role: "explore",
      body: "Which verification command should the implementation use?",
      kind: "question",
      response: "answer",
      delivery: "queue",
    };
    const admitted = await invoke("abra_work_message", message);
    assert.equal(admitted.status, "admitted");
    assert.equal((await invoke("abra_work_message", message)).prompt_id, admitted.prompt_id);
    assert.equal((await invoke("abra_work_messages", { issue_id: issue.id })).outstanding, 1);
    const workerSession = resumedSteering.explore_session_id;
    await restart(undefined, () => controls.releaseExplore?.());
    stopChanges();
    t.onTestFinished(observeChanges());
    const recoveredMessage = await invoke("abra_work_message", message);
    assert.equal(recoveredMessage.prompt_id, admitted.prompt_id);
    assert.equal(recoveredMessage.recipient_session_id, workerSession);
    const nativeQueued = await client.session.inbox.list({ sessionID: workerSession });
    const nativeHistory = await client.session.context({ sessionID: workerSession });
    assert.ok(
      nativeQueued.some((m) => m.id === admitted.prompt_id) ||
        nativeHistory.some((m) => m.id === admitted.prompt_id),
    );
    engineeringEvidence.push({
      queued_message_restart: admitted.request_id,
      prompt_id: admitted.prompt_id,
      recipient_session_id: workerSession,
      controller_identity_reused: true,
    });
  } finally {
    controls.releaseExplore?.();
  }
  let sampledRestart = false;
  e = await eventually(async () => {
    const status = await invoke("abra_work_status", { issue_id: issue.id });
    if (!sampledRestart && status.execution.current_phase === "interrupted") {
      sampledRestart = true;
      const queue = await client.session.inbox.list({
        sessionID: resumedSteering.explore_session_id,
      });
      const request = status.execution.messages.find(
        (m: any) => m.request_id === "native-correlated-answer",
      );
      engineeringEvidence.push({
        interrupted_assignment_after_restart: status.execution.prompt_id,
        request_status: request.status,
        queued_ids: queue.map((m) => m.id),
        request_answer: request.reply?.body,
      });
    }
    if (
      status.execution.current_phase === "interrupted" &&
      status.execution.messages.some(
        (m: any) => m.request_id === "native-correlated-answer" && m.status === "answered",
      )
    ) {
      await invoke("abra_work_control", { issue_id: issue.id, action: "resume" });
      return undefined;
    }
    if (["blocked", "failed", "recovery_required"].includes(status.execution.current_phase))
      throw Error(JSON.stringify(status));
    return status.execution.current_phase === "awaiting_plan_approval"
      ? status.execution
      : undefined;
  }, 40000);
  assert.ok(controls.steeringProviderCalls > 0);
  const steeringContext = await client.session.context({ sessionID: retry.explore_session_id! });
  assert.equal(
    steeringContext.filter(
      (m) => m.type === "user" && m.text.includes("controller-steering-native-marker"),
    ).length,
    1,
  );
  assert.equal(controls.directWorkerProviderCalls, 0);
  assert.equal(
    steeringContext.filter(
      (m) => m.type === "user" && m.text.includes("controller-cancel-native-marker"),
    ).length,
    0,
  );
  assert.equal(controls.cancelledSteeringProviderCalls, 0);
  const replies = await invoke("abra_work_messages", { issue_id: issue.id });
  const answer = replies.entries.find(
    (m: any) => m.record.request_id === "native-correlated-answer",
  ).record;
  assert.equal(answer.status, "answered");
  assert.equal(answer.reply.body, "Native correlated answer: use the documented consumer check.");
  assert.equal(
    steeringContext.filter((m) => m.type === "user" && m.id === answer.prompt_id).length,
    1,
  );
  const storedAnswerPrompt = await client.session.message.get({
    sessionID: answer.recipient_session_id,
    messageID: answer.prompt_id,
  });
  assert.ok(storedAnswerPrompt.type === "user" && storedAnswerPrompt.text === answer.prompt);
  const firstNativePage = await client.message.list({
    sessionID: answer.recipient_session_id,
    order: "desc",
    limit: 2,
  });
  assert.equal(firstNativePage.data.length, 2);
  assert.ok(firstNativePage.cursor.next);
  assert.ok(
    (
      await client.message.list({
        sessionID: answer.recipient_session_id,
        limit: 2,
        cursor: firstNativePage.cursor.next,
      })
    ).data.length > 0,
  );
  assert.equal(replies.outstanding, 0);
  engineeringEvidence.push({
    message_request: answer.request_id,
    prompt_id: answer.prompt_id,
    recipient_session_id: answer.recipient_session_id,
    status: answer.status,
    reply: answer.reply.body,
  });
  engineeringEvidence.push({
    steering: "admitted once in existing session",
    assignment_prompt_id: retry.prompt_id,
    session_id: retry.explore_session_id,
    provider_marker_calls: controls.steeringProviderCalls,
    native_user_messages: 1,
    direct_provider_calls: controls.directWorkerProviderCalls,
  });
  return { managedAPI, changes, goal, issue, frontendIssue, workerIssue, e, nativeAttention };
}
