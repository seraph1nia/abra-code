import { Effect } from "effect";
import { Coordination } from "../../src/workflow/coordination.ts";
import { retainedExecution } from "../helpers/retained-execution.ts";
import * as Id from "@abracode/contracts/identities";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { run } from "../effects.ts";
import { applying, fixture, planned, MemoryStore, TestLocks } from "../fixtures.ts";
import { Records, removeOwnedField } from "../../src/storage/store.ts";
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
  const peer = new Records(f.records.store, f.records.coordination);
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
  await assert.rejects(run(f.records.commitControl(stale)), /revision changed/);
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
  await run(f.records.commitControl(e));
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

test("owned patches preserve extensions and refuse stale or invalid writes without changing the caller", async () => {
  const { records, execution: e } = await retainedExecution({ operation: originalOperation });
  const key = Id.StorageKey.make(`execution/${e.issue_id}`);
  const original = structuredClone(e);
  await run(records.store.set(key, { ...e, retry_instructions: "clear me", future_field: 42 }));
  const saved = await run(
    records.commitOwned(structuredClone(e), {
      retry_instructions: removeOwnedField,
      error_or_recovery_reason: "owned",
    }),
  );
  assert.equal(saved.retry_instructions, undefined);
  assert.equal(saved.error_or_recovery_reason, "owned");
  assert.equal(Reflect.get((await run(records.store.get(key))) as object, "future_field"), 42);
  await run(records.commitControl(saved));
  const before = await run(records.store.get(key));
  await assert.rejects(run(records.commitOwned(e, { retry_instructions: "stale" })), /superseded/);
  await assert.rejects(run(records.commitOwned(saved, { rounds: [{} as never] })));
  assert.deepEqual(await run(records.store.get(key)), before);
  assert.deepEqual(e, original);
});

test("independent repository instances commit disjoint owned fields from current state", async () => {
  const f = await retainedExecution();
  const initial = f.execution;
  const peer = new Records(f.records.store, f.records.coordination);
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
    const scan = await run(f.records.executionScan);
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

test("unversioned execution cannot be read or overwritten", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(applying(f));
  const key = Id.StorageKey.make(`execution/${e.issue_id}`);
  const raw = { ...e, schema_version: undefined, evidence: "retained" };
  await run(f.records.store.set(key, raw));
  const records = new Records(f.records.store, f.records.coordination);
  await assert.rejects(run(records.execution(e.issue_id)), /Unsupported record version/);
  await assert.rejects(run(records.save(e)), /Unsupported record version/);
  assert.deepEqual(await run(records.store.get(key)), raw);
  assert.equal((await run(records.executionScan)).diagnostics[0].code, "unsupported_version");
});

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
  const scan = await run(f.records.executionScan);
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
  assert.ok((await run(f.records.export)).entries.find((x) => x.key === "execution/future"));
});

test("unversioned project and setup remain isolated and unchanged", async () => {
  const records = new Records(new MemoryStore(), new Coordination(new TestLocks()));
  const id = Id.RepositoryId.make("api");
  for (const [key, raw, read] of [
    [Id.StorageKey.make("project/api"), { id }, records.project(id).pipe(Effect.asVoid)],
    [Id.StorageKey.make("setup/api"), { repository_id: id }, records.setup(id).pipe(Effect.asVoid)],
  ] as const) {
    await run(records.store.set(key, raw));
    await assert.rejects(run(read), /Unsupported record version/);
    assert.deepEqual(await run(records.store.get(key)), raw);
  }
  assert.equal((await run(records.diagnostics)).length, 2);
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
