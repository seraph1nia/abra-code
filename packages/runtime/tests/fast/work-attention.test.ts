import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { Schema } from "effect";
import { humanDecision, taskAttention, usableForm } from "@abracode/contracts/visibility/attention";
import { WorkSummarySchema } from "@abracode/contracts/visibility/work-summary";

const work = (fields: Record<string, unknown>) =>
  Schema.decodeSync(WorkSummarySchema)({
    issue_id: "task-one",
    title: "A task",
    priority: 1,
    issue_status: "in_progress",
    sessions: [],
    eligible: false,
    blockers: [],
    generation: 2,
    ...fields,
  });

test("plan approvals are actionable without an incident, while handled and superseded history stays quiet", () => {
  assert.equal(taskAttention(work({ phase: "awaiting_plan_approval" }))[0].owner, "supervisor");
  const quiet = work({
    attention: [
      { id: "incident-one", status: "handled", code: "worker_failure", generation: 2 },
      { id: "incident-two", status: "superseded", code: "cleanup_blocked", generation: 2 },
      { id: "incident-old", status: "pending", code: "worker_failure", generation: 1 },
    ],
  });
  assert.deepEqual(taskAttention(quiet), []);
});

test("current decision/wait and communication obligations retain an owner and clearing action", () => {
  const observed = work({
    decisions: [
      {
        key: "question",
        generation: 2,
        owner: "user",
        status: "open",
        scope: "Implementation",
        question: "Choose a path",
        session_id: "ses_worker",
        opened_at: 10,
      },
    ],
    waits: [
      {
        key: "waiting",
        generation: 2,
        condition: "Previous command",
        owner: "supervisor",
        kind: "command",
        reference: "operation-one",
        status: "expired",
      },
    ],
    communication: { total: 5, outstanding: 1 },
  });
  const entries = taskAttention(observed);
  assert.deepEqual(
    entries.map((item) => item.owner),
    ["user", "supervisor", "request recipient"],
  );
  assert.ok(entries.every((item) => item.next_action.length > 0));
  assert.match(entries[2].next_action, /response-recovery/);
  assert.deepEqual(
    taskAttention(
      work({
        decisions: observed.decisions?.map((decision) => ({ ...decision, status: "answered" })),
        waits: observed.waits?.map((wait) => ({ ...wait, status: "cleared" })),
        communication: { total: 5, outstanding: 0 },
      }),
    ),
    [],
  );
});

test("delivery, cleanup and closure stay independent and quiet waits do not ask for human input", () => {
  const outcome = {
    execution_id: "execution-one",
    generation: 2,
    observed_at: 20,
    approval: { kind: "merge", state: "recorded" },
    delivery: { kind: "branch", state: "verified" },
    cleanup: { state: "blocked", generated_paths: [] },
    closure: "open",
    next_action: "Inspect retained files in Abra",
  };
  const observed = work({ phase: "awaiting_merge", outcome });
  const attention = taskAttention(observed);
  assert.equal(attention.length, 1);
  assert.equal(attention[0].key, "cleanup");
  assert.equal(observed.outcome?.delivery.state, "verified");
  assert.equal(observed.outcome?.closure, "open");
  assert.deepEqual(
    taskAttention(
      work({
        capacity_wait: { role: "apply", reasons: ["No slots"], consuming: [], next_check_at: 20 },
      }),
    ),
    [],
  );
  assert.deepEqual(
    taskAttention(
      work({
        waits: [
          {
            key: "dependency",
            generation: 2,
            condition: "Another task",
            owner: "supervisor",
            kind: "dependency",
            reference: "task-two",
            status: "waiting",
          },
        ],
      }),
    ),
    [],
  );
});

test("only a delivered input for the human enters the action count", () => {
  const entries = taskAttention(
    work({
      phase: "awaiting_plan_approval",
      communication: {
        total: 21,
        outstanding: 1,
        first: { request_id: "question-21", offset: 20 },
      },
      outcome: {
        execution_id: "e",
        generation: 2,
        observed_at: 1,
        approval: { kind: "plan", state: "pending", form_id: "frm_plan" },
        delivery: { kind: "branch", state: "unconfirmed" },
        cleanup: { state: "not_started", generated_paths: [] },
        closure: "open",
        next_action: "Review the plan",
      },
    }),
  );
  assert.deepEqual(
    entries
      .filter((item) => humanDecision(item.owner, Boolean(item.form_id)))
      .map((item) => item.form_id),
    ["frm_plan"],
  );
  assert.deepEqual(entries.find((item) => item.key === "communication")?.request, {
    request_id: "question-21",
    offset: 20,
  });
  assert.equal(usableForm({ active: true, checkpoint: { active: false } }), false);
  assert.equal(usableForm({ active: true }), true);
});
