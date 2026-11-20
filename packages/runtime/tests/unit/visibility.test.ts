import { goal as workGoal } from "../helpers/work-goal.ts";
import * as Id from "../../src/identities.ts";
import { CrewError } from "../../src/domain.ts";
import { run } from "../effects.ts";
import { domainEffect } from "../../src/effect.ts";
import { Effect } from "effect";
import { test, vi } from "vite-plus/test";
import assert from "node:assert/strict";
import { mkdir, rename, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fixture, planned, applying } from "../fixtures.ts";
import * as documents from "../../src/visibility/documents.ts";
import { Visibility } from "../../src/visibility/read-model.ts";
import { visibility } from "../../src/visibility/protocol.ts";
test("observer joins WorkGraph, blockers and role sessions without advancing a waiting plan", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(planned(f));
  f.seed.named(Id.IssueId.make("abra-2"), Id.RepositoryId.make("frontend"), [e.issue_id]);
  const before = await run(f.records.execution(e.issue_id));
  const view = new Visibility(f.controller);
  const snapshot = await run(view.snapshot());
  const active = snapshot.work.find((w) => w.issue_id === e.issue_id)!;
  assert.equal(active.issue_status, "in_progress");
  assert.equal(active.phase, "awaiting_plan_approval");
  assert.deepEqual(active.sessions, [{ id: e.explore_session_id, role: "explore" }]);
  assert.match(snapshot.work.find((w) => w.issue_id === "abra-2")!.blockers.join(" "), /abra-1/);
  const detail = await run(view.detail(e.issue_id));
  assert.equal(detail.change, e.openspec_change);
  assert.equal(detail.progress?.complete, 0);
  assert.deepEqual(await run(f.records.execution(e.issue_id)), before);
  assert.equal(f.runtime.creates, 1);
  assert.equal(f.runtime.forms.size, 0);
  assert.ok("value" in (await visibility.methods.snapshot.output["~standard"].validate(snapshot)));
  assert.ok("value" in (await visibility.methods.detail.output["~standard"].validate(detail)));
});
test("overview observes one ticket without reading planning evidence, even with a missing worktree", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(planned(f)),
    view = new Visibility(f.controller);
  const status = f.spec.status.bind(f.spec);
  f.spec.status = (execution) =>
    status(execution).pipe(
      Effect.map((s) => ({
        ...s,
        artifacts: [
          {
            id: Id.ArtifactId.make("proposal"),
            status: "done" as const,
            outputPath: Id.RelativePath.make("proposal.md"),
          },
        ],
      })),
    );
  const task = vi.spyOn(f.controller.queries, "observeTask");
  const planning = [
    vi.spyOn(f.controller.queries, "specStatus"),
    vi.spyOn(f.controller.queries, "specApply"),
    vi.spyOn(f.controller.queries, "planDocuments"),
    vi.spyOn(documents, "changeDocument"),
  ];
  t.onTestFinished(() => {
    for (const spy of planning) spy.mockRestore();
  });
  const overview = await run(view.overview(e.issue_id));
  assert.deepEqual(Object.keys(overview).sort(), ["description", "errors", "work"]);
  assert.ok("value" in (await visibility.methods.overview.output["~standard"].validate(overview)));
  assert.equal(task.mock.calls.length, 1);
  assert.deepEqual(
    planning.map((spy) => spy.mock.calls.length),
    [0, 0, 0, 0],
  );
  const full = await run(view.detail(e.issue_id));
  assert.equal(task.mock.calls.length, 2);
  assert.equal(full.description, overview.description);
  assert.deepEqual(
    planning.map((spy) => spy.mock.calls.length),
    [1, 1, 1, 1],
  );
  await rename(e.worktree_directory!, e.worktree_directory! + "-unavailable");
  assert.deepEqual((await run(view.overview(e.issue_id))).errors, []);
  assert.deepEqual(
    planning.map((spy) => spy.mock.calls.length),
    [1, 1, 1, 1],
  );
});
test("proposal reads the owned worktree and schema artifact path, rejecting escaping symlinks", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(planned(f));
  const status = f.spec.status.bind(f.spec);
  f.spec.status = (execution) =>
    domainEffect(
      Effect.gen(function* () {
        return {
          ...(yield* status(execution)),
          artifacts: [
            {
              id: Id.ArtifactId.make("proposal"),
              status: "done",
              outputPath: Id.RelativePath.make("proposal.md"),
            },
          ],
        };
      }),
    );
  const view = new Visibility(f.controller);
  const path = join(e.worktree_directory!, "openspec/changes", e.openspec_change, "proposal.md");
  assert.equal((await run(view.detail(e.issue_id))).proposal, await readFile(path, "utf8"));
  const outside = join(f.root, "outside.txt");
  await writeFile(outside, "Do not expose this unrelated file");
  await rm(path);
  await symlink(outside, path);
  const denied = await run(view.detail(e.issue_id));
  assert.equal(denied.proposal, undefined);
  assert.match(denied.errors.join(" "), /escapes/);
  assert.ok(!JSON.stringify(denied).includes("Do not expose"));
  assert.throws(() => Id.IssueId.make("../outside"), /Schema validation/);
});
test("queued and retired work do not invoke OpenSpec; large proposals are bounded", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  f.seed.named(Id.IssueId.make("abra-queued"));
  const view = new Visibility(f.controller);
  assert.equal((await run(view.detail(Id.IssueId.make("abra-queued")))).change, undefined);
  const e = await run(planned(f));
  const status = f.spec.status.bind(f.spec);
  f.spec.status = (execution) =>
    domainEffect(
      Effect.gen(function* () {
        return {
          ...(yield* status(execution)),
          artifacts: [
            {
              id: Id.ArtifactId.make("proposal"),
              status: "done",
              outputPath: Id.RelativePath.make("proposal.md"),
            },
          ],
        };
      }),
    );
  await writeFile(
    join(e.worktree_directory!, "openspec/changes", e.openspec_change, "proposal.md"),
    "x".repeat(70 * 1024),
  );
  assert.equal(
    (await run(view.detail(e.issue_id))).proposal,
    "x".repeat(64 * 1024) + "\n[Proposal truncated at 64 KiB]",
  );
  e.archive_path = Id.RelativePath.make(`openspec/changes/archive/2026-10-14-${e.openspec_change}`);
  e.delivered_commit ??= await run(f.git.head(e.worktree_directory!));
  e.delivery_receipt = {
    commit: e.delivered_commit,
    target: e.target_branch!,
    at: Id.Timestamp.make(new Date().toISOString()),
  };
  e.current_phase = "completed";
  await run(f.records.save(e));
  await run(f.work.close(e.issue_id, e.execution_id));
  f.spec.status = () =>
    domainEffect(
      Effect.fail(new CrewError("FIXTURE_FAILURE", "Retired worktree must not be read")),
    );
  const archived = await run(view.detail(e.issue_id));
  assert.equal(archived.archive, e.archive_path);
  assert.match(archived.errors.join(" "), /No regular Markdown planning documents/);
  assert.equal(
    (await run(view.snapshot())).work.find((w) => w.issue_id === e.issue_id)?.issue_status,
    "closed",
  );
});

test("document selection stays inside the planning change and retired work is paged with conflicts visible", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(planned(f));
  const view = new Visibility(f.controller);
  const detail = await run(view.detail(e.issue_id));
  assert.ok(detail.documents?.includes(Id.RelativePath.make("design.md")));
  assert.ok(detail.documents?.includes(Id.RelativePath.make("specs/sample/spec.md")));
  assert.match(
    (await run(view.document(e.issue_id, Id.RelativePath.make("design.md")))).content,
    /Return a sample/,
  );
  assert.match(
    (await run(view.document(e.issue_id, Id.RelativePath.make("specs/sample/spec.md")))).content,
    /Sample behavior/,
  );
  await assert.rejects(
    run(view.document(e.issue_id, Id.RelativePath.make("../../../../source.txt"))),
    /owned change/,
  );
  const outside = join(f.root, "private.md");
  await writeFile(outside, "private planning content");
  await symlink(
    outside,
    join(e.worktree_directory!, "openspec/changes", e.openspec_change, "escape.md"),
  );
  await assert.rejects(
    run(view.document(e.issue_id, Id.RelativePath.make("escape.md"))),
    /owned change/,
  );
  for (let i = 0; i < 56; i++) {
    const id = `closed-${String(i).padStart(2, "0")}`;
    f.seed.named(Id.IssueId.make(id));
    f.seed.close(id);
  }
  // A closed ticket with a live execution is attention work on every history page.
  f.seed.close(e.issue_id);
  const first = await run(view.snapshot());
  const second = await run(view.snapshot(1));
  assert.equal(first.closed_total, 56);
  assert.equal(first.work.filter((w) => w.issue_id.startsWith("closed-")).length, 50);
  assert.equal(second.work.filter((w) => w.issue_id.startsWith("closed-")).length, 6);
  assert.equal(second.work.find((w) => w.issue_id === e.issue_id)?.issue_status, "closed");
  assert.equal(second.work.find((w) => w.issue_id === e.issue_id)?.phase, "awaiting_plan_approval");
  assert.equal((await run(view.snapshot(100))).closed_page, 1);
});

test("older closed issue detail preserves communication counts outside the loaded history page", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(planned(f));
  const at = Id.Timestamp.make("2026-10-01T00:00:00.000Z");
  const request = {
    schema_version: 1 as const,
    assignment_id: e.prompt_id!,
    generation: e.control_generation,
    sender_session_id: e.supervisor_session_id!,
    recipient_session_id: e.explore_session_id!,
    role: "explore" as const,
    prompt: "Retained historical question",
    delivery: "queue" as const,
    response: "answer" as const,
    created_at: at,
    acknowledged_at: at,
  };
  e.messages = [
    {
      ...request,
      request_id: Id.RequestId.make("answered"),
      prompt_id: Id.MessageId.make("msg_answered"),
      status: "answered",
      reply: { body: "Retained answer", at, evidence: [] },
    },
    {
      ...request,
      request_id: Id.RequestId.make("awaiting-answer"),
      prompt_id: Id.MessageId.make("msg_awaiting"),
      status: "acknowledged",
    },
    {
      ...request,
      request_id: Id.RequestId.make("acknowledged"),
      prompt_id: Id.MessageId.make("msg_acknowledged"),
      response: "acknowledgement",
      status: "acknowledged",
    },
  ];
  e.current_phase = "completed";
  e.delivered_commit = await run(f.git.head(e.worktree_directory!));
  e.delivery_receipt = { commit: e.delivered_commit, target: e.target_branch!, at };
  await run(f.records.save(e));
  await run(f.work.close(e.issue_id, e.execution_id));
  const retained = (await run(f.records.execution(e.issue_id)))!;
  const newer = Array.from({ length: 51 }, (_, n) => {
    const id = Id.IssueId.make(`newer-closed-${n}`);
    f.seed.named(id);
    f.seed.close(id);
    return { ...retained, issue_id: id, messages: undefined };
  });
  const empty = Id.IssueId.make("closed-without-execution");
  f.seed.named(empty);
  f.seed.close(empty);
  const bundle = await run(f.controller.queries.observe());
  // Supply retained completion timestamps through the existing read-model seam;
  // no additional native workers or worktrees are needed for historical rows.
  bundle.executions = [{ ...retained, updated_at: at }, ...newer];
  f.controller.queries.observe = () => Effect.succeed(bundle);
  f.runtime.session = () => {
    throw Error("Closed history must not inspect native sessions");
  };
  f.runtime.promptAdmissions = () => {
    throw Error("Summary must not inspect message admissions");
  };
  const view = new Visibility(f.controller);
  const firstPage = await run(view.snapshot());
  const attention = firstPage.fleet?.attention.find(
    (item) => item.issue_id === e.issue_id && item.key === "communication",
  );
  assert.equal(attention?.owner, "request recipient");
  assert.match(attention?.next_action ?? "", /response-recovery/);
  assert.equal(
    firstPage.work.some((item) => item.issue_id === e.issue_id),
    false,
  );
  const before = await run(f.records.export());
  const effects = {
    prompts: f.runtime.prompts,
    creates: f.runtime.creates,
    forms: f.runtime.forms.size,
  };
  assert.equal(
    (await run(view.snapshot())).work.some((w) => w.issue_id === e.issue_id),
    false,
  );
  const visible = (await run(view.snapshot(1))).work.find((w) => w.issue_id === e.issue_id)!;
  const detail = await run(view.detail(e.issue_id));
  assert.deepEqual(detail.work.communication, { total: 3, outstanding: 1 });
  assert.deepEqual(detail.work.communication, visible.communication);
  assert.deepEqual((await run(view.detail(empty))).work.communication, {
    total: 0,
    outstanding: 0,
  });
  const selected = await run(f.controller.queries.observeTask(e.issue_id));
  const observeTask = f.controller.queries.observeTask.bind(f.controller.queries);
  f.controller.queries.observeTask = (id) =>
    id === e.issue_id
      ? Effect.succeed({ ...selected, execution: { ...selected.execution!, messages: undefined } })
      : observeTask(id);
  assert.deepEqual((await run(view.detail(e.issue_id))).work.communication, {
    total: 0,
    outstanding: 0,
  });
  assert.deepEqual(await run(f.records.export()), before);
  assert.deepEqual(
    { prompts: f.runtime.prompts, creates: f.runtime.creates, forms: f.runtime.forms.size },
    effects,
  );
  assert.ok("value" in (await visibility.methods.detail.output["~standard"].validate(detail)));
});

test("bounded supervision projection preserves record history and exposes read-only report access", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(planned(f));
  e.decisions = Array.from({ length: 25 }, (_, i) => ({
    schema_version: 1,
    key: Id.ObligationKey.make(`question-${i}`),
    generation: 0,
    scope: "Implementation",
    question: `Question ${i}`,
    owner: "user",
    session_id: e.explore_session_id!,
    opened_at: i,
    status: "open",
  }));
  e.progress = {
    schema_version: 1,
    generation: 0,
    session_id: e.explore_session_id!,
    at: 30,
    summary: "Meaningful progress",
    source: "worker",
  };
  await run(f.records.save(e));
  const before = await run(f.records.execution(e.issue_id));
  const view = new Visibility(f.controller);
  const item = (await run(view.snapshot())).work.find((w) => w.issue_id === e.issue_id)!;
  assert.equal(item.decisions!.length, 20);
  assert.equal(item.decision_count, 25);
  assert.equal(item.progress!.summary, "Meaningful progress");
  assert.ok(item.policy_summary);
  assert.ok(item.operation);
  assert.deepEqual(await run(f.records.execution(e.issue_id)), before);
  assert.deepEqual(Object.keys(visibility.methods).sort(), [
    "binding",
    "detail",
    "diff",
    "document",
    "evidence",
    "feedback",
    "find",
    "leads",
    "messages",
    "overview",
    "report",
    "snapshot",
    "verification",
    "worker",
  ]);
});

test("task detail avoids collection scans and fleet observations scan once with fresh data", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(planned(f));
  const counts = { project: 0, execution: 0, setup: 0 };
  const project = f.records.projectScan.bind(f.records),
    execution = f.records.executionScan.bind(f.records),
    setup = f.records.setupScan.bind(f.records);
  f.records.projectScan = () => {
    counts.project++;
    return project();
  };
  f.records.executionScan = () => {
    counts.execution++;
    return execution();
  };
  f.records.setupScan = () => {
    counts.setup++;
    return setup();
  };
  const view = new Visibility(f.controller);
  await run(view.detail(e.issue_id));
  assert.deepEqual(counts, { project: 0, execution: 0, setup: 0 });
  f.seed.named(Id.IssueId.make("later"));
  assert.ok((await run(view.snapshot())).work.some((w) => w.issue_id === "later"));
  assert.deepEqual(counts, { project: 1, execution: 1, setup: 1 });
});

test("commit invalidations observe durable evidence and failed writes do not enqueue", async (t) => {
  const { Invalidations } = await import("../../src/visibility/invalidations.ts");
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(planned(f));
  let commits = 0;
  const events = {
    committed: f.records.execution(e.issue_id).pipe(
      Effect.tap((saved) =>
        Effect.sync(() => {
          assert.ok(saved);
          commits++;
        }),
      ),
      Effect.asVoid,
      Effect.orDie,
    ),
    publish: () => events.committed,
    take: Effect.never,
  };
  await run(f.records.save(e).pipe(Effect.provideService(Invalidations, events)));
  assert.equal(commits, 1);
  const stale = { ...e, control_generation: e.control_generation + 10 };
  await assert.rejects(
    run(f.records.save(stale).pipe(Effect.provideService(Invalidations, events))),
    /generation/,
  );
  assert.equal(commits, 1);
});

test("retired planning reads exact archive blobs and excludes symbolic links and live replacements", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(planned(f));
  const tree = e.worktree_directory!;
  e.archive_path = Id.RelativePath.make(`openspec/changes/archive/2026-11-15-${e.openspec_change}`);
  const archive = join(tree, e.archive_path);
  await mkdir(join(tree, "openspec/changes/archive"), { recursive: true });
  await rename(join(tree, "openspec/changes", e.openspec_change), archive);
  await writeFile(
    join(archive, "proposal.md"),
    "# The delivered plan\n\nOriginal retained evidence.\n",
  );
  await writeFile(join(archive, "large.md"), "x".repeat(65537));
  await symlink("/unrelated/secret.md", join(archive, "foreign.md"));
  await run(f.git.run(tree, ["add", "."]));
  await run(f.git.run(tree, ["commit", "-m", "Retain planning archive"]));
  e.delivered_commit = await run(f.git.head(tree));
  e.delivery_receipt = {
    commit: e.delivered_commit,
    target: e.target_branch!,
    at: Id.Timestamp.make(new Date().toISOString()),
  };
  e.current_phase = "completed";
  await run(f.records.save(e));
  await run(f.work.close(e.issue_id, e.execution_id));
  const project = (await run(f.records.project(e.repository_id)))!;
  await run(f.runtime.removeWorktree(project, e));
  // A similarly named checkout file must never replace a captured commit blob.
  const replacement = join(project.path, e.archive_path);
  await mkdir(replacement, { recursive: true });
  await writeFile(join(replacement, "proposal.md"), "Uncommitted replacement");
  const before = await run(f.records.execution(e.issue_id));
  const view = new Visibility(f.controller);
  const detail = await run(view.detail(e.issue_id));
  assert.equal(detail.planning?.source, "archive");
  assert.equal(detail.planning?.commit, e.delivered_commit);
  assert.ok(detail.documents?.includes(Id.RelativePath.make("proposal.md")));
  assert.ok(!detail.documents?.includes(Id.RelativePath.make("foreign.md")));
  assert.deepEqual(detail.errors, []);
  const document = await run(view.document(e.issue_id, Id.RelativePath.make("proposal.md")));
  assert.equal(document.content, "# The delivered plan\n\nOriginal retained evidence.\n");
  await assert.rejects(
    run(view.document(e.issue_id, Id.RelativePath.make("foreign.md"))),
    /Select a document/,
  );
  await assert.rejects(run(view.document(e.issue_id, Id.RelativePath.make("large.md"))), /64 KiB/);
  await assert.rejects(
    run(view.document(e.issue_id, Id.RelativePath.make("../../private.md"))),
    /Select a document/,
  );
  assert.deepEqual(await run(f.records.execution(e.issue_id)), before);
  e.archive_path = Id.RelativePath.make("openspec/changes/archive/2026-11-15-another-change");
  await run(f.records.save(e));
  const foreign = await run(view.detail(e.issue_id));
  assert.match(foreign.errors.join(" "), /does not belong/);
  assert.equal(foreign.work.issue_id, e.issue_id);
  assert.equal(foreign.documents, undefined);
});

test("lightweight and research inspection uses scope without manufacturing OpenSpec progress", async (t) => {
  for (const policy of ["lightweight-fix", "research-only"] as const) {
    const f = await run(fixture);
    t.onTestFinished(() => run(f.close()));
    const project = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
    project.openspec = false;
    await run(f.records.saveProject(project));
    f.spec.status = () =>
      Effect.fail(new CrewError("UNEXPECTED", "Scoped work must not read OpenSpec"));
    const view = new Visibility(f.controller);
    const created = await run(
      f.controller.createWork(
        {
          repository_id: project.id,
          title: `Inspect ${policy}`,
          description: "Scope-owned task",
          workflow_policy: policy,
          scope: {
            goal: "Describe the owner",
            acceptance: ["Preserve observed evidence"],
            constraints: ["Do not fabricate progress"],
          },
          request_id: Id.RequestId.make(`inspection-${policy}`),
        },
        Id.SessionId.make("ses_supervisor"),
      ),
    );
    await run(f.controller.start(created.issue.id));
    const detail = await run(view.detail(created.issue.id));
    assert.equal(detail.work.policy, policy);
    assert.equal(detail.progress, undefined);
    assert.equal(detail.change, undefined);
    assert.equal(detail.documents, undefined);
    assert.match(detail.proposal!, /Describe the owner/);
    assert.match(
      detail.proposal!,
      policy === "research-only" ? /Research contract/ : /Lightweight scope/,
    );
    assert.deepEqual(detail.errors, []);
  }
});

test("schema, approval provenance and repair observations preserve exact pending authority and legacy absence", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const p = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
  p.plan_approval = false;
  p.repair_rounds = 2;
  await run(f.records.saveProject(p));
  f.config.supervision_mode = "attended-automatic";
  const e = await run(
    planned(f, Id.IssueId.make("contract-observation"), {
      openspec_schema: Id.SpecSchemaName.make("target-only"),
      require_plan_approval: true,
    }),
  );
  await run(f.controller.approve(e.issue_id, "plan", Id.SessionId.make("ses_supervisor")));
  const before = await run(f.records.execution(e.issue_id)),
    view = new Visibility(f.controller),
    detail = await run(view.detail(e.issue_id)),
    diagnostic = await run(f.controller.diagnostics(e.issue_id)),
    worker = await run(f.controller.queries.inspectWorker(e.issue_id, e.explore_session_id!)),
    contract = detail.work.execution_contract!;
  assert.deepEqual(contract, diagnostic.execution_contract);
  assert.deepEqual(contract, worker.execution_contract);
  assert.equal(contract.schema.state, "bound");
  assert.equal(contract.schema.state === "bound" && contract.schema.name, "target-only");
  assert.deepEqual(contract.plan_approval, { required: true, source: "task_requirement" });
  assert.deepEqual(contract.repair, { configured: 2, allowance: 2, consumed: 0, remaining: 2 });
  assert.equal("files" in contract.schema, false);
  assert.ok("value" in (await visibility.methods.detail.output["~standard"].validate(detail)));
  assert.deepEqual(await run(f.records.execution(e.issue_id)), before);
  assert.equal(f.runtime.forms.size, 1);
  assert.equal(f.runtime.prompts, 1);
  f.config.supervision_mode = "manual";
  assert.deepEqual((await run(f.controller.diagnostics(e.issue_id))).execution_contract.repair, {
    configured: 2,
    allowance: 0,
    consumed: 0,
    remaining: 0,
  });
  const legacy = { ...structuredClone(before!), effective_policy: { ...before!.effective_policy } };
  delete legacy.openspec_schema_binding;
  delete legacy.effective_policy.plan_approval_source;
  await run(f.records.store.set(Id.StorageKey.make(`execution/${e.issue_id}`), legacy));
  const observed = await run(view.detail(e.issue_id));
  assert.deepEqual(observed.work.execution_contract?.schema, {
    state: "unavailable",
    reason: "legacy_record",
  });
  assert.deepEqual(observed.work.execution_contract?.plan_approval, {
    required: true,
    source: "unavailable",
  });
  assert.deepEqual(await run(f.records.execution(e.issue_id)), legacy);
  assert.equal(f.runtime.forms.size, 1);
  assert.equal(f.runtime.prompts, 1);
});

test("selected task among unrelated active workers performs no scans, fleet readiness or unrelated native/lead reads", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const base = await run(applying(f));
  for (let index = 0; index < 75; index++) {
    const id = Id.IssueId.make(`unrelated-${index}`);
    f.seed.named(id);
    await run(
      f.records.create({
        ...structuredClone(base),
        issue_id: id,
        execution_id: Id.ExecutionId.make(`exec-unrelated-${index}`),
        apply_session_id: Id.SessionId.make(`ses_unrelated-${index}`),
      }),
    );
  }
  const session = f.runtime.session.bind(f.runtime);
  const sessions: string[] = [];
  f.runtime.session = (id) => {
    sessions.push(id);
    assert.equal(
      id,
      base.apply_session_id,
      "Only the selected task's active native session may be observed",
    );
    return session(id);
  };
  f.records.store.entries = () =>
    Effect.fail(new CrewError("UNRELATED_SCAN", "Task detail must not scan unrelated records"));
  f.controller.queries.ready = () =>
    Effect.fail(new CrewError("FLEET_READY", "Task detail must not compute fleet readiness"));
  f.controller.queries.leadOverview = () =>
    Effect.fail(new CrewError("LEAD_SCAN", "Task detail must not read lead history"));
  const detail = await run(new Visibility(f.controller).detail(base.issue_id));
  assert.equal(detail.work.issue_id, base.issue_id);
  assert.equal(detail.work.phase, "applying");
  assert.equal(detail.work.eligibility_observed, false);
  assert.equal(detail.work.eligible, false);
  assert.deepEqual(sessions, [base.apply_session_id]);
  assert.ok("value" in (await visibility.methods.detail.output["~standard"].validate(detail)));
});

test("selected detail keeps unavailable native activity and malformed retained evidence local", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const base = await run(applying(f));
  const session = f.runtime.session.bind(f.runtime);
  f.runtime.session = (id) =>
    id === base.apply_session_id
      ? Effect.fail(new CrewError("WORKER_UNAVAILABLE", "Selected native activity unavailable"))
      : session(id);
  const view = new Visibility(f.controller);
  const unavailable = await run(view.detail(base.issue_id));
  assert.equal(unavailable.work.phase, "applying");
  assert.equal(unavailable.work.supervision?.native_activity, "unavailable");
  const { id: healthy } = await run(f.work.create(workGoal("healthy-unstarted")));
  const key = Id.StorageKey.make(`execution/${base.issue_id}`);
  const future = { ...structuredClone(base), schema_version: 99 };
  await run(f.records.store.set(key, future));
  const malformed = await run(view.detail(base.issue_id));
  assert.equal(malformed.work.phase, "recovery_required");
  assert.equal(malformed.work.supervision?.native_activity, "unavailable");
  assert.match(malformed.errors.join(" "), /Unsupported record version/);
  assert.equal((await run(view.detail(healthy))).work.issue_id, healthy);
  assert.deepEqual(await run(f.records.store.get(key)), future);
});

test("binding summaries resolve off-page retained tasks without fleet, worker or planning reads", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  for (let i = 0; i < 55; i++) {
    const id = Id.IssueId.make(`abra-closed-${String(i).padStart(2, "0")}`);
    f.seed.named(id);
    f.seed.close(id);
  }
  const view = new Visibility(f.controller);
  assert.equal(
    (await run(view.snapshot())).work.some((row) => row.issue_id === "abra-closed-54"),
    false,
  );
  let unrelated = 0;
  const forbidden = () => {
    unrelated++;
    return Effect.fail(new CrewError("TEST", "Unrelated read"));
  };
  f.controller.queries.ready = forbidden;
  f.controller.queries.supervisionAggregate = forbidden;
  f.controller.queries.inspectWorker = forbidden;
  f.controller.queries.planDocuments = forbidden;
  const id = Id.IssueId.make("abra-closed-54"),
    missing = Id.IssueId.make("abra-foreign");
  const result = await run(view.binding({ issue_ids: [id, id, missing] }));
  assert.deepEqual(
    result.work.map((row) => row.issue_id),
    [id],
  );
  assert.equal(result.work[0]!.issue_status, "closed");
  assert.deepEqual(result.coverage.unavailable_ids, [missing]);
  assert.equal(result.coverage.status, "unavailable");
  assert.deepEqual(
    result.results.map((entry) => entry.status),
    ["available", "missing"],
  );
  const all = await run(view.binding({ issue_ids: [id], include_population: true }));
  assert.equal(all.work.length, 55);
  assert.equal(all.coverage.total, 55);
  assert.equal(unrelated, 0);
  await assert.rejects(
    run(view.binding({ issue_ids: Array.from({ length: 101 }, () => id) })),
    /binding read/,
  );
  const observe = f.controller.queries.observeTask;
  const broken = Id.IssueId.make("abra-closed-53");
  f.controller.queries.observeTask = (id, history) =>
    id === broken
      ? Effect.fail(new CrewError("STORAGE", "Unavailable retained evidence"))
      : observe(id, history);
  const partial = await run(view.binding({ issue_ids: [id, broken] }));
  assert.equal(partial.work.length, 1);
  assert.equal(partial.coverage.status, "unavailable");
  assert.deepEqual(
    partial.results.map((entry) => entry.status),
    ["available", "unavailable"],
  );
  assert.equal(f.runtime.prompts, 0);
});

test("worker inspection reads only its ticket and admitted native session", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(applying(f));
  const foreign = Id.SessionId.make("ses_foreign");
  await run(
    f.records.create({
      ...e,
      issue_id: Id.IssueId.make("other-ticket"),
      execution_id: Id.ExecutionId.make("exec-other"),
      apply_session_id: foreign,
    }),
  );
  const current = e.apply_session_id!;
  const historical = e.explore_session_id!;
  delete e.explore_session_id;
  e.rounds = [
    {
      schema_version: 1,
      id: Id.RoundId.make("round-1"),
      ordinal: 1,
      generation: e.control_generation,
      source: "review",
      starting_head: e.base_commit!,
      plan_fingerprint: e.plan_fingerprint!,
      findings: [],
      instructions: "Apply review feedback",
      openspec_change: e.openspec_change,
      approval_receipts: e.approval_receipts,
      worker_sessions: [{ id: historical, role: "explore" }],
      created_at: 1,
    },
  ];
  await run(f.records.save(e));

  const read = vi.spyOn(f.records, "execution");
  const scans = vi.spyOn(f.records.store, "entries");
  const native = vi.spyOn(f.runtime, "session");
  const inspect = f.controller.queries.inspectWorker;
  for (const [id, role] of [
    [current, "apply"],
    [historical, "explore"],
  ] as const) {
    assert.equal((await run(inspect(e.issue_id, id))).role, role);
    assert.deepEqual(read.mock.calls, [[e.issue_id]]);
    assert.deepEqual(native.mock.calls, [[id]]);
    read.mockClear();
    native.mockClear();
  }
  const missing = Id.IssueId.make("missing-ticket");
  assert.equal((await run(Effect.flip(inspect(e.issue_id, foreign)))).code, "NOT_FOUND");
  assert.equal((await run(Effect.flip(inspect(missing, current)))).code, "EXECUTION_MISSING");
  assert.deepEqual(read.mock.calls, [[e.issue_id], [missing]]);
  assert.deepEqual(native.mock.calls, []);
  native.mockReturnValueOnce(Effect.fail(new CrewError("SESSION_MISSING", "Gone")));
  assert.equal((await run(Effect.flip(inspect(e.issue_id, current)))).code, "WORKER_UNAVAILABLE");
  assert.deepEqual(native.mock.calls, [[current]]);
  assert.deepEqual(scans.mock.calls, []);
});

test("a plan passage is bound to its occurrence, generation and exact document", async (t) => {
  const { captureSelection } = await import("../../src/web/capture-selection.ts");
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(planned(f));
  const file = Id.RelativePath.make("design.md");
  const document = join(e.worktree_directory!, "openspec/changes", e.openspec_change, file);
  await writeFile(document, "Same criterion\nFirst context\nSame criterion\nSecond context");
  const source = await run(new Visibility(f.controller).document(e.issue_id, file));
  const selection = {
    kind: "plan" as const,
    issue_id: e.issue_id,
    file,
    generation: source.generation!,
    hash: source.hash!,
    start: 3,
    end: 4,
  };
  assert.equal(
    await run(captureSelection(f.controller.queries, selection)),
    "Same criterion\nSecond context",
  );
  await assert.rejects(
    run(
      captureSelection(f.controller.queries, {
        ...selection,
        generation: selection.generation + 1,
      }),
    ),
    /changed/,
  );
  await writeFile(document, "Updated criteria");
  await assert.rejects(run(captureSelection(f.controller.queries, selection)), /changed/);
});
