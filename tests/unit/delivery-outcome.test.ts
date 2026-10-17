import { section, stateLabel } from "../../src/visibility/presentation.ts";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { Effect, Schema } from "effect";
import * as Id from "../../src/identities.ts";
import { delivered, fixture } from "../fixtures.ts";
import { run } from "../effects.ts";
import {
  deliveryOutcome,
  deliveryOutcomeLines,
  deliveryAction,
} from "../../src/workflow/delivery-outcome.ts";
import { ExecutionBusy } from "../../src/workflow/operations.ts";
import { CleanupBlockerSchema } from "../../src/git/retirement-contracts.ts";
import { CrewError } from "../../src/domain.ts";

test("outcome is read-only, receipt-bound and distinguishes approval, delivery, retirement and closure", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(delivered(f));
  e.merge_approval_required = true;
  const pending = await run(
    f.controller.approve(e.issue_id, "merge", Id.SessionId.make("ses_supervisor")),
  );
  assert.ok("form_id" in pending);
  f.runtime.forms.set(pending.form_id, "approved");
  const accepted = await run(
    f.controller.approve(e.issue_id, "merge", Id.SessionId.make("ses_supervisor")),
  );
  assert.ok("current_phase" in accepted);
  assert.equal(accepted.current_phase, "awaiting_merge");
  assert.equal(f.delivery.merged, false, "collecting approval must not merge inline");
  const before = structuredClone(accepted);
  let outcome = deliveryOutcome(accepted, "in_progress", 123);
  assert.equal(outcome.approval.state, "recorded");
  assert.equal(outcome.delivery.state, "unconfirmed");
  assert.equal(outcome.closure, "open");
  assert.equal(outcome.observed_at, 123);
  const item = {
    issue_id: accepted.issue_id,
    title: "Approved delivery",
    priority: 1,
    issue_status: "in_progress" as const,
    phase: "awaiting_merge" as const,
    eligible: false,
    sessions: [],
    blockers: [],
    outcome,
  };
  assert.equal(section(item), "working");
  assert.match(stateLabel(item), /unconfirmed/);
  assert.ok(deliveryOutcomeLines(outcome).includes(outcome.next_action));
  assert.deepEqual(accepted, before);
  accepted.delivery_receipt = {
    commit: accepted.delivered_commit!,
    target: accepted.target_branch!,
    at: Id.timestampAt(100),
  };
  accepted.current_phase = "cleaning";
  outcome = deliveryOutcome(accepted, "in_progress", 124);
  assert.equal(outcome.delivery.state, "verified");
  assert.equal(outcome.delivery.evidence_at, Id.timestampAt(100));
  assert.equal(outcome.closure, "open");
  accepted.retirement = { generated: [], native: "confirmed" };
  assert.equal(deliveryOutcome(accepted, undefined, 125).closure, "unavailable");
  assert.equal(deliveryOutcome(accepted, "closed", 125).cleanup.state, "retired");
  accepted.delivery_policy = "branch";
  assert.equal(deliveryOutcome(accepted, "closed", 125).delivery.kind, "branch");
  accepted.delivered_commit = Id.Commit.make("f".repeat(40));
  outcome = deliveryOutcome(accepted, "in_progress", 126);
  assert.equal(outcome.approval.state, "unavailable");
  assert.equal(outcome.delivery.state, "unconfirmed");
  const completed = (await run(f.controller.reconcile(e.issue_id)))[0];
  assert.equal(completed.current_phase, "completed");
  const count = f.runtime.forms.size;
  const collected = await run(
    f.controller.approve(e.issue_id, "merge", Id.SessionId.make("ses_supervisor")),
  );
  assert.ok("current_phase" in collected);
  assert.equal(collected.current_phase, "completed");
  assert.equal(f.runtime.forms.size, count);
  await assert.rejects(
    run(f.controller.approve(e.issue_id, "merge", e.apply_session_id!)),
    /Workers cannot/,
  );
});

test("cleanup diagnostics remain optional in retained records, bounded and safely displayed", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(delivered(f));
  assert.equal((await run(f.records.execution(e.issue_id)))!.cleanup_blocker, undefined);
  const blocker = {
    paths: [
      {
        path: Id.RelativePath.make("notes/$(touch x)\n\u001bfile"),
        kind: "file" as const,
        category: "ignored" as const,
      },
    ],
    truncated: false,
    observed_at: 100,
    generation: e.control_generation,
    preservation: e.delivered_commit!,
    fingerprint: Id.Fingerprint.make("sample"),
    attempts: 1,
    next_check_at: 30100,
  };
  e.cleanup_blocker = Schema.decodeSync(CleanupBlockerSchema)(blocker);
  e.delivery_receipt = {
    commit: e.delivered_commit!,
    target: e.target_branch!,
    at: Id.timestampAt(100),
  };
  e.current_phase = "cleaning";
  await run(f.records.save(e));
  const retained = (await run(f.records.execution(e.issue_id)))!;
  const outcome = deliveryOutcome(retained, "in_progress", 200);
  assert.equal(outcome.cleanup.state, "blocked");
  assert.equal(outcome.delivery.state, "verified");
  const lines = deliveryOutcomeLines(outcome).join("\n");
  assert.ok(lines.includes(JSON.stringify(blocker.paths[0].path)));
  assert.ok(!lines.includes("\u001b"));
  const decode = Schema.decodeSync(CleanupBlockerSchema);
  for (const invalid of [
    { ...blocker, attempts: 0 },
    { ...blocker, paths: Array(65).fill(blocker.paths[0]) },
    { ...blocker, paths: [{ ...blocker.paths[0], path: "../secret" }] },
    { ...blocker, paths: [{ ...blocker.paths[0], path: "x".repeat(17000) }] },
  ])
    assert.throws(() => decode(invalid));
  const key = Id.StorageKey.make(`execution/${e.issue_id}`);
  const raw = await run(f.records.store.get(key));
  assert.ok(raw && typeof raw === "object");
  await run(f.records.store.set(key, { ...raw, cleanup_blocker: { ...blocker, attempts: 0 } }));
  await assert.rejects(run(f.records.execution(e.issue_id)));
  assert.equal(
    ((await run(f.records.store.get(key))) as { cleanup_blocker: { attempts: number } })
      .cleanup_blocker.attempts,
    0,
  );
});

test("only acquisition contention becomes an unexecuted successful observation", async () => {
  const id = Id.IssueId.make("ticket");
  const reads = {
    execution: () => Effect.fail(new CrewError("READ", "unavailable")),
    issue: () => Effect.fail(new CrewError("READ", "unavailable")),
  };
  const busy = await run(deliveryAction(reads, id, "finish", Effect.fail(new ExecutionBusy(id))));
  assert.ok("category" in busy);
  assert.equal(busy.category, "operation_in_progress");
  assert.equal(busy.performed, false);
  assert.equal(busy.outcome, undefined);
  for (const code of ["LOCKED", "LOCK_ERROR", "MERGE_APPROVAL", "DELIVERY_CHANGED", "LOST"]) {
    await assert.rejects(
      run(deliveryAction(reads, id, "finish", Effect.fail(new CrewError(code, "retain failure")))),
      /retain failure/,
    );
  }
});
