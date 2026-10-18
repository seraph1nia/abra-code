import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { Effect } from "effect";
import { fixture } from "../fixtures.ts";
import { run } from "../effects.ts";
import * as Id from "../../src/identities.ts";
import { CrewError, type Execution, type ReadinessBlocker } from "../../src/domain.ts";
import {
  supervisionSummary,
  SupervisionAggregateSchema,
} from "../../src/visibility/supervision.ts";
import { decode } from "../../src/decode.ts";

test("primary supervision counts are exclusive projections; native queued and unavailable remain honest", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  f.work.add(Id.IssueId.make("summary"));
  const e = await run(f.controller.start(Id.IssueId.make("summary")));
  const native = { ...f.runtime.sessions.get(e.explore_session_id!)!, executing: true };
  const at = Id.timestampAt(Date.now());
  const project = (
    patch: Partial<Execution>,
    blockers: ReadinessBlocker[] = [],
    observation = native,
  ) =>
    supervisionSummary({
      execution: { ...e, ...patch },
      blockers,
      native: observation,
      observed_at: at,
    });
  const decision = {
    schema_version: 1 as const,
    key: Id.ObligationKey.make("question"),
    generation: e.control_generation,
    status: "open" as const,
    session_id: e.explore_session_id!,
    scope: "Accepted task",
    question: "Which evidence?",
    opened_at: 1,
  };
  const checks: Array<
    [Partial<Execution>, (typeof SupervisionAggregateSchema)["Type"]["tasks"][number]["primary"]]
  > = [
    [{ current_phase: "completed" }, "completed"],
    [{ current_phase: "failed" }, "recovery_required"],
    [{ current_phase: "blocked", delivery_block: "CI_FAILED" }, "delivery_wait"],
    [
      { current_phase: "recovery_required", decisions: [{ ...decision, owner: "user" }] },
      "recovery_required",
    ],
    [{ current_phase: "interrupted" }, "paused"],
    [{ current_phase: "awaiting_plan_approval" }, "human_decision"],
    [
      {
        decisions: [
          { ...decision, owner: "user" },
          { ...decision, owner: "supervisor" },
        ],
      },
      "human_decision",
    ],
    [{ decisions: [{ ...decision, owner: "supervisor" }] }, "supervisor_decision"],
    [
      {
        current_phase: "failed",
        worker_failure: {
          session_id: native.id,
          prompt_id: e.prompt_id,
          error: { type: "APIError", message: "Provider failed" },
          at,
        },
      },
      "provider_failure",
    ],
    [{ current_phase: "failed", resume_phase: "verifying" }, "validation_failure"],
    [
      {
        current_phase: "blocked",
        review_receipt: {
          passed: false,
          findings: "In-scope regression",
          session_id: native.id,
          fingerprint: Id.Fingerprint.make("test-fingerprint"),
        },
      },
      "review_failure",
    ],
    [{ current_phase: "awaiting_merge", merge_approval_required: false }, "delivery_wait"],
    [{ current_phase: "awaiting_merge", merge_approval_required: true }, "human_decision"],
    [{}, "running"],
  ];
  for (const [patch, primary] of checks) assert.equal(project(patch).primary, primary);
  assert.equal(
    project({}, [{ code: "dependency", message: "Unfinished parent" }]).primary,
    "dependency_wait",
  );
  assert.equal(
    project({
      attention: [
        {
          schema_version: 1,
          id: Id.IncidentId.make("stall"),
          generation: e.control_generation,
          key: "stall",
          code: "suspected_stall",
          evidence: "No recent progress",
          created_at: 1,
          status: "admitted",
          attempts: 1,
        },
      ],
    }).primary,
    "suspected_stall",
  );
  const queued = project({}, [], { ...native, executing: false, busy: true });
  assert.equal(queued.primary, "pending_admission");
  assert.equal(queued.native_activity, "queued");
  assert.equal(
    project({ capacity_reservation: undefined }, [], { ...native, executing: false, busy: false })
      .primary,
    "idle",
  );
  const before = await run(f.controller.get(e.issue_id));
  const creates = f.runtime.creates,
    prompts = f.runtime.prompts;
  f.runtime.session = () => Effect.fail(new CrewError("NATIVE_UNAVAILABLE", "Fixture unavailable"));
  const unknown = await run(
    f.controller.queries.supervision({ ...e, capacity_reservation: undefined }),
  );
  assert.equal(unknown.primary, "unknown");
  assert.equal(unknown.native_activity, "unavailable");
  const aggregate = await run(f.controller.queries.supervisionAggregate());
  await run(decode(SupervisionAggregateSchema, aggregate, "Summary proof"));
  assert.equal(
    Object.values(aggregate.counts).reduce((a, b) => a + b, 0),
    aggregate.tasks.length,
  );
  assert.equal(aggregate.total, 1);
  assert.equal(aggregate.truncated, false);
  assert.deepEqual(await run(f.controller.get(e.issue_id)), before);
  assert.equal(f.runtime.creates, creates);
  assert.equal(f.runtime.prompts, prompts);
  for (let index = 0; index < 129; index++) f.work.add(Id.IssueId.make(`queued-${index}`));
  const bounded = await run(f.controller.queries.supervisionAggregate());
  assert.equal(bounded.tasks.length, 128);
  assert.equal(bounded.total, 130);
  assert.equal(bounded.truncated, true);
  assert.equal(
    Object.values(bounded.counts).reduce((a, b) => a + b, 0),
    128,
  );
});
