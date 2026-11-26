import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, symlink, chmod, rename, unlink, cp } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Effect, Schema } from "effect";
import { createWorkflow } from "../../src/opencode/application.ts";
import * as Id from "@abracode/contracts/identities";
import { applying, planned, fixture, MemoryStore } from "../fixtures.ts";
import { run } from "../effects.ts";
import { planningHistoryError } from "../../src/workflow/planning-contracts.ts";
import { CrewError } from "../../src/domain.ts";
import { DatabaseSync, backup } from "node:sqlite";
import { Records } from "../../src/storage/store.ts";
import { executionRecordFields } from "../../src/storage/contracts.ts";
import { workDatabase, workGraphAt } from "../helpers/work-database.ts";

type Fixture = Effect.Success<typeof fixture>;
const supervisor = Id.SessionId.make("ses_supervisor");
const request = (id: string) => ({ id: Id.RequestId.make(id), sender: supervisor });
const restart = async (f: Fixture) =>
  (
    await run(
      createWorkflow(
        f.catalog,
        f.config,
        f.records,
        f.work,
        f.spec,
        f.git,
        f.runtime,
        f.delivery,
        f.locks,
      ),
    )
  ).controller;
async function attributed(f: Fixture, id = Id.IssueId.make("abra-1")) {
  let e = await run(applying(f, id));
  const root = e.worktree_directory!;
  await writeFile(join(root, "source.txt"), "staged Apply content\n");
  await run(f.git.run(root, ["add", "--", "source.txt"]));
  await writeFile(join(root, "source.txt"), "unstaged Apply content\n");
  await writeFile(join(root, "new-source.txt"), "untracked Apply content\n");
  f.spec.done = true;
  f.runtime.success(e.apply_session_id!);
  e = await run(f.controller.advance(e.issue_id));
  f.runtime.success(e.review_session_id!);
  return e;
}
async function indexBytes(f: Fixture, root: Id.AbsolutePath) {
  const index = await run(f.git.run(root, ["rev-parse", "--git-path", "index"]));
  return readFile(resolve(root, index));
}
async function plannedReplan(f: Fixture, id = Id.IssueId.make("abra-1")) {
  let e = await attributed(f, id);
  e = await run(f.controller.control(e.issue_id, "replan", "Format the plan", request("replan-1")));
  f.runtime.success(e.explore_session_id!);
  return run(f.controller.advance(e.issue_id));
}

test("dirty Apply source survives a formatting-only replan and fresh approval across restart", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  let e = await attributed(f);
  const root = e.worktree_directory!;
  const head = await run(f.git.head(root));
  const index = await indexBytes(f, root);
  const previousPlan = e.plan_fingerprint;
  e = await run(f.controller.control(e.issue_id, "replan", "Format the plan", request("replan-1")));
  assert.deepEqual(await indexBytes(f, root), index);
  const first = structuredClone(e.planning!.attempts[0]!);
  assert.equal(first.provenance.kind, "apply");
  assert.equal(first.admissions.length, 1);
  const prompts = f.runtime.prompts;
  const controller = await restart(f);
  await run(controller.control(e.issue_id, "replan", "Format the plan", request("replan-1")));
  assert.equal(f.runtime.prompts, prompts);
  await run(f.git.run(root, ["gc", "--prune=now"]));
  const plan = join(root, "openspec/changes", e.openspec_change, "proposal.md");
  await writeFile(plan, (await readFile(plan, "utf8")) + "\nFormatting-only clarification.\n");
  f.runtime.success(e.explore_session_id!);
  e = await run(controller.advance(e.issue_id));
  assert.equal(e.current_phase, "awaiting_plan_approval");
  assert.notEqual(e.plan_fingerprint, previousPlan);
  assert.deepEqual(e.planning!.attempts[0]!.source, first.source);
  assert.equal(await run(f.git.head(root)), head);
  assert.equal(await run(f.git.run(root, ["show", ":source.txt"])), "staged Apply content");
  assert.equal(await readFile(join(root, "source.txt"), "utf8"), "unstaged Apply content\n");
  assert.equal(await readFile(join(root, "new-source.txt"), "utf8"), "untracked Apply content\n");
  const pending = await run(controller.approve(e.issue_id, "plan", supervisor));
  assert.ok("form_id" in pending);
  assert.equal(f.runtime.prompts, prompts);
  f.runtime.forms.set(pending.form_id, "approved");
  const applied = await run(controller.approve(e.issue_id, "plan", supervisor));
  assert.ok(!("form_id" in applied));
  assert.equal(applied.current_phase, "applying");
  assert.equal(applied.planning!.attempts[0]!.stage, "applying");
});

for (const mutation of [
  "working",
  "index",
  "untracked",
  "mode",
  "link",
  "prefix",
  "newline",
  "head",
  "deletion",
  "move",
] as const) {
  test(`replan rejects ${mutation} source changes and retries cannot replace its baseline`, async (t) => {
    const f = await run(fixture);
    t.onTestFinished(() => run(f.close()));
    let e = await attributed(f);
    e = await run(f.controller.control(e.issue_id, "replan", undefined, request("replan-1")));
    const root = e.worktree_directory!;
    const original = structuredClone(e.planning!.attempts[0]!.source);
    if (mutation === "working") await writeFile(join(root, "source.txt"), "Explore edit");
    if (mutation === "index") {
      await writeFile(join(root, "source.txt"), "Index-only edit");
      await run(f.git.run(root, ["add", "source.txt"]));
      await writeFile(join(root, "source.txt"), "unstaged Apply content\n");
    }
    if (mutation === "untracked") await writeFile(join(root, "another.txt"), "Explore addition");
    if (mutation === "mode") await chmod(join(root, "source.txt"), 0o755);
    if (mutation === "link") {
      await symlink("source.txt", join(root, "new-link"));
    }
    if (mutation === "prefix") {
      const sibling = join(root, "openspec/changes", e.openspec_change + "-sibling");
      await mkdir(sibling);
      await writeFile(join(sibling, "proposal.md"), "Escape");
    }
    if (mutation === "newline") await writeFile(join(root, "source\nfile.txt"), "Escape");
    if (mutation === "deletion") await unlink(join(root, "source.txt"));
    if (mutation === "move")
      await rename(
        join(root, "source.txt"),
        join(root, "openspec/changes", e.openspec_change, "moved.txt"),
      );
    if (mutation === "head") {
      await run(f.git.run(root, ["add", "source.txt"]));
      await run(f.git.run(root, ["commit", "-m", "Unauthorized source commit"]));
    }
    f.runtime.success(e.explore_session_id!);
    await assert.rejects(run(f.controller.advance(e.issue_id)), { code: "EXPLORE_SOURCE_EDIT" });
    e = await run(f.controller.get(e.issue_id));
    assert.deepEqual(e.planning!.attempts[0]!.source, original);
    assert.equal(e.planning!.attempts[0]!.violations.length, 1);
    await assert.rejects(
      run((await restart(f)).control(e.issue_id, "replan", undefined, request("new-request"))),
      { code: "PLANNING_UNRESOLVED" },
    );
    assert.deepEqual(
      (await run(f.controller.get(e.issue_id))).planning!.attempts[0]!.source,
      original,
    );
  });
}

test("a pending plan form cannot approve a new source mutation", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await plannedReplan(f);
  const pending = await run(f.controller.approve(e.issue_id, "plan", supervisor));
  assert.ok("form_id" in pending);
  await writeFile(join(e.worktree_directory!, "source.txt"), "Changed after plan presentation");
  f.runtime.forms.set(pending.form_id, "approved");
  await run((await restart(f)).reconcile(e.issue_id));
  const saved = await run(f.controller.get(e.issue_id));
  assert.equal(saved.current_phase, "recovery_required");
  assert.ok(!saved.approval_receipts.some((r) => r.form_id === pending.form_id && r.authorized_at));
});

test("background polling does not capture an unanswered plan during editor churn", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await plannedReplan(f);
  const pending = await run(f.controller.approve(e.issue_id, "plan", supervisor));
  assert.ok("form_id" in pending);
  const capture = f.git.sourceTrees.bind(f.git);
  f.git.sourceTrees = () =>
    Effect.fail(new CrewError("PLANNING_RACE", "Concurrent planning editor"));
  await run((await restart(f)).reconcile(e.issue_id));
  assert.equal((await run(f.controller.get(e.issue_id))).current_phase, "awaiting_plan_approval");
  assert.equal(f.runtime.forms.get(pending.form_id), "pending");
  f.runtime.forms.set(pending.form_id, "approved");
  await run((await restart(f)).reconcile(e.issue_id));
  const stopped = await run(f.controller.get(e.issue_id));
  assert.equal(stopped.current_phase, "recovery_required");
  assert.ok(
    !stopped.approval_receipts.some((r) => r.form_id === pending.form_id && r.authorized_at),
  );
  f.git.sourceTrees = capture;
});

test("a captured baseline survives pin failure and the same request never recaptures drift", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await attributed(f);
  const index = await indexBytes(f, e.worktree_directory!);
  const capture = f.git.sourceTrees.bind(f.git);
  let captures = 0;
  f.git.sourceTrees = (...args) => {
    captures++;
    return capture(...args);
  };
  const pin = f.git.pinTree.bind(f.git);
  f.git.pinTree = () => Effect.fail(new CrewError("TEST_PIN_FAILURE", "Interrupted before pin"));
  await assert.rejects(
    run(f.controller.control(e.issue_id, "replan", undefined, request("pin-loss"))),
    { code: "TEST_PIN_FAILURE" },
  );
  assert.equal(captures, 1, "reuse the exact private tree capture when journaling its source");
  let saved = await run(f.controller.get(e.issue_id));
  const captured = structuredClone(saved.planning!.attempts[0]!.source);
  assert.equal(saved.plan_fingerprint, e.plan_fingerprint);
  assert.equal(saved.planning!.attempts[0]!.stage, "captured");
  assert.deepEqual(await indexBytes(f, e.worktree_directory!), index);
  f.git.pinTree = pin;
  await writeFile(join(e.worktree_directory!, "source.txt"), "Concurrent new content");
  await assert.rejects(
    run((await restart(f)).control(e.issue_id, "replan", undefined, request("pin-loss"))),
    { code: "PLANNING_RACE" },
  );
  saved = await run(f.controller.get(e.issue_id));
  assert.deepEqual(saved.planning!.attempts[0]!.source, captured);
  assert.equal(saved.plan_fingerprint, e.plan_fingerprint);
});

test("pause and explicit resume continue the same immutable source boundary", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  let e = await attributed(f);
  e = await run(f.controller.control(e.issue_id, "replan", undefined, request("pause-replan")));
  const original = structuredClone(e.planning!.attempts[0]!);
  await run(f.controller.control(e.issue_id, "pause"));
  await run(f.controller.reconcile(e.issue_id));
  e = await run(f.controller.get(e.issue_id));
  assert.equal(e.stop_status, "confirmed");
  e = await run((await restart(f)).control(e.issue_id, "resume"));
  assert.deepEqual(e.planning!.attempts[0]!.source, original.source);
  assert.equal(e.planning!.attempts[0]!.generation, original.generation);
  assert.equal(e.planning!.attempts[0]!.continuations.at(-1)!.generation, e.control_generation);
  f.runtime.success(e.explore_session_id!);
  e = await run(f.controller.advance(e.issue_id));
  assert.equal(e.current_phase, "awaiting_plan_approval");
});

for (const action of ["reject", "defer", "changed"] as const) {
  test(`prospective adoption ${action} cannot admit a writer`, async (t) => {
    const f = await run(fixture);
    t.onTestFinished(() => run(f.close()));
    let e = await attributed(f);
    e = { ...e, current_phase: "recovery_required" };
    e = { ...e, resume_phase: "planning" };
    e = { ...e, active_role: undefined };
    await run(f.records.save(e));
    const prompts = f.runtime.prompts;
    e = await run(
      f.controller.control(e.issue_id, "recover_planning", undefined, request("offer")),
    );
    const d = e.decisions!.find((d) => d.finishing_target?.kind === "planning_baseline_adoption")!;
    const pending = await run(
      f.controller.decision(e.issue_id, d.key, e.control_generation, supervisor, "collect"),
    );
    f.runtime.dispositions.set(pending.form_id!, {
      status: "answered",
      answer: { action: action === "changed" ? "authorize" : action, paths: [] },
    });
    await run(
      f.controller.decision(e.issue_id, d.key, e.control_generation, supervisor, "collect"),
    );
    if (action === "changed") {
      await writeFile(join(e.worktree_directory!, "source.txt"), "Stale offer");
      await assert.rejects(
        run(
          (await restart(f)).control(e.issue_id, "recover_planning", undefined, request("offer")),
        ),
        { code: "PLANNING_OFFER_CHANGED" },
      );
    } else
      await run(
        (await restart(f)).control(e.issue_id, "recover_planning", undefined, request("offer")),
      );
    e = await run(f.controller.get(e.issue_id));
    assert.equal(e.current_phase, "recovery_required");
    assert.equal(e.planning!.attempts[0]!.stage, "offered");
    assert.equal(f.runtime.prompts, prompts);
    assert.equal(
      e.decisions!.filter((d) => d.finishing_target?.kind === "planning_baseline_adoption").length,
      1,
    );
  });
}

test("owned persistence refuses rewriting captured source or removing planning history", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await plannedReplan(f);
  const before = await run(f.records.store.get(Id.StorageKey.make(`execution/${e.issue_id}`)));
  Reflect.set(e.planning!.attempts[0]!.source!, "candidate", Id.GitTree.make("f".repeat(40)));
  await assert.rejects(run(f.records.save(e)), { code: "PLANNING_HISTORY" });
  assert.deepEqual(
    await run(f.records.store.get(Id.StorageKey.make(`execution/${e.issue_id}`))),
    before,
  );
  let fresh = await run(f.controller.get(e.issue_id));
  fresh = { ...fresh, planning: undefined };
  await assert.rejects(run(f.records.save(fresh)), /Planning history|Planning evidence|Expected/);
  assert.deepEqual(
    await run(f.records.store.get(Id.StorageKey.make(`execution/${e.issue_id}`))),
    before,
  );
});

test("baseline history survives native-style JSON normalization and preserves unknown evidence", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const set = f.records.store.set.bind(f.records.store);
  f.records.store.set = (key, value) => set(key, JSON.parse(JSON.stringify(value)));
  let e = await plannedReplan(f);
  const before = JSON.parse(JSON.stringify(e.planning));
  // The previous read projection has every common field except the new optional
  // planning evidence. This is read compatibility, never old-writer authority.
  const legacyFields = { ...executionRecordFields };
  Reflect.deleteProperty(legacyFields, "planning");
  const legacy = Schema.decodeSync(Schema.Struct(legacyFields))(e);
  assert.equal(legacy.execution_id, e.execution_id);
  assert.equal(legacy.plan_fingerprint, e.plan_fingerprint);
  assert.deepEqual(legacy.approval_receipts, e.approval_receipts);
  const key = Id.StorageKey.make(`execution/${e.issue_id}`);
  const raw = await run(f.records.store.get(key));
  assert.ok(raw && typeof raw === "object");
  await run(set(key, { ...raw, future_observation: { preserved: true } }));
  e = await run((await restart(f)).get(e.issue_id));
  e = { ...e, retry_instructions: "Independent scoped observation" };
  await run(f.records.saveOwned(e, ["retry_instructions"]));
  assert.deepEqual(JSON.parse(JSON.stringify(e.planning)), before);
  assert.deepEqual(Reflect.get((await run(f.records.store.get(key)))!, "future_observation"), {
    preserved: true,
  });
  const future = { ...e, planning: { ...e.planning!, schema_version: 999 } };
  await run(set(key, future));
  await assert.rejects(run((await restart(f)).get(e.issue_id)));
  assert.equal(
    Reflect.get(Reflect.get((await run(f.records.store.get(key)))!, "planning"), "schema_version"),
    999,
  );
});

test("historical recovery reuses complete originally bound objects without prospective adoption", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  let e = await plannedReplan(f);
  const original = structuredClone(e.planning!.attempts[0]!);
  e = { ...e, current_phase: "recovery_required" };
  e = { ...e, resume_phase: "planning" };
  e = { ...e, error_or_recovery_reason: "Interrupted planning checkpoint" };
  await run(f.records.save(e));
  e = await run(
    (await restart(f)).control(e.issue_id, "recover_planning", undefined, request("historical")),
  );
  assert.deepEqual(e.planning!.attempts[0], original);
  assert.deepEqual(e.planning!.attempts[1]!.source, original.source);
  assert.equal(e.planning!.attempts[1]!.provenance.kind, "historical");
  assert.equal(
    e.decisions?.some((d) => d.finishing_target?.kind === "planning_baseline_adoption") ?? false,
    false,
  );
});

test("unconfirmed native completion refuses capture without invalidating the approved checkpoint", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await attributed(f);
  f.runtime.sessions.get(e.apply_session_id!)!.completion_pending = true;
  await assert.rejects(
    run(f.controller.control(e.issue_id, "replan", undefined, request("unconfirmed"))),
    { code: "WRITER_BUSY" },
  );
  const saved = await run(f.controller.get(e.issue_id));
  assert.equal(saved.planning, undefined);
  assert.equal(saved.plan_fingerprint, e.plan_fingerprint);
  assert.deepEqual(saved.verification_receipt, e.verification_receipt);
});

test("quiescent record export, source refs and SQLite online backup restore baseline and paused identities", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const project = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
  project.max_executions = 2;
  await run(f.records.saveProject(project));
  const db = await workDatabase(t);
  const goal = (id: string) => ({
    repository_id: Id.RepositoryId.make("api"),
    title: id,
    description: id,
    priority: 2,
    dependencies: [],
    request_id: Id.RequestId.make(id),
  });
  const first = await run(db.graph.create(goal("baseline-backup")));
  const e = await plannedReplan(f, first.id);
  await run(db.graph.claim(first.id, e.execution_id));
  const second = await run(db.graph.create(goal("paused-backup")));
  const companion = await run(planned(f, second.id));
  await run(db.graph.claim(second.id, companion.execution_id));
  await run(f.controller.control(second.id, "pause"));
  await run(f.controller.reconcile(second.id));
  await run(db.graph.block(second.id, companion.execution_id, "Confirmed paused companion"));
  const paused = await run(f.controller.get(second.id));
  await run(
    f.records.store.set(Id.StorageKey.make("future-proof/unknown"), {
      schema_version: 999,
      preserve: true,
    }),
  );
  const exported = JSON.parse(JSON.stringify(await run(f.records.export)));
  const file = join(db.root, "backup.sqlite");
  const reader = new DatabaseSync(db.path, { readOnly: true });
  try {
    await backup(reader, file);
  } finally {
    reader.close();
  }
  const common = await run(f.git.run(e.worktree_directory!, ["rev-parse", "--git-common-dir"]));
  const objects = join(db.root, "source.git");
  await cp(common, objects, { recursive: true });
  const restoredStore = new MemoryStore();
  for (const entry of exported.entries) await run(restoredStore.set(entry.key, entry.value));
  const restored = new Records(restoredStore, f.records.coordination);
  const baseline = await run(restored.execution(first.id));
  assert.deepEqual(
    JSON.parse(JSON.stringify(baseline!.planning)),
    JSON.parse(JSON.stringify(e.planning)),
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(await run(restored.execution(second.id)))),
    JSON.parse(JSON.stringify(paused)),
  );
  assert.deepEqual(await run(restoredStore.get(Id.StorageKey.make("future-proof/unknown"))), {
    schema_version: 999,
    preserve: true,
  });
  for (const view of ["index", "candidate"] as const) {
    const tree = e.planning!.attempts[0]!.source![view];
    await run(
      f.git.run(Id.AbsolutePath.make(db.root), [
        "--git-dir",
        objects,
        "cat-file",
        "-e",
        tree + "^{tree}",
      ]),
    );
  }
  const copy = await workGraphAt(t, Id.AbsolutePath.make(file));
  assert.deepEqual(await run(copy.graph.list), await run(db.graph.list));
  await run(db.graph.create(goal("later-work")));
  assert.notDeepEqual(
    await run(copy.graph.list),
    await run(db.graph.list),
    "An old snapshot cannot stand in for later work",
  );
});

test("legacy missing baseline requires exact prospective native adoption and a fresh plan", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  let e = await attributed(f);
  const oldPlan = e.plan_fingerprint;
  e = { ...e, current_phase: "recovery_required" };
  e = { ...e, resume_phase: "planning" };
  e = { ...e, error_or_recovery_reason: "Explore modified files outside assigned OpenSpec change" };
  e = { ...e, active_role: undefined };
  await run(f.records.save(e));
  const before = await indexBytes(f, e.worktree_directory!);
  const prompts = f.runtime.prompts;
  e = await run(
    f.controller.control(e.issue_id, "recover_planning", undefined, request("adopt-1")),
  );
  const decision = e.decisions!.find(
    (d) => d.finishing_target?.kind === "planning_baseline_adoption",
  )!;
  assert.equal(e.current_phase, "recovery_required");
  assert.equal(f.runtime.prompts, prompts);
  assert.deepEqual(await indexBytes(f, e.worktree_directory!), before);
  await assert.rejects(
    run(
      f.controller.decision(
        e.issue_id,
        decision.key,
        e.control_generation,
        supervisor,
        "answer",
        "authorize",
      ),
    ),
    { code: "DECISION_OWNER" },
  );
  const pending = await run(
    f.controller.decision(e.issue_id, decision.key, e.control_generation, supervisor, "collect"),
  );
  f.runtime.dispositions.set(pending.form_id!, {
    status: "answered",
    answer: { action: "authorize", paths: [] },
  });
  await run(
    f.controller.decision(e.issue_id, decision.key, e.control_generation, supervisor, "collect"),
  );
  assert.equal((await run(f.controller.get(e.issue_id))).current_phase, "recovery_required");
  e = await run(
    (await restart(f)).control(e.issue_id, "recover_planning", undefined, request("adopt-1")),
  );
  assert.equal(e.current_phase, "planning");
  assert.equal(e.planning!.attempts[0]!.provenance.kind, "prospective_adoption");
  assert.match(e.planning!.attempts[0]!.prior.error!, /outside assigned/);
  f.runtime.success(e.explore_session_id!);
  e = await run(f.controller.advance(e.issue_id));
  assert.equal(e.current_phase, "awaiting_plan_approval");
  assert.notEqual(e.plan_fingerprint, oldPlan);
  assert.equal(f.runtime.prompts, prompts + 1);
  assert.equal(
    planningHistoryError(e.planning, { ...e.planning!, attempts: [] }),
    "Planning history cannot be removed",
  );
});
