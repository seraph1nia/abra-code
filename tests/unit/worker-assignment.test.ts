import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { fixture } from "../fixtures.ts";
import { run } from "../effects.ts";
import { IssueId, SessionId } from "../../src/identities.ts";
import { type Execution } from "../../src/domain.ts";
import { isActiveWorker } from "../../src/workflow/worker-assignment.ts";

test("all worker entry points share current role, phase, stop and generation semantics", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const issue = IssueId.make("assignment");
  f.work.add(issue);
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
