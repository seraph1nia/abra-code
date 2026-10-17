import * as Id from "../../src/identities.ts";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { run } from "../effects.ts";
import { applying, delivered, fixture, planned } from "../fixtures.ts";
import { Records } from "../../src/storage/store.ts";
import { Visibility } from "../../src/visibility/read-model.ts";

test("versioned phase records reject missing preservation and planning evidence", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(planned(f));
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
  const snapshot = await run(new Visibility(f.controller).snapshot());
  assert.ok(snapshot.work.find((w) => w.issue_id === e.issue_id));
  assert.equal(snapshot.work.find((w) => w.issue_id === "future")!.phase, "recovery_required");
  assert.equal(snapshot.record_diagnostics!.length, 3);
  assert.deepEqual(await run(f.records.store.get(Id.StorageKey.make("execution/future"))), future);
  assert.ok((await run(f.records.export())).entries.find((x) => x.key === "execution/future"));
});

test("project/setup migration is read-only until coordinated save and keeps setup identity", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const project = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
  const legacy: Partial<typeof project> = { ...project };
  delete legacy.schema_version;
  delete legacy.revision;
  await run(f.records.store.set(Id.StorageKey.make("project/api"), legacy));
  assert.equal((await run(f.records.project(Id.RepositoryId.make("api"))))!.schema_version, 1);
  await run(f.records.saveProject(project));
  assert.deepEqual(
    await run(f.records.store.get(Id.StorageKey.make("legacy-original/project/api"))),
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
  await run(f.records.store.set(Id.StorageKey.make("setup/api"), setup));
  const normalized = (await run(f.records.setup(Id.RepositoryId.make("api"))))!;
  await run(f.records.saveSetup(normalized));
  assert.equal(normalized.execution_id, setup.execution_id);
  assert.deepEqual(
    await run(f.records.store.get(Id.StorageKey.make("legacy-original/setup/api"))),
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

test("durable authority cannot contradict its policy snapshot", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(planned(f));
  e.merge_approval_required = false;
  await assert.rejects(run(f.records.save(e)), /policy snapshot/);
  assert.equal((await run(f.controller.get(e.issue_id))).merge_approval_required, true);
});
