import { goal as workGoal } from "../helpers/work-goal.ts";
import { retainedExecution } from "../helpers/retained-execution.ts";
import { Records } from "../../src/storage/store.ts";
import { test, vi } from "vite-plus/test";
import assert from "node:assert/strict";
import { fixture } from "../fixtures.ts";
import { run } from "../effects.ts";
import { SessionId } from "../../src/identities.ts";
import { type Execution } from "../../src/domain.ts";
import { isActiveWorker } from "../../src/workflow/worker-assignment.ts";

test("all worker entry points share current role, phase, stop and generation semantics", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const { id: issue } = await run(f.work.create(workGoal("assignment")));
  const started = await run(f.controller.start(issue));
  for (const [role, phase] of [
    ["explore", "exploring"],
    ["explore", "planning"],
    ["apply", "applying"],
    ["review", "verifying"],
    ["research", "researching"],
  ] as const) {
    const session = SessionId.make(`ses_${role}`);
    const e: Execution = {
      ...started,
      active_role: role,
      current_phase: phase,
      [`${role}_session_id`]: session,
    };
    const expected = { role, generation: e.control_generation };
    assert.equal(isActiveWorker(e, session, expected), true);
    assert.equal(isActiveWorker(undefined, session, expected), false);
    assert.equal(isActiveWorker(e, SessionId.make("ses_other"), expected), false);
    assert.equal(isActiveWorker({ ...e, active_role: undefined }, session, expected), false);
    assert.equal(
      isActiveWorker({ ...e, current_phase: "awaiting_merge" }, session, expected),
      false,
    );
    assert.equal(isActiveWorker(e, session, { generation: e.control_generation + 1 }), false);
    assert.equal(
      isActiveWorker(e, session, { role: role === "review" ? "apply" : "review" }),
      false,
    );
    for (const stop_status of ["requested", "confirmed"] as const)
      assert.equal(isActiveWorker({ ...e, stop_status }, session, expected), false);
    const wrongPhase = role === "explore" ? "applying" : "exploring";
    assert.equal(isActiveWorker({ ...e, current_phase: wrongPhase }, session, expected), false);
  }
});

test("assignment hints recover preexisting records, stale candidates and peer commits", async () => {
  const a = SessionId.make("ses_first"),
    b = SessionId.make("ses_peer");
  const { execution, records } = await retainedExecution({ apply_session_id: a });
  const restarted = new Records(records.store);
  for (const e of await run(restarted.executions())) restarted.rememberWorkers(e);
  const scans = vi.spyOn(restarted, "executions");
  assert.equal((await run(restarted.workerAssignment(a)))?.issue_id, execution.issue_id);
  assert.equal(scans.mock.calls.length, 0);
  assert.equal(await run(restarted.workerAssignment(b)), undefined);
  await run(records.patchOwned(execution, { apply_session_id: b }));
  assert.equal((await run(restarted.workerAssignment(b)))?.issue_id, execution.issue_id);
  assert.equal(scans.mock.calls.length, 2);
  await assert.rejects(
    run(records.patchOwned(execution, { apply_session_id: a, rounds: [{} as never] })),
  );
  assert.equal(await run(restarted.workerAssignment(a)), undefined);
  assert.equal(scans.mock.calls.length, 3);
  assert.equal((await run(restarted.workerAssignment(b)))?.apply_session_id, b);
  assert.equal(scans.mock.calls.length, 3);
});
