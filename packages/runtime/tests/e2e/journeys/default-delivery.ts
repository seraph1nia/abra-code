import { portableRpc } from "../../helpers/portable-rpc.ts";
import { nativeObservation } from "../../helpers/native-observation.ts";
import { parseDocument } from "yaml";
import { configuration } from "../../../src/config/protocol.ts";
import { assertBrowserWorker, browserIsolation } from "../browser.ts";
import { capturePreSuite, assertPreSuiteAfterRestart } from "../engineering-recovery.ts";
import { assertEngineeringWorker } from "../engineering.ts";
import { agentFixture } from "../agents.ts";
import { engineeringSkills } from "@abracode/agents/engineering-skills";
import { workerContextCapabilities } from "../worker-context.ts";
import { WorkerContextSummarySchema } from "../../../src/workflow/worker-context-contracts.ts";
import * as Id from "@abracode/contracts/identities";
import { run } from "../../effects.ts";
import assert from "node:assert/strict";
import { writeFile, readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { Schema } from "effect";
import { type Execution } from "../../../src/domain.ts";
import { type NativeHarness } from "../native-harness.ts";
import { eventually } from "../native-timing.ts";
import { runSteering } from "./steering.ts";
import { type CompanionJourneys } from "./companions.ts";
import { restartWithOverrides } from "./restart-overrides.ts";
import { runResearchContracts } from "./research-contracts.ts";
import { runFinishing } from "./finishing.ts";
export async function defaultDelivery(h: NativeHarness, companions: CompanionJourneys) {
  const personalPath = join(h.home, "abracode.yaml");
  const { managedAPI, changes, goal, issue, frontendIssue, workerIssue, e, nativeAttention } =
    await runSteering(h);
  const {
    journey,
    root,
    git,
    engineeringEvidence,
    home,
    port,
    password,
    client,
    api,
    loc,
    observer,
    atPhase,
    supervisor,
    invoke,
    restart,
  } = h;
  const { controls, address } = h.mock;
  const routed = await eventually(async () => {
    const state = (await invoke("abra_work_status", { issue_id: issue.id })).execution;
    return state.attention?.some(
      (a: any) => a.code === "decision_pending" && a.status === "handled",
    )
      ? state
      : undefined;
  });
  assert.equal(
    routed.decisions.find((d: any) => d.key === "native-inventory").answer,
    "Retained native fixture inventory evidence",
  );
  assert.equal(
    routed.attention_turns,
    1,
    "Question routing must work after diagnostics are exhausted",
  );
  assert.deepEqual(routed.approval_receipts, []);
  assert.equal(await readFile(join(e.worktree_directory!, "source.txt"), "utf8"), "original\n");
  await assertBrowserWorker(client, home, e.explore_session_id!);
  const sidebarSnapshot = await nativeObservation(() => observer.snapshot({}, loc));
  const observed = sidebarSnapshot.work.find((work) => work.issue_id === issue.id)!;
  assert.equal(observed.phase, "awaiting_plan_approval");
  assert.ok(observed.sessions.some((session) => session.id === e.explore_session_id));
  assert.ok(sidebarSnapshot.fleet!.counts.human_wait >= 1);
  assert.equal(
    Object.values(sidebarSnapshot.fleet!.counts).reduce((total, n) => total + n, 0),
    sidebarSnapshot.fleet!.total,
  );
  const communicationPage = await observer.messages({ issue_id: issue.id }, loc);
  assert.ok(
    communicationPage.entries.some(
      (entry) =>
        entry.record.request_id === "native-correlated-answer" &&
        entry.record.type !== "finding" &&
        entry.record.status === "answered",
    ),
  );
  const sidebarDetail = await nativeObservation(() => observer.detail({ issue_id: issue.id }, loc));
  assert.match(sidebarDetail.proposal!, /Why/);
  assert.equal(sidebarDetail.progress?.complete, 0);
  await eventually(async () => (changes.length ? true : undefined));
  assert.ok(changes.every((event) => event.home === home));
  await eventually(async () =>
    changes.some((event) => event.directory === e.worktree_directory) ? true : undefined,
  );
  await assert.rejects(
    observer.document({ issue_id: issue.id, path: Id.RelativePath.make("outside.md") }, loc),
    (error: any) => error.type === "invalid_selection",
  );
  assert.equal(sidebarDetail.work.issue_status, "in_progress");
  assert.ok(sidebarDetail.documents?.includes(Id.RelativePath.make("design.md")));
  assert.match(
    (await observer.document({ issue_id: issue.id, path: "design.md" }, loc)).content,
    /Design|design|Context/,
  );
  await assert.rejects(
    observer.report({ issue_id: issue.id }, loc),
    (error: any) => error.type === "resource_unavailable",
  );
  const planningDiff = await observer.diff({ issue_id: issue.id, scope: "all" }, loc);
  assert.equal(planningDiff.base, e.base_commit);
  assert.ok(planningDiff.files.some((file) => file.path.endsWith("proposal.md")));
  assert.ok(planningDiff.patch);
  const workerDiff = await observer.diff(
    { issue_id: issue.id, scope: "all" },
    { location: { directory: e.worktree_directory! } },
  );
  assert.equal(workerDiff.base, e.base_commit);

  assert.equal(
    (
      await nativeObservation(() =>
        observer.snapshot({}, { location: { directory: e.worktree_directory! } }),
      )
    ).home,
    home,
  );
  assert.ok(
    (await client.skill.list({ location: { directory: e.worktree_directory! } })).data.some(
      (s) => s.id === "abra-openspec-execution",
    ),
  );
  const localSkills = (await client.skill.list({ location: { directory: e.worktree_directory! } }))
    .data;
  assert.ok(
    localSkills.some((s) => s.id === "abra-browser" && s.content.includes("skills get core")),
  );
  assert.ok(localSkills.some((s) => s.name === "local-fixture"));
  for (const { name } of engineeringSkills) {
    assert.ok(
      localSkills.some((s) => s.id === `abra-${name}` && s.content.includes("Adapted from")),
    );
    assert.ok((await client.skill.list(loc)).data.some((s) => s.id === `abra-${name}`));
  }
  engineeringEvidence.push(await assertEngineeringWorker(client, e.explore_session_id!, "explore"));
  for (const file of ["docs/verification/README.md", "GLOSSARY.md", ".cursor/skills"])
    await assert.rejects(access(join(e.worktree_directory!, file)), /ENOENT/);
  assert.equal(
    await readFile(join(e.worktree_directory!, "AGENTS.md"), "utf8"),
    "Preserve foreign repository instructions.\n",
  );
  assert.equal(
    await run(
      git.run(Id.AbsolutePath.make(e.worktree_directory!), [
        "status",
        "--porcelain",
        "--",
        "AGENTS.md",
        ".opencode",
        ".agents",
      ]),
    ),
    "",
  );
  const planningMessages = await client.session.context({ sessionID: e.explore_session_id! });
  const planningCalls = planningMessages.flatMap((m) =>
    m.type === "assistant" ? m.content.filter((p) => p.type === "tool") : [],
  );
  assert.ok(
    planningCalls.some(
      (p) => p.type === "tool" && p.name === "read" && p.state.status === "completed",
    ),
    "Explore can read another registered repository",
  );
  assert.ok(
    planningCalls.some(
      (p) => p.type === "tool" && p.name === "patch" && p.state.status === "error",
    ),
    "Explore source-edit attempt is rejected by native hook",
  );
  assert.ok(e.explore_session_id);
  const capabilities = await invoke("abra_work_diagnostics", {
    issue_id: issue.id,
    role: "explore",
  });
  assert.ok(capabilities.sessions[0].available_tools.names.includes("patch"));
  assert.ok(!capabilities.sessions[0].available_tools.names.includes("write"));
  assert.equal(capabilities.contexts[0].provenance, "captured");
  const capturedExplore = Schema.decodeUnknownSync(WorkerContextSummarySchema)(
    capabilities.contexts[0],
  );
  assert.equal(capturedExplore.context_id, e.worker_context_id);
  assert.equal(capturedExplore.role, "explore");
  assert.equal(
    capturedExplore.definition,
    journey === "engineering" ? "engineering-specialist" : "explore",
  );
  assert.ok(capturedExplore.profile_revision);
  assert.match(capturedExplore.profile_revision, /^[a-f0-9]{64}$/);
  assert.ok(capturedExplore.selection);
  assert.equal(
    capturedExplore.selection.agent,
    `abra-${capturedExplore.definition}-${capturedExplore.profile_revision}`,
  );
  const selectedExplore = await client.session.get({ sessionID: e.explore_session_id! });
  assert.equal(selectedExplore.agent, capturedExplore.selection.agent);
  const selectedProfile = (
    await client.agent.list({ location: selectedExplore.location })
  ).data.find((agent) => agent.id === capturedExplore.selection!.agent);
  assert.ok(selectedProfile);
  engineeringEvidence.push({
    captured_native_selection: {
      context_id: capturedExplore.context_id,
      session_id: selectedExplore.id,
      definition: capturedExplore.definition,
      native_profile: capturedExplore.selection.agent,
      profile_revision: capturedExplore.profile_revision,
      diagnostics_and_native_session_match: true,
      exact_captured_profile_registered: true,
    },
  });
  assert.equal(capabilities.contexts[0].skills[0].loading, "unobserved");
  assert.ok(capabilities.contexts[0].status.observation.names.includes("patch"));
  const supervisorProfile = (await client.agent.list(loc)).data.find(
    (agent) => agent.id === "abra",
  );
  assert.ok(
    supervisorProfile?.permissions.some((rule) => rule.action === "*" && rule.effect === "deny"),
  );
  assert.ok(
    !supervisorProfile?.permissions.some(
      (rule) => rule.action === "shell" && rule.effect === "allow",
    ),
  );
  for (const [tool, args] of [
    ["abra_work_create", { ...goal, request_id: "worker-self-create" }],
    [
      "abra_work_create_batch",
      {
        request_id: "worker-self-batch",
        tasks: [
          {
            client_key: "blocked",
            repository_id: "api",
            title: "Must reject",
            description: "Workers cannot create batches",
          },
        ],
      },
    ],
    ["abra_work_diagnostics", { issue_id: issue.id }],
    ["abra_work_messages", { issue_id: issue.id }],
    [
      "abra_work_message",
      {
        issue_id: issue.id,
        request_id: "worker-self-message",
        role: "explore",
        body: "Must reject worker management",
      },
    ],
    [
      "abra_work_pr_action",
      {
        issue_id: issue.id,
        generation: e.control_generation,
        expected_head: e.base_commit,
        kind: "ready",
      },
    ],
    [
      "abra_work_feedback",
      {
        issue_id: issue.id,
        generation: e.control_generation,
        expected_head: e.base_commit,
        finding_ids: ["fixture-finding"],
        disposition: "informational",
        reason: "Must reject worker authority",
      },
    ],
    [
      "abra_work_validation",
      {
        issue_id: issue.id,
        generation: e.control_generation,
        expected_head: e.base_commit,
        action: "preflight",
      },
    ],
  ])
    await assert.rejects(
      api.invoke({ tool, args, session: e.explore_session_id }, loc),
      (error: any) => error.type === "action_failed" && error.data.code === "WORKER_FORBIDDEN",
    );
  assert.equal(
    (await client.session.get({ sessionID: e.explore_session_id! })).location.directory,
    e.worktree_directory,
  );
  const paused = await invoke("abra_work_control", { issue_id: issue.id, action: "pause" });
  assert.ok(paused.stop_status === "requested" || paused.stop_status === "confirmed");
  // A monitor may still own the execution lock when pause returns. Resume only after
  // reconciliation confirms native quiescence and releases the retained writer.
  await eventually(async () => {
    const current = await invoke("abra_work_status", { issue_id: issue.id });
    return current.execution.stop_status === "confirmed" ? current.execution : undefined;
  });
  const resumed = await invoke("abra_work_control", { issue_id: issue.id, action: "resume" });
  assert.equal(resumed.current_phase, "awaiting_plan_approval");
  assert.equal(resumed.explore_session_id, e.explore_session_id);
  const pending = await invoke("abra_work_approve", { issue_id: issue.id, kind: "plan" });
  assert.equal(pending.approval_required, true);
  // A manual edit does not retarget retained work or authorize a pending form.
  const activeConfiguration = parseDocument(await readFile(personalPath, "utf8"));
  activeConfiguration.setIn(["models", "default", "variant"], "default");
  const declared = activeConfiguration.toJS().repositories as Array<{ id: string }>;
  activeConfiguration.set(
    "repositories",
    activeConfiguration.createNode(declared.filter((d) => d.id !== "api")),
  );
  await writeFile(personalPath, activeConfiguration.toString());
  const omitted = await client
    .rpc(portableRpc(configuration))
    .reconcile({ session_id: supervisor.id, action: "status" }, loc);
  assert.equal(omitted.outcomes.find((d) => d.id === "api")?.status, "retained/undeclared");
  assert.equal(
    (await invoke("abra_work_status", { issue_id: issue.id })).execution.worktree_directory,
    e.worktree_directory,
  );
  activeConfiguration.set("repositories", activeConfiguration.createNode(declared));
  // Later finishing acceptance observes a real exhausted stall under a short
  // fixture-only watchdog; initial authentication/attention checks use defaults.
  activeConfiguration.set("progress_timeout_ms", {
    explore: 500,
    apply: 1800000,
    review: 900000,
    research: 900000,
    operation: 300000,
  });
  await writeFile(personalPath, activeConfiguration.toString());
  const applied = await client
    .rpc(portableRpc(configuration))
    .reconcile({ session_id: supervisor.id, action: "apply" }, loc);
  assert.equal(applied.outcomes.find((d) => d.id === "api")?.status, "registered/ready");
  const preSuitePath = await capturePreSuite(
    client,
    (await invoke("abra_work_status", { issue_id: issue.id })).execution,
    home,
  );
  const retainedAgent = await client.session.get({ sessionID: e.explore_session_id! });
  const retainedProfile = (await client.agent.list({ location: retainedAgent.location })).data.find(
    (agent) => agent.id === retainedAgent.agent,
  )!;
  const counterValue = Schema.decodeUnknownSync(
    Schema.Struct({ counts: Schema.Record(Schema.String, Schema.Finite) }),
  );
  const preparationCounts =
    journey === "engineering"
      ? counterValue(await client.rpc(agentFixture).counts({}, loc)).counts
      : undefined;
  const retainedPrompt = (await invoke("abra_work_status", { issue_id: issue.id })).execution
    .prompt_id;
  if (journey === "engineering") {
    assert.ok(preparationCounts![issue.id] >= 1);
    Schema.decodeUnknownSync(Schema.Struct({ value: Schema.Null }))(
      await api.storage({ key: "specialist-preparations" }, loc),
    );
    const sourcePath = join(home, "packages/agents/assets/explore.md");
    await writeFile(
      sourcePath,
      (await readFile(sourcePath, "utf8")) + "\nNative static source changed after capture.\n",
    );
    const laterSourcePath = join(home, "packages/agents/assets/apply.md");
    await writeFile(
      laterSourcePath,
      (await readFile(laterSourcePath, "utf8")) +
        "\nNative later role source changed after snapshot.\n",
    );
  }
  await restart();
  const recovered = await invoke("abra_work_status", { issue_id: issue.id });
  assert.equal(recovered.execution.current_phase, "awaiting_plan_approval");
  engineeringEvidence.push(
    await assertPreSuiteAfterRestart(
      recovered.execution,
      home,
      preSuitePath,
      `http://127.0.0.1:${port}`,
      password,
    ),
  );
  if (journey === "engineering") {
    const inventory = (await client.agent.list({ location: retainedAgent.location })).data;
    assert.equal(
      inventory.find((agent) => agent.id === retainedAgent.agent)?.system,
      retainedProfile.system,
    );
    assert.ok(
      inventory.some(
        (agent) =>
          agent.id !== retainedAgent.agent &&
          agent.id.startsWith("abra-engineering-specialist-") &&
          agent.system?.includes("Native static source changed after capture."),
      ),
    );
    const afterCounts = counterValue(await client.rpc(agentFixture).counts({}, loc)).counts;
    assert.deepEqual(afterCounts, preparationCounts);
    assert.equal(recovered.execution.prompt_id, retainedPrompt);
    assert.equal(recovered.execution.worker_context_id, retainedPrompt);
    engineeringEvidence.push({
      agent_capture_restart: {
        native_id: retainedAgent.agent,
        definition: "engineering-specialist",
        profile_revision: retainedAgent.agent?.slice(-64),
        prompt_id: retainedPrompt,
        provider_counts_before: preparationCounts,
        provider_counts_after: afterCounts,
        static_profile_unchanged: true,
        current_source_revision_distinct: true,
        no_duplicate_admission: true,
      },
    });
  }
  assert.equal(recovered.execution.worktree_directory, e.worktree_directory);
  assert.equal(recovered.execution.explore_session_id, e.explore_session_id);
  assert.equal(recovered.execution.configuration_snapshot.workers.explore.model.variant, undefined);
  assert.equal(
    recovered.execution.configuration_snapshot.digest,
    resumed.configuration_snapshot.digest,
  );
  assert.equal(
    (await client.session.form.list({ sessionID: supervisor.id })).some(
      (form) => form.id === pending.form_id,
    ),
    true,
  );
  await invoke("abra_work_approve", { issue_id: issue.id, kind: "plan" });
  if (journey === "engineering") {
    controls.holdApply = true;
    controls.applyHeld = false;
  }
  await client.session.form.reply({
    sessionID: supervisor.id,
    formID: pending.form_id,
    answer: { authorize: true },
  });
  if (journey === "engineering") {
    await eventually(async () => (controls.applyHeld ? true : undefined));
    try {
      const applying = (await invoke("abra_work_status", { issue_id: issue.id })).execution;
      assert.equal(applying.active_role, "apply");
      await assert.rejects(
        api.invoke(
          {
            tool: "inspect-specialist",
            args: { task: issue.id },
            session: applying.apply_session_id,
            message: applying.prompt_id,
          },
          { location: { directory: applying.worktree_directory } },
        ),
        (error: any) => error.type === "action_failed" && error.data.code === "AGENT_TOOL",
      );
      engineeringEvidence.push({
        native_contribution_wrong_role: {
          role: "apply",
          denied: true,
          prompt_id: applying.prompt_id,
        },
      });
    } finally {
      controls.releaseApply?.();
      controls.releaseApply = undefined;
      controls.applyHeld = false;
    }
  }
  const done = (await eventually(async () => {
    if (!(await atPhase(issue.id, "completed"))) return undefined;
    const s = await invoke("abra_work_status", { issue_id: issue.id });
    if (["blocked", "failed", "recovery_required"].includes(s.execution.current_phase))
      throw Error(JSON.stringify(s));
    if (s.execution.current_phase === "completed") return s.execution;
    throw Error(JSON.stringify(s));
  }, 40000)) as Execution;
  assert.ok(done.apply_session_id && done.review_session_id);
  assert.equal(
    await run(
      git.run(Id.AbsolutePath.make(managedAPI.path), [
        "show",
        `${done.delivered_commit}:AGENTS.md`,
      ]),
    ),
    "Repository navigation: source.txt implements the sample.",
  );
  await assertBrowserWorker(client, home, done.apply_session_id);
  await assertBrowserWorker(client, home, done.review_session_id);
  engineeringEvidence.push(await assertEngineeringWorker(client, done.apply_session_id, "apply"));
  engineeringEvidence.push(await assertEngineeringWorker(client, done.review_session_id, "review"));
  const deliveredFiles = await run(
    git.run(Id.AbsolutePath.make(managedAPI.path), [
      "ls-tree",
      "-r",
      "--name-only",
      done.delivered_commit!,
    ]),
  );
  assert.ok(
    !deliveredFiles
      .split("\n")
      .some(
        (file) =>
          file === "GLOSSARY.md" ||
          file.startsWith("docs/verification/") ||
          file.startsWith(".cursor/"),
      ),
  );
  engineeringEvidence.push({
    verification: done.verification_receipt,
    review: done.review_receipt,
    outcome: done.current_phase,
  });
  await browserIsolation(
    home,
    [e.explore_session_id!, done.apply_session_id],
    `http://127.0.0.1:${address.port}`,
  );
  const nextQueue = await invoke("abra_work_ready", {});
  assert.equal(nextQueue.find((row: any) => row.issue.id === frontendIssue.id).eligible, true);
  assert.equal(nextQueue.find((row: any) => row.issue.id === workerIssue.id).eligible, false);
  assert.equal(
    (await client.session.get({ sessionID: done.apply_session_id! })).location.directory,
    e.worktree_directory,
  );
  assert.equal((await invoke("abra_work_status", { issue_id: issue.id })).issue.status, "closed");
  assert.equal(
    (
      await client.worktree.list({
        projectID: (await client.location.get({ location: { directory: managedAPI.path } })).project
          .id,
      })
    ).some((w) => w.directory === e.worktree_directory),
    false,
  );
  if ((!journey && process.env.ABRACODE_TEST_COMBINED !== "1") || journey === "core") {
    await restartWithOverrides(h, { issue, nativeAttention });
    await workerContextCapabilities({
      root,
      git,
      invoke,
      eventually,
      providerCalls: () => controls.missingToolProviderCalls,
    });
    return;
  }
  const research = await runResearchContracts(h, companions, {
    issue,
    configDigest: recovered.execution.configuration_snapshot.digest,
  });
  // A recipe may drive just this complete journey; the default suite still exercises all PR/finishing assertions.
  if (journey === "engineering") {
    engineeringEvidence.push({
      journey: "engineering",
      complete: true,
      limitation: "PR-feedback and post-merge residue scenarios belong to the full native run",
    });
    return;
  }
  await runFinishing(h, { issue, nativeAttention, ...research });

  await workerContextCapabilities({
    root,
    git,
    invoke,
    eventually,
    providerCalls: () => controls.missingToolProviderCalls,
  });
  if (process.env.ABRACODE_TEST_COMBINED === "1")
    engineeringEvidence.push(await companions.runAcceptance());
}
