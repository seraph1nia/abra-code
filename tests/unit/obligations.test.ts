import * as Id from "../../src/identities.ts";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { Clock, Effect } from "effect";
import { TestClock } from "effect/testing";
import { fixture } from "../fixtures.ts";
import { run } from "../effects.ts";
import { Controller } from "../../src/workflow/controller.ts";
const question = {
  key: Id.ObligationKey.make("storage"),
  generation: 0,
  scope: "Persistence format",
  question: "Which format?",
  owner: "supervisor" as const,
};

test("keyed questions survive unrelated progress and restart; stale and wrong-role reports are refused", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  f.work.add(Id.IssueId.make("abra-1"));
  const e = await run(f.controller.start(Id.IssueId.make("abra-1"))),
    sid = e.explore_session_id!;
  const d = await run(f.controller.workerQuestion(sid, question));
  assert.deepEqual(await run(f.controller.workerQuestion(sid, question)), d);
  await assert.rejects(
    run(f.controller.workerQuestion(sid, { ...question, question: "Rebound?" })),
    /different/,
  );
  await run(f.controller.workerProgress(sid, 0, "Inspected serializers"));
  const c = new Controller(
    f.config,
    f.records,
    f.work,
    f.spec,
    f.git,
    f.runtime,
    f.delivery,
    f.locks,
  );
  assert.equal((await run(c.get(e.issue_id))).decisions!.length, 1);
  assert.equal((await run(c.reconcile(e.issue_id)))[0].decisions![0].status, "open");
  await assert.rejects(
    run(c.workerProgress(Id.SessionId.make("ses_foreign"), 0, "bad")),
    /active worker/,
  );
  await assert.rejects(run(c.workerProgress(sid, 1, "bad")), /generation/);
  await assert.rejects(run(c.decision(e.issue_id, d.key, 0, sid, "answer", "approve")), /Workers/);
  await run(
    c.decision(e.issue_id, d.key, 0, Id.SessionId.make("ses_supervisor"), "answer", "Use SQLite"),
  );
  const saved = await run(c.get(e.issue_id));
  assert.equal(saved.decisions![0].answer, "Use SQLite");
  assert.deepEqual(saved.approval_receipts, []);
  await run(c.control(e.issue_id, "pause"));
  await assert.rejects(
    run(c.workerQuestion(sid, { ...question, key: Id.ObligationKey.make("other") })),
    /generation|worker/,
  );
  await assert.rejects(
    run(c.decision(e.issue_id, d.key, 0, Id.SessionId.make("ses_supervisor"), "answer", "new")),
    /stale/,
  );
});

test("user decisions retain native form identity, recreate after restart, collect answers without approval authority", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  f.work.add(Id.IssueId.make("abra-1"));
  const e = await run(f.controller.start(Id.IssueId.make("abra-1")));
  const d = await run(
    f.controller.workerQuestion(e.explore_session_id!, { ...question, owner: "user" }),
  );
  await assert.rejects(
    run(
      f.controller.decision(
        e.issue_id,
        d.key,
        0,
        Id.SessionId.make("ses_supervisor"),
        "answer",
        "yes",
      ),
    ),
    /native form/,
  );
  const pending = await run(
    f.controller.decision(e.issue_id, d.key, 0, Id.SessionId.make("ses_supervisor"), "collect"),
  );
  assert.ok(pending.form_id);
  f.runtime.questions.clear();
  const c = new Controller(
    f.config,
    f.records,
    f.work,
    f.spec,
    f.git,
    f.runtime,
    f.delivery,
    f.locks,
  );
  await run(c.reconcile(e.issue_id));
  assert.equal((await run(c.get(e.issue_id))).decisions![0].form_id, pending.form_id);
  assert.equal(f.runtime.questions.size, 1);
  f.runtime.questions.set(pending.form_id!, {
    status: "answered",
    answer: "Use a stable versioned format",
  });
  await run(c.reconcile(e.issue_id));
  const saved = await run(c.get(e.issue_id));
  assert.equal(saved.decisions![0].status, "answered");
  assert.deepEqual(saved.approval_receipts, []);
  assert.equal(saved.current_phase, "exploring");
});

test("dependency/user waits clear only on matching evidence; expiry, invalid command and supersession stay inspectable", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  f.work.add(Id.IssueId.make("abra-1"));
  f.work.add(Id.IssueId.make("abra-dep"), Id.RepositoryId.make("frontend"));
  const e = await run(f.controller.start(Id.IssueId.make("abra-1"))),
    sid = e.explore_session_id!;
  const clock = await run(TestClock.make());
  const call = <A, E>(effect: Effect.Effect<A, E>) =>
    run(effect.pipe(Effect.provideService(Clock.Clock, clock)));
  const wait = {
    key: Id.ObligationKey.make("dep"),
    generation: 0,
    kind: "dependency" as const,
    reference: Id.IssueId.make("abra-dep"),
    condition: "Dependency is closed",
    owner: "dependency owner",
    expires_in_ms: 60000,
  };
  const w = await call(f.controller.workerWait(sid, wait));
  assert.deepEqual(await call(f.controller.workerWait(sid, wait)), w);
  await assert.rejects(
    call(f.controller.workerWait(sid, { ...wait, reference: Id.IssueId.make("abra-1") })),
    /another condition/,
  );
  await assert.rejects(
    call(
      f.controller.workerWait(sid, {
        ...wait,
        key: Id.ObligationKey.make("cmd"),
        kind: "command",
        reference: Id.OperationId.make("invented"),
      }),
    ),
    /controller-owned/,
  );
  await call(f.controller.reconcile(e.issue_id));
  f.work.issues.get("abra-dep")!.status = "closed";
  await call(clock.setTime(30001));
  await call(f.controller.reconcile(e.issue_id));
  assert.equal((await run(f.controller.get(e.issue_id))).waits![0].status, "cleared");
  await call(f.controller.workerQuestion(sid, question));
  await call(
    f.controller.workerWait(sid, {
      ...wait,
      key: Id.ObligationKey.make("answer"),
      kind: "user",
      reference: question.key,
    }),
  );
  await call(
    f.controller.decision(
      e.issue_id,
      Id.ObligationKey.make(question.key),
      0,
      Id.SessionId.make("ses_supervisor"),
      "answer",
      "selected",
    ),
  );
  await call(f.controller.reconcile(e.issue_id));
  assert.equal((await run(f.controller.get(e.issue_id))).waits![1].status, "cleared");
  f.work.issues.get("abra-dep")!.status = "open";
  await call(f.controller.workerWait(sid, { ...wait, key: Id.ObligationKey.make("expires") }));
  await call(clock.setTime(90002));
  await call(f.controller.reconcile(e.issue_id));
  assert.equal((await run(f.controller.get(e.issue_id))).waits![2].status, "expired");
  await run(
    f.controller.waitDisposition(
      e.issue_id,
      Id.ObligationKey.make("expires"),
      0,
      "Dependency no longer needed after inspection",
    ),
  );
  assert.equal((await run(f.controller.get(e.issue_id))).waits![2].status, "superseded");
});
