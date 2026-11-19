import { retainedExecution } from "../helpers/retained-execution.ts";
import * as Id from "../../src/identities.ts";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { run } from "../effects.ts";
import { applying, delivered, fixture, planned, MemoryStore, TestLocks } from "../fixtures.ts";
import { Records } from "../../src/storage/store.ts";
import { Visibility } from "../../src/visibility/read-model.ts";

const originalOperation = {
  id: Id.OperationId.make("op-original"),
  generation: 0,
  fingerprint: Id.Fingerprint.make("original"),
  action: Id.OperationAction.make("advance"),
  status: "prepared" as const,
  expected: "advance execution",
  started_at: 0,
};

test("setup owned commits preserve newer capacity and independent evidence without replacing identity", async () => {
  const f = await retainedExecution();
  const original = f.execution;
  const setup = {
    ...original,
    setup: true as const,
    issue_id: Id.IssueId.make(`setup-${original.repository_id}`),
    openspec_change: "" as const,
  };
  await run(f.records.create(setup));
  const stale = structuredClone(setup);
  const peer = new Records(f.records.store);
  peer.coordinate(f.locks);
  const latest = (await run(peer.setup(setup.repository_id)))!;
  latest.retry_instructions = "Preserve setup recovery instructions";
  latest.capacity_observed_idle = true;
  await run(peer.saveSetupOwned(latest, ["retry_instructions", "capacity_observed_idle"]));
  stale.error_or_recovery_reason = "Delayed setup observation";
  await assert.rejects(run(f.records.saveSetup(stale)), /revision changed/);
  await run(f.records.saveSetupOwned(stale, ["error_or_recovery_reason"]));
  assert.equal(stale.retry_instructions, latest.retry_instructions);
  assert.equal(stale.capacity_observed_idle, true);
  const before = await run(f.records.store.get(Id.StorageKey.make(`setup/${setup.repository_id}`)));
  await assert.rejects(run(f.records.create(setup)), /already retained/);
  assert.deepEqual(
    await run(f.records.store.get(Id.StorageKey.make(`setup/${setup.repository_id}`))),
    before,
  );
});

test("preparing a new operation preserves concurrent evidence and rejects the displaced owner", async () => {
  const f = await retainedExecution({ operation: originalOperation });
  const e = f.execution;
  const displaced = structuredClone(e);
  await run(
    f.records.update(e.issue_id, (current) => ({
      ...current,
      retry_instructions: "New independent evidence",
    })),
  );
  const operation = {
    ...e.operation!,
    id: Id.OperationId.make("op-current-owner"),
    status: "prepared" as const,
  };
  await run(f.records.beginOperation(e, operation));
  assert.equal(e.retry_instructions, "New independent evidence");
  assert.equal(e.operation!.id, operation.id);
  const before = await run(f.records.store.get(Id.StorageKey.make(`execution/${e.issue_id}`)));
  const callerBefore = structuredClone(displaced);
  await assert.rejects(
    run(
      f.records.beginOperation(displaced, {
        ...operation,
        id: Id.OperationId.make("op-displaced-owner"),
      }),
    ),
    /superseded/,
  );
  assert.deepEqual(displaced, callerBefore);
  assert.deepEqual(
    await run(f.records.store.get(Id.StorageKey.make(`execution/${e.issue_id}`))),
    before,
  );
});

test("stale full replacement cannot erase newer retry instructions", async () => {
  const f = await retainedExecution();
  const e = f.execution;
  const stale = (await run(f.records.execution(e.issue_id)))!;
  await run(
    f.records.update(e.issue_id, (current) => ({
      ...current,
      retry_instructions: "Retain newer instructions",
    })),
  );
  const key = Id.StorageKey.make(`execution/${e.issue_id}`);
  const before = await run(f.records.store.get(key));
  stale.error_or_recovery_reason = "An unrelated late observation";
  const callerBefore = structuredClone(stale);
  await assert.rejects(
    run(f.records.save(stale)),
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "STALE_REVISION",
  );
  assert.deepEqual(await run(f.records.store.get(key)), before);
  assert.deepEqual(stale, callerBefore, "Rejected replacement must not mutate its caller");
  await assert.rejects(run(f.records.saveControl(stale)), /revision changed/);
  assert.deepEqual(stale, callerBefore, "Rejected control must not advance its caller generation");
  assert.deepEqual(await run(f.records.store.get(key)), before);
  await run(f.records.saveOwned(stale, ["error_or_recovery_reason"]));
  const saved = (await run(f.records.execution(e.issue_id)))!;
  assert.equal(saved.retry_instructions, "Retain newer instructions");
  assert.equal(saved.error_or_recovery_reason, "An unrelated late observation");
  delete stale.error_or_recovery_reason;
  await run(f.records.saveOwned(stale, ["error_or_recovery_reason"]));
  assert.equal((await run(f.records.execution(e.issue_id)))!.error_or_recovery_reason, undefined);
  assert.equal(
    (await run(f.records.execution(e.issue_id)))!.retry_instructions,
    "Retain newer instructions",
  );
});

test("owned updates reject replaced operations and control generations", async () => {
  const f = await retainedExecution({ operation: originalOperation });
  const e = f.execution;
  const stale = (await run(f.records.execution(e.issue_id)))!;
  e.operation = { ...e.operation!, id: Id.OperationId.make("op-replacement"), status: "prepared" };
  await run(f.records.save(e));
  await assert.rejects(run(f.records.saveOwned(stale, ["error_or_recovery_reason"])), /superseded/);
  const priorGeneration = (await run(f.records.execution(e.issue_id)))!;
  await run(f.records.saveControl(e));
  await assert.rejects(
    run(f.records.saveOwned(priorGeneration, ["retry_instructions"])),
    /superseded/,
  );
});

test("owned updates retain independent field deletion and future additive evidence", async () => {
  const f = await retainedExecution();
  const e = f.execution;
  e.retry_instructions = "Old instructions";
  await run(f.records.save(e));
  const stale = (await run(f.records.execution(e.issue_id)))!;
  await run(
    f.records.update(e.issue_id, (current) => {
      delete current.retry_instructions;
      return current;
    }),
  );
  const key = Id.StorageKey.make(`execution/${e.issue_id}`);
  await run(
    f.records.store.set(key, {
      ...((await run(f.records.store.get(key))) as object),
      future_additive_evidence: { retained: true },
    }),
  );
  stale.error_or_recovery_reason = "Late owned error";
  await run(f.records.saveOwned(stale, ["error_or_recovery_reason"]));
  const raw = (await run(f.records.store.get(key))) as Record<string, unknown>;
  assert.equal("retry_instructions" in raw, false);
  assert.deepEqual(raw.future_additive_evidence, { retained: true });
});

test("independent repository instances commit disjoint owned fields from current state", async () => {
  const f = await retainedExecution();
  const initial = f.execution;
  const peer = new Records(f.records.store);
  peer.coordinate(f.locks);
  const first = (await run(f.records.execution(initial.issue_id)))!;
  const second = (await run(peer.execution(initial.issue_id)))!;
  first.retry_instructions = "Independent instructions";
  second.error_or_recovery_reason = "Independent error";
  await Promise.all([
    run(f.records.saveOwned(first, ["retry_instructions"])),
    run(peer.saveOwned(second, ["error_or_recovery_reason"])),
  ]);
  const result = (await run(peer.execution(initial.issue_id)))!;
  assert.equal(result.retry_instructions, "Independent instructions");
  assert.equal(result.error_or_recovery_reason, "Independent error");
});

test("owned finishing receipts survive concurrent observations without dropping newer questions", async () => {
  const f = await retainedExecution({
    apply_session_id: Id.SessionId.make("ses_apply"),
    delivered_commit: Id.Commit.make("a".repeat(40)),
  });
  const e = f.execution;
  const key = Id.ObligationKey.make("concurrent-question");
  await run(
    f.records.update(e.issue_id, (current) => ({
      ...current,
      decisions: [
        ...(current.decisions ?? []),
        {
          schema_version: 1,
          generation: current.control_generation,
          key,
          scope: "finishing",
          question: "Preserve this independent question",
          owner: "user",
          session_id: "controller",
          status: "open",
          opened_at: 0,
        },
      ],
      finishing: { ...current.finishing, schema_version: 1, current_question: key },
    })),
  );
  e.finishing = {
    ...e.finishing,
    schema_version: 1,
    attribution: {
      schema_version: 1,
      generation: e.control_generation,
      session_id: e.apply_session_id!,
      prompt_id: Id.MessageId.make("msg_concurrent"),
      head: e.delivered_commit!,
      fingerprint: Id.Fingerprint.make("new-evidence"),
      at: Id.timestampAt(0),
    },
  };
  await run(f.records.saveFinishing(e, ["attribution"]));
  const saved = (await run(f.records.execution(e.issue_id)))!;
  assert.equal(saved.finishing!.attribution!.fingerprint, "new-evidence");
  assert.equal(saved.finishing!.current_question, key);
  assert.equal(saved.decisions!.find((d) => d.key === key)!.status, "open");
});

test("malformed finishing additions retain original evidence and cannot manufacture readiness", async () => {
  const f = await retainedExecution();
  const e = f.execution;
  const key = Id.StorageKey.make(`execution/${e.issue_id}`);
  for (const finishing of [
    { schema_version: 9 },
    { schema_version: 1, synchronization: [{}] },
    { schema_version: 1, preflight: { status: "ready" } },
    { schema_version: 1, routing: [{ status: "pending" }] },
  ]) {
    const raw = { ...((await run(f.records.store.get(key))) as object), finishing };
    await run(f.records.store.set(key, raw));
    const scan = await run(f.records.executionScan());
    assert.equal(scan.values.length, 0);
    assert.ok(scan.diagnostics.length);
    assert.deepEqual(await run(f.records.store.get(key)), raw);
  }
});

test("versioned phase records reject missing preservation and planning evidence", async () => {
  const f = await retainedExecution({
    current_phase: "awaiting_plan_approval",
    worktree_directory: Id.AbsolutePath.make("/fixture"),
    target_branch: Id.BranchName.make("main"),
    base_commit: Id.Commit.make("a".repeat(40)),
    plan_fingerprint: Id.Fingerprint.make("planned"),
  });
  const e = f.execution;
  await run(f.records.save(e));
  assert.equal(e.schema_version, 1);
  assert.ok(e.revision! > 1);
  assert.equal(e.control_generation, 0);
  await assert.rejects(
    run(f.records.save({ ...e, plan_fingerprint: undefined })),
    /plan_fingerprint/,
  );
  await assert.rejects(
    run(f.records.save({ ...e, current_phase: "cleaning" })),
    /delivery_receipt|delivered_commit/,
  );
  assert.equal((await run(f.records.execution(e.issue_id)))!.plan_fingerprint, e.plan_fingerprint);
});

for (const stage of ["active", "form", "interrupted", "completed"] as const) {
  test(`legacy ${stage} migration retains originals and exact ownership/authorization`, async (t) => {
    const f = await run(fixture);
    t.onTestFinished(() => run(f.close()));
    let e =
      stage === "active" || stage === "interrupted"
        ? await run(applying(f))
        : stage === "form"
          ? await run(planned(f))
          : await run(delivered(f));
    if (stage === "form")
      await run(f.controller.approve(e.issue_id, "plan", Id.SessionId.make("ses_supervisor")));
    if (stage === "interrupted") await run(f.controller.control(e.issue_id, "pause"));
    if (stage === "completed") {
      f.delivery.merged = true;
      f.delivery.pr!.state = "MERGED";
      await run(f.controller.finish(e.issue_id));
    }
    e = await run(f.controller.get(e.issue_id));
    const legacy: Partial<typeof e> = { ...e };
    delete legacy.schema_version;
    delete legacy.revision;
    delete legacy.control_generation;
    delete legacy.effective_policy;
    const key = `execution/${e.issue_id}`;
    await run(
      f.records.store.set(Id.StorageKey.make(key), {
        ...legacy,
        extension_evidence: { retained: true },
      }),
    );
    const original = await run(f.records.store.get(Id.StorageKey.make(key)));
    const restarted = new Records(f.records.store);
    const read = (await run(restarted.execution(e.issue_id)))!;
    assert.deepEqual(read.approval_receipts, legacy.approval_receipts);
    assert.equal(read.execution_id, legacy.execution_id);
    assert.equal(read.worktree_directory, legacy.worktree_directory);
    assert.equal(read.apply_session_id, legacy.apply_session_id);
    assert.deepEqual(
      await run(f.records.store.get(Id.StorageKey.make(key))),
      original,
      "reads must not migrate",
    );
    await run(restarted.save(read));
    assert.deepEqual(
      await run(f.records.store.get(Id.StorageKey.make(`legacy-original/${key}`))),
      original,
    );
    assert.deepEqual(
      ((await run(f.records.store.get(Id.StorageKey.make(key)))) as { extension_evidence: unknown })
        .extension_evidence,
      { retained: true },
    );
    await run(restarted.save(read));
    assert.deepEqual(
      await run(f.records.store.get(Id.StorageKey.make(`legacy-original/${key}`))),
      original,
    );
  });
}

test("unknown future and incomplete records remain visible without hiding valid tickets", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(planned(f));
  const future = { ...e, issue_id: "future", schema_version: 99, future_evidence: "preserve" };
  await run(f.records.store.set(Id.StorageKey.make("execution/future"), future));
  await run(
    f.records.store.set(Id.StorageKey.make("execution/incomplete"), {
      issue_id: "incomplete",
      schema_version: 1,
    }),
  );
  await run(
    f.records.store.set(Id.StorageKey.make("execution/../invalid"), {
      issue_id: "../invalid",
      schema_version: 1,
    }),
  );
  const scan = await run(f.records.executionScan());
  assert.equal(scan.values.length, 1);
  assert.equal(scan.diagnostics.length, 3);
  assert.equal(
    scan.diagnostics.find((d) => d.key === "execution/future")!.code,
    "unsupported_version",
  );
  await assert.rejects(
    run(f.records.save({ ...e, issue_id: Id.IssueId.make("future") })),
    /Unsupported record version/,
  );
  await assert.rejects(
    run(
      f.records.saveOwned({ ...e, issue_id: Id.IssueId.make("future") }, [
        "error_or_recovery_reason",
      ]),
    ),
    /Unsupported record version/,
  );
  const snapshot = await run(new Visibility(f.controller).snapshot());
  assert.ok(snapshot.work.find((w) => w.issue_id === e.issue_id));
  assert.equal(snapshot.work.find((w) => w.issue_id === "future")!.phase, "recovery_required");
  assert.equal(snapshot.record_diagnostics!.length, 3);
  assert.deepEqual(await run(f.records.store.get(Id.StorageKey.make("execution/future"))), future);
  assert.ok((await run(f.records.export())).entries.find((x) => x.key === "execution/future"));
});

test("project/setup migration is read-only until coordinated save and keeps setup identity", async () => {
  const records = new Records(new MemoryStore());
  records.coordinate(new TestLocks());
  const legacy = {
    id: "api",
    path: "/fixture/api",
    remote: "origin",
    target_branch: "main",
    git_common_dir: "/fixture/api/.git",
    openspec: true,
    verification: [],
    max_workers: 1,
    plan_approval: true,
    merge_approval: true,
    delivery: "github-pr",
  };
  await run(records.store.set(Id.StorageKey.make("project/api"), legacy));
  const project = (await run(records.project(Id.RepositoryId.make("api"))))!;
  assert.equal(project.schema_version, 1);
  assert.deepEqual(await run(records.store.get(Id.StorageKey.make("project/api"))), legacy);
  await run(records.saveProject(project));
  assert.deepEqual(
    await run(records.store.get(Id.StorageKey.make("legacy-original/project/api"))),
    legacy,
  );
  const setup = {
    issue_id: "setup-api",
    repository_id: "api",
    execution_id: "setup-test",
    workflow_policy: "full-openspec" as const,
    current_phase: "provisioning" as const,
    setup: true,
    branch: "setup/test",
    openspec_change: "",
    approval_receipts: [],
    delivery_policy: project.delivery,
    merge_approval_required: true,
    updated_at: new Date().toISOString(),
  };
  await run(records.store.set(Id.StorageKey.make("setup/api"), setup));
  const normalized = (await run(records.setup(Id.RepositoryId.make("api"))))!;
  await run(records.saveSetup(normalized));
  assert.equal(normalized.execution_id, setup.execution_id);
  assert.deepEqual(
    await run(records.store.get(Id.StorageKey.make("legacy-original/setup/api"))),
    setup,
  );
});

test("execution snapshots retain verification commands and remove cleared owned fields", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(applying(f));
  const p = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
  const commands = structuredClone(e.effective_policy!.verification);
  p.verification = [[process.execPath, "-e", "process.exit(99)"]];
  await run(f.records.saveProject(p));
  assert.deepEqual((await run(f.controller.queries.effectiveProject(e))).verification, commands);
  assert.equal((await run(f.records.execution(e.issue_id)))!.session_intent, undefined);
});

test("durable authority cannot contradict its policy snapshot", async () => {
  const f = await retainedExecution();
  const e = f.execution;
  e.merge_approval_required = false;
  await assert.rejects(run(f.records.save(e)), /policy snapshot/);
  assert.equal((await run(f.records.execution(e.issue_id)))!.merge_approval_required, true);
});
