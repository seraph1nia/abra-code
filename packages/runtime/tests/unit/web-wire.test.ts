import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { Schema } from "effect";
import {
  WorkSnapshotSchema,
  WorkDetailSchema,
  MessagesPageSchema,
  FeedbackPageSchema,
  WorkerInspectionSchema,
  WorkItemSchema,
  DecisionSchema,
  DeclaredWaitSchema,
} from "@abracode/contracts/web/wire";
import { Visibility } from "../../src/visibility/read-model.ts";
import { fixture, planned } from "../fixtures.ts";
import { run } from "../effects.ts";

test("browser task codecs preserve native supervision, delivery, decisions and omitted evidence", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const execution = await run(planned(f));
  const view = new Visibility(f.controller);
  const native = await run(view.snapshot());
  const codec = Schema.fromJsonString(WorkSnapshotSchema);
  const snapshot = Schema.decodeSync(codec)(JSON.stringify(native));
  const task = snapshot.work.find((item) => item.issue_id === execution.issue_id)!;
  assert.equal(task.supervision?.primary, "human_decision");
  assert.equal(task.outcome?.approval.state, "pending");
  assert.equal(task.outcome?.delivery.state, "unconfirmed");
  assert.equal(task.outcome?.cleanup.state, "not_started");
  assert.equal(task.outcome?.closure, "open");
  assert.equal(task.outcome?.execution_id, execution.execution_id);
  assert.equal(task.outcome?.generation, execution.control_generation);
  assert.equal(task.outcome?.delivery.evidence_at, undefined);
  assert.equal(snapshot.fleet?.total, native.fleet?.total);
  assert.equal(snapshot.at, native.at);
  const detail = Schema.decodeSync(WorkDetailSchema)(await run(view.detail(execution.issue_id)));
  assert.equal(detail.work.supervision?.primary, task.supervision?.primary);
  assert.deepEqual(Schema.decodeSync(codec)(Schema.encodeSync(codec)(snapshot)), snapshot);
  assert.throws(() => Schema.decodeSync(WorkSnapshotSchema)({ ...native, at: "yesterday" }));
  assert.throws(() =>
    Schema.decodeUnknownSync(WorkDetailSchema)({
      ...detail,
      work: { ...task, outcome: { ...task.outcome, closure: "delivered" } },
    }),
  );
});

test("browser communication codecs distinguish native admission from retained answers and recovery", () => {
  const record = {
    schema_version: 1,
    request_id: "request-1",
    prompt_id: "msg_request",
    assignment_id: "msg_assignment",
    generation: 2,
    sender_session_id: "ses_abra",
    recipient_session_id: "ses_worker",
    role: "apply",
    prompt: "Please answer",
    body: "Which path?",
    response: "answer",
    delivery: "queue",
    status: "admitted",
    created_at: "2026-11-15T10:00:00Z",
    response_recovery: {
      prompt_id: "msg_recovery",
      prompt: "Answer the original request",
      created_at: "2026-11-15T10:01:00Z",
      completion_id: "msg_completed",
      completed_at: "2026-11-15T10:02:00Z",
      status: "admitted",
    },
  };
  const page = {
    entries: [{ record, native: "consumed", recovery_native: "consumed", native_state: "idle" }],
    total: 1,
    outstanding: 1,
    offset: 0,
    limit: 20,
    observed_at: "2026-11-15T10:03:00Z",
  };
  const decoded = Schema.decodeUnknownSync(MessagesPageSchema)(page);
  assert.deepEqual(decoded, page);
  assert.equal(decoded.outstanding, 1);
  for (const replacement of [
    { status: "answered" },
    { generation: -1 },
    { recipient_session_id: "../foreign" },
  ]) {
    assert.throws(() =>
      Schema.decodeUnknownSync(MessagesPageSchema)({
        ...page,
        entries: [{ record: { ...record, ...replacement } }],
      }),
    );
  }
});

test("decision and wait summaries retain native identities and honest legacy timing gaps", () => {
  const decision = {
    key: "database-choice",
    generation: 1,
    scope: "Storage",
    question: "Which database?",
    owner: "user",
    status: "open",
    session_id: "ses_worker",
    opened_at: 1200,
  };
  assert.deepEqual(Schema.decodeUnknownSync(DecisionSchema)(decision), decision);
  assert.throws(() => Schema.decodeUnknownSync(DecisionSchema)({ ...decision, owner: "browser" }));
  assert.throws(() => Schema.decodeUnknownSync(DecisionSchema)({ ...decision, opened_at: "1200" }));
  const wait = {
    key: "dependency-one",
    generation: 1,
    condition: "Dependency completes",
    owner: "supervisor",
    kind: "dependency",
    reference: "task-two",
    status: "waiting",
  };
  assert.deepEqual(Schema.decodeUnknownSync(DeclaredWaitSchema)(wait), wait);
  assert.throws(() =>
    Schema.decodeUnknownSync(DeclaredWaitSchema)({ ...wait, status: "successful" }),
  );
  const legacy = {
    issue_id: "task-one",
    title: "Old retained surface",
    priority: 1,
    issue_status: "in_progress",
    eligible: false,
    blockers: [],
    sessions: [],
    decisions: [decision],
    waits: [wait],
    attention: [{ id: "incident-one", status: "handled" }],
    progress: {
      generation: 1,
      summary: "Observed work",
      at: 1200,
      source: "worker",
      session_id: "ses_worker",
    },
  };
  const decoded = Schema.decodeUnknownSync(WorkItemSchema)(legacy);
  assert.deepEqual(decoded, legacy);
  assert.equal(decoded.waits?.[0].expires_at, undefined);
  assert.equal(decoded.outcome, undefined);
});

test("browser review and worker codecs reject malformed consumed fields and preserve unavailable evidence", () => {
  const finding = {
    id: "finding-one",
    source_id: "check-one",
    revision: "revision-one",
    head: "a".repeat(40),
    kind: "check",
    text: "Validation could not be read",
    blocking: true,
    evidence_unavailable: "Provider unavailable",
  };
  const page = {
    issue_id: "task-one",
    generation: 0,
    page: 0,
    page_size: 20,
    findings: [finding],
    history: [],
    actions: [],
    external_history: [],
    external_history_total: 0,
    finding_total: 1,
    history_total: 0,
    action_total: 0,
  };
  const decoded = Schema.decodeUnknownSync(FeedbackPageSchema)(page);
  assert.deepEqual(decoded, page);
  assert.equal(decoded.observation, undefined);
  assert.throws(() =>
    Schema.decodeUnknownSync(FeedbackPageSchema)({
      ...page,
      findings: [{ ...finding, blocking: "false" }],
    }),
  );
  const worker = {
    id: "ses_worker",
    role: "apply",
    busy: true,
    executing: false,
    native_activity: "queued",
    observed_at: "2026-11-15T10:00:00Z",
    note: "Pending native prompt",
  };
  assert.deepEqual(Schema.decodeUnknownSync(WorkerInspectionSchema)(worker), worker);
  assert.throws(() =>
    Schema.decodeUnknownSync(WorkerInspectionSchema)({ ...worker, native_activity: "successful" }),
  );
  assert.throws(() =>
    Schema.decodeUnknownSync(WorkerInspectionSchema)({ ...worker, observed_at: "invalid" }),
  );
});
