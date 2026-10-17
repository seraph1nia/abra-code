import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { mkdir, writeFile, access, rename, symlink, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import * as Id from "../../src/identities.ts";
import { fixture, delivered, writePlan } from "../fixtures.ts";
import { Controller } from "../../src/workflow/controller.ts";
import { verifiedSpec } from "../helpers/spec-review.ts";
import { run } from "../effects.ts";
import { Workspaces } from "../../src/git/workspaces.ts";
import { RepositorySources } from "../../src/git/source.ts";
import { directoryIdentity } from "../../src/git/retirement.ts";
import { ExecutionStateSchema } from "../../src/storage/contracts.ts";
import {
  CleanupPreflightSchema,
  FinishingSchema,
  FinishingTargetSchema,
  PublicationBindingSchema,
} from "../../src/workflow/finishing-contracts.ts";
import {
  finishingAction,
  observePublication,
  observePreflight,
  preflightMatches,
  type PublicationObservation,
} from "../../src/workflow/finishing-readiness.ts";

const commit = Id.Commit.make("a".repeat(40));
const next = Id.Commit.make("b".repeat(40));
const content = Id.Fingerprint.make("content");
const worktree = { path: Id.AbsolutePath.make("/tmp/owned"), device: "1", inode: "2", birth: "3" };
const observation: PublicationObservation = {
  head: commit,
  published: commit,
  remote: commit,
  content,
  dirty: false,
  state: "open",
  descendant: true,
};

test("finishing schemas preserve legacy absence and reject unsafe evidence rather than inventing readiness", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(delivered(f));
  assert.ok(e.finishing?.publication);
  const legacy = { ...e, finishing: undefined };
  assert.equal(Schema.decodeSync(ExecutionStateSchema)(legacy).finishing, undefined);
  const preflight = {
    schema_version: 1 as const,
    generation: 0,
    operation_id: "op-fixture",
    head: commit,
    content,
    published: commit,
    worktree,
    authorization_revision: 0,
    observed_at: 1,
    status: "ready" as const,
    paths: [],
    truncated: false,
  };
  assert.equal(Schema.is(CleanupPreflightSchema)(preflight), true);
  for (const change of [
    { schema_version: 2 },
    { generation: -1 },
    { operation_id: "../bad" },
    { published: "bad" },
    { head: next },
    { truncated: true },
    { paths: [{ path: "../outside", category: "ignored", kind: "file" }] },
  ])
    assert.equal(Schema.is(CleanupPreflightSchema)({ ...preflight, ...change }), false);
  assert.throws(() =>
    Schema.decodeSync(ExecutionStateSchema)({
      ...e,
      finishing: {
        schema_version: 1,
        preflight: { ...preflight, generation: e.control_generation + 1 },
      },
    }),
  );
  assert.equal(Schema.is(FinishingSchema)({ schema_version: 2 }), false);
  assert.equal(
    Schema.is(PublicationBindingSchema)({
      schema_version: 1,
      generation: 0,
      operation_id: "op-fixture",
      verification: "v1",
      review: "v2",
      review_session: "ses_review",
      archived_tree: commit,
      commit,
      at: "2026-10-17T00:00:00.000Z",
    }),
    false,
  );
  for (const path of [".", "../data", ".git", "node_modules/*", "/tmp"]) {
    assert.equal(
      Schema.is(FinishingTargetSchema)({
        schema_version: 1,
        generation: 0,
        kind: "generated_directories",
        worktree,
        fingerprint: content,
        directories: [{ path, identity: { ...worktree, path: join(worktree.path, path) } }],
      }),
      false,
    );
  }
  assert.equal(
    Schema.is(FinishingTargetSchema)({
      schema_version: 1,
      generation: 0,
      kind: "generated_directories",
      worktree,
      fingerprint: content,
      directories: [{ path: "cache", identity: { ...worktree, path: "/tmp/elsewhere" } }],
    }),
    false,
  );
});

test("finishing selection preserves custody, decisions, unknown provenance and merged late work", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(delivered(f));
  const choose = (publication = observation, attributable = false) =>
    finishingAction(e, { quiescent: true, publication, attributable });
  assert.equal(choose().kind, "preflight");
  assert.deepEqual(choose({ ...observation, dirty: true }), {
    kind: "decision",
    reason: "adoption",
  });
  assert.equal(choose({ ...observation, dirty: true }, true).kind, "synchronize");
  assert.equal(choose({ ...observation, head: next }, true).kind, "synchronize");
  assert.deepEqual(choose({ ...observation, remote: next }), {
    kind: "decision",
    reason: "remote_drift",
  });
  assert.deepEqual(choose({ ...observation, state: "merged", dirty: true }, true), {
    kind: "decision",
    reason: "follow_on",
  });
  assert.equal(choose({ ...observation, state: "merged" }).kind, "finalize");
  assert.equal(choose({ ...observation, head: next, descendant: false }, true).kind, "unsafe");
  assert.equal(finishingAction(e, { quiescent: true }).kind, "unsafe");
  assert.equal(finishingAction(e, { quiescent: false, publication: observation }).kind, "wait");
  e.stop_status = "requested";
  assert.equal(choose({ ...observation, dirty: true }, true).kind, "wait");
  delete e.stop_status;
  e.current_phase = "completed";
  assert.equal(choose().kind, "wait");
});

async function preflightFixture() {
  const f = await run(fixture);
  const e = await run(delivered(f));
  const p = (await run(f.records.project(e.repository_id)))!;
  e.worktree_identity = await run(directoryIdentity(e.worktree_directory!));
  f.runtime.removeWorktree = () =>
    Effect.sync(() => assert.fail("Preflight attempted native removal"));
  const spaces = new Workspaces(
    f.git,
    new RepositorySources(f.git, f.config.repository_root),
    f.runtime,
    f.config.worktree_root,
  );
  return { f, e, p, spaces };
}

test("preflight excludes only exact inspected generated directories without staging or removing output", async (t) => {
  const { f, e, p, spaces } = await preflightFixture();
  t.onTestFinished(() => run(f.close()));
  // Use local exclude data so the published deliverable stays unchanged.
  const exclude = await run(
    f.git.run(e.worktree_directory!, ["rev-parse", "--git-path", "info/exclude"]),
  );
  await writeFile(exclude, "cache/\nprivate-note\n");
  e.effective_policy = {
    ...e.effective_policy,
    generated_paths: [Id.RelativePath.make("cache/allowed")],
  };
  await mkdir(join(e.worktree_directory!, "cache/allowed"), { recursive: true });
  await writeFile(join(e.worktree_directory!, "cache/allowed/build"), "generated");
  const before = await run(f.git.run(e.worktree_directory!, ["diff", "--cached", "--binary"]));
  assert.equal(await run(spaces.preflight(p, e)), undefined);
  await access(join(e.worktree_directory!, "cache/allowed/build"));
  assert.equal(
    await run(f.git.run(e.worktree_directory!, ["diff", "--cached", "--binary"])),
    before,
  );
  await writeFile(join(e.worktree_directory!, "cache/unknown"), "keep");
  await writeFile(join(e.worktree_directory!, "private-note"), "keep");
  const residue = await run(spaces.preflight(p, e));
  assert.ok(residue);
  assert.ok(residue.paths.some((item) => item.path === "private-note"));
  assert.ok(residue.paths.some((item) => item.path.startsWith("cache")));
});

test("preflight rejects resource replacement and unsafe generated descendants without disposal", async (t) => {
  const { f, e, p, spaces } = await preflightFixture();
  t.onTestFinished(() => run(f.close()));
  e.effective_policy = { ...e.effective_policy, generated_paths: [Id.RelativePath.make("cache")] };
  await mkdir(join(e.worktree_directory!, "cache"));
  await symlink(f.root, join(e.worktree_directory!, "cache/escape"));
  await assert.rejects(run(spaces.preflight(p, e)), /escapes|outside/);
  await access(join(e.worktree_directory!, "cache/escape"));
  await rename(e.worktree_directory!, `${e.worktree_directory}.retained`);
  await mkdir(e.worktree_directory!);
  await assert.rejects(run(spaces.preflight(p, e)));
});

test("retained preflight binds current content, ownership and authorization revision", async (t) => {
  const { f, e, p, spaces } = await preflightFixture();
  t.onTestFinished(() => run(f.close()));
  assert.ok(e.operation);
  const preflight = await run(observePreflight(f.git, spaces, p, e));
  e.finishing = { schema_version: 1, preflight };
  const current = {
    ...observation,
    head: preflight.head,
    published: preflight.published,
    remote: preflight.published,
    content: preflight.content,
  };
  assert.equal(preflightMatches(e, current, preflight), true);
  assert.equal(preflightMatches(e, { ...current, content }, preflight), false);
  assert.equal(
    preflightMatches(e, current, {
      ...preflight,
      status: "blocked",
      fingerprint: Id.Fingerprint.make("new-residue"),
    }),
    false,
  );
  e.control_generation++;
  assert.equal(preflightMatches(e, current, preflight), false);
});

test("publication observation distinguishes local edits, ahead commits, remote drift and merged PRs without writes", async (t) => {
  const { f, e, p } = await preflightFixture();
  t.onTestFinished(() => run(f.close()));
  const root = e.worktree_directory!;
  await run(f.git.run(root, ["push", "origin", e.branch]));
  const original = await run(observePublication(f.git, f.delivery, p, e));
  assert.equal(original.head, original.remote);
  assert.equal(original.dirty, false);
  await writeFile(join(root, "late.txt"), "late authorized work candidate");
  const dirty = await run(observePublication(f.git, f.delivery, p, e));
  assert.equal(dirty.dirty, true);
  assert.equal(dirty.remote, original.remote);
  await run(f.git.run(root, ["add", "late.txt"]));
  await run(f.git.run(root, ["commit", "-m", "Late candidate"]));
  const ahead = await run(observePublication(f.git, f.delivery, p, e));
  assert.notEqual(ahead.head, ahead.remote);
  assert.equal(ahead.descendant, true);
  assert.equal(ahead.dirty, false);
  await run(f.git.run(root, ["push", "origin", e.branch]));
  f.delivery.pr!.headRefOid = ahead.head;
  const drift = await run(observePublication(f.git, f.delivery, p, e));
  assert.notEqual(drift.remote, drift.published);
  assert.deepEqual(
    finishingAction(e, { quiescent: true, publication: drift, attributable: true }),
    { kind: "decision", reason: "remote_drift" },
  );
  f.delivery.pr!.headRefOid = original.head;
  f.delivery.pr!.state = "MERGED";
  await run(f.git.run(root, ["push", "origin", "--delete", e.branch]));
  const merged = await run(observePublication(f.git, f.delivery, p, e));
  assert.equal(merged.state, "merged");
  assert.deepEqual(finishingAction(e, { quiescent: true, publication: merged }), {
    kind: "decision",
    reason: "follow_on",
  });
  await run(f.git.run(root, ["reset", "--hard", original.head]));
  const unchanged = await run(observePublication(f.git, f.delivery, p, e));
  assert.equal(finishingAction(e, { quiescent: true, publication: unchanged }).kind, "finalize");
});

test("mandatory generated-directory decision bypasses exhausted diagnostics and automatically reaches closure", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  let e = await run(delivered(f));
  const supervisor = e.supervisor_session_id!;
  f.runtime.sessions.set(supervisor, { id: supervisor, directory: f.config.home, busy: false });
  const exclude = await run(
    f.git.run(e.worktree_directory!, ["rev-parse", "--git-path", "info/exclude"]),
  );
  await writeFile(exclude, "generated-output/\n");
  await mkdir(join(e.worktree_directory!, "generated-output"));
  await writeFile(join(e.worktree_directory!, "generated-output/cache"), "generated");
  e.attention_turns = e.effective_policy.diagnostic_turns;
  e.attention = [
    {
      schema_version: 1,
      id: Id.IncidentId.make("old-stall"),
      generation: e.control_generation,
      key: "old-stall",
      code: "suspected_stall",
      evidence: "Old silence observation",
      created_at: 0,
      status: "exhausted",
      attempts: 1,
    },
  ];
  await run(f.records.save(e));
  await run(f.controller.approve(e.issue_id, "merge", supervisor));
  e = await run(f.controller.get(e.issue_id));
  assert.equal(f.delivery.merged, false);
  assert.equal(e.approval_receipts.filter((a) => a.kind === "merge").length, 0);
  const question = e.decisions!.find(
    (d) => d.status === "open" && d.finishing_target?.kind === "residue",
  )!;
  assert.ok(question.form_id && f.runtime.dispositions.has(question.form_id));
  assert.equal(e.finishing!.routing![0].status, "pending");
  assert.equal(e.attention_turns, e.effective_policy.diagnostic_turns);
  await run(f.controller.supervise());
  assert.equal(
    (await run(f.controller.get(e.issue_id))).attention!.find((a) => a.id === "old-stall")!.status,
    "superseded",
  );
  f.runtime.dispositions.set(question.form_id!, {
    status: "answered",
    answer: { action: "generated", paths: [Id.RelativePath.make("generated-output")] },
  });
  e = (await run(f.controller.reconcile(e.issue_id)))[0];
  assert.equal(e.finishing!.authorizations!.length, 1);
  assert.deepEqual(e.effective_policy.generated_paths, []);
  await access(join(e.worktree_directory!, "generated-output/cache"));
  const merge = e.approval_receipts.find(
    (a) => a.kind === "merge" && a.fingerprint === e.delivered_commit,
  )!;
  assert.ok(merge);
  f.runtime.forms.set(merge.form_id, "approved");
  e = (await run(f.controller.reconcile(e.issue_id)))[0];
  assert.equal(e.current_phase, "completed");
  assert.equal(e.retirement!.native, "confirmed");
  assert.equal((await run(f.work.show(e.issue_id))).status, "closed");
});

test("late edits are adopted, revised, independently reviewed and republished to the same PR before fresh approval", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  let e = await run(delivered(f));
  const original = e.delivered_commit!;
  const pr = e.pull_request_reference;
  const archive = e.archive_path!;
  const old = await run(f.controller.approve(e.issue_id, "merge", e.supervisor_session_id!));
  assert.ok("form_id" in old);
  await writeFile(join(e.worktree_directory!, "source.txt"), "sample late edits\n");
  f.runtime.forms.set(old.form_id, "approved");
  await run(f.controller.approve(e.issue_id, "merge", e.supervisor_session_id!));
  e = await run(f.controller.get(e.issue_id));
  const adoption = e.decisions!.find(
    (d) => d.status === "open" && d.finishing_target?.kind === "adopt",
  )!;
  assert.ok(adoption.form_id);
  f.runtime.dispositions.set(adoption.form_id!, {
    status: "answered",
    answer: { action: "authorize", paths: [] },
  });
  e = (await run(f.controller.reconcile(e.issue_id)))[0];
  assert.equal(e.current_phase, "planning");
  assert.equal(e.finishing!.synchronization!.length, 1);
  assert.equal(e.rounds?.length ?? 0, 0);
  assert.equal(e.effective_policy.repair_rounds, 0);
  assert.notEqual(e.openspec_change, e.finishing!.synchronization![0].prior_change);
  assert.equal(e.finishing!.synchronization![0].prior_archive, archive);
  assert.equal(
    await readFile(join(e.worktree_directory!, "source.txt"), "utf8"),
    "sample late edits\n",
  );
  await run(writePlan(e.worktree_directory!, e.openspec_change, true));
  f.runtime.success(e.explore_session_id!);
  e = (await run(f.controller.reconcile(e.issue_id)))[0];
  assert.equal(e.current_phase, "awaiting_plan_approval");
  const plan = await run(f.controller.approve(e.issue_id, "plan", e.supervisor_session_id!));
  assert.ok("form_id" in plan);
  f.runtime.forms.set(plan.form_id, "approved");
  await run(f.controller.approve(e.issue_id, "plan", e.supervisor_session_id!));
  e = await run(f.controller.get(e.issue_id));
  assert.equal(e.active_role, "review");
  assert.equal(e.apply_session_id, undefined, "Existing edits must not admit new coding");
  await run(
    f.controller.reviewReport(
      e.review_session_id!,
      true,
      "Existing edits fit scope",
      "in_scope",
      verifiedSpec,
    ),
  );
  f.runtime.success(e.review_session_id!);
  e = (await run(f.controller.reconcile(e.issue_id)))[0];
  assert.equal(e.current_phase, "awaiting_merge");
  assert.notEqual(e.delivered_commit, original);
  assert.equal(e.pull_request_reference, pr);
  assert.equal(e.finishing!.synchronization![0].stage, "published");
  assert.equal(e.finishing!.publication!.commit, e.delivered_commit);
  assert.equal(f.delivery.calls, 2);
  assert.ok(
    !e.approval_receipts.some(
      (a) => a.kind === "merge" && a.fingerprint === e.delivered_commit && a.authorized_at,
    ),
  );
  await access(join(e.worktree_directory!, archive));
  e = (await run(f.controller.reconcile(e.issue_id)))[0];
  const fresh = e.approval_receipts.find(
    (a) => a.kind === "merge" && a.fingerprint === e.delivered_commit,
  )!;
  assert.notEqual(fresh.form_id, old.form_id);
  f.runtime.forms.set(fresh.form_id, "approved");
  const restarted = new Controller(
    f.config,
    f.records,
    f.work,
    f.spec,
    f.git,
    f.runtime,
    f.delivery,
    f.locks,
  );
  t.onTestFinished(() => run(restarted.close()));
  e = (await run(restarted.reconcile(e.issue_id)))[0];
  assert.equal(e.current_phase, "completed");
  assert.equal(e.finishing!.synchronization!.length, 1);
  assert.equal(
    await run(
      f.git.run((await run(f.records.project(e.repository_id)))!.path, [
        "show",
        `${e.delivered_commit}:source.txt`,
      ]),
    ),
    "sample late edits",
  );
});
