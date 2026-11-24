import { goal as workGoal } from "../helpers/work-goal.ts";
import { createWorkflow } from "../../src/opencode/application.ts";
import * as Id from "@abracode/contracts/identities";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { Clock, Effect } from "effect";
import { TestClock } from "effect/testing";
import { fixture } from "../fixtures.ts";
import { run } from "../effects.ts";

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
  const { id: issueId } = await run(f.work.create(workGoal("abra-1")));
  const e = await run(f.controller.start(issueId)),
    sid = e.explore_session_id!;
  const d = await run(f.controller.workerQuestion(sid, question));
  assert.deepEqual(await run(f.controller.workerQuestion(sid, question)), d);
  await assert.rejects(
    run(f.controller.workerQuestion(sid, { ...question, question: "Rebound?" })),
    /different/,
  );
  await run(f.controller.workerProgress(sid, 0, "Inspected serializers"));
  const c = createWorkflow(
    f.config,
    f.records,
    f.work,
    f.spec,
    f.git,
    f.runtime,
    f.delivery,
    f.locks,
  ).controller;
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
  const { id: issueId } = await run(f.work.create(workGoal("abra-1")));
  const e = await run(f.controller.start(issueId));
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
  const c = createWorkflow(
    f.config,
    f.records,
    f.work,
    f.spec,
    f.git,
    f.runtime,
    f.delivery,
    f.locks,
  ).controller;
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
  const { id: issueId } = await run(f.work.create(workGoal("abra-1")));
  f.seed.named(Id.IssueId.make("abra-dep"), Id.RepositoryId.make("frontend"));
  const e = await run(f.controller.start(issueId)),
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
    call(f.controller.workerWait(sid, { ...wait, reference: issueId })),
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
  f.seed.close("abra-dep");
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
  const pending = f.seed.named(Id.IssueId.make("pending-dep"));
  await call(
    f.controller.workerWait(sid, {
      ...wait,
      reference: pending.id,
      key: Id.ObligationKey.make("expires"),
    }),
  );
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

test("worker capture owns its scratch files and retains one exact image across restart", async (t) => {
  const { mkdir, writeFile, symlink, rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const { id } = await run(f.work.create(workGoal("proof")));
  const e = await run(f.controller.start(id));
  const sid = e.explore_session_id!;
  const dir = join(f.config.home, ".abracode/browser", sid);
  await mkdir(dir, { recursive: true });
  const data =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=";
  await writeFile(join(dir, "one.png"), Buffer.from(data, "base64"));
  await symlink(join(dir, "one.png"), join(dir, "linked.png"));
  const input = {
    kind: "screenshot" as const,
    request_id: Id.RequestId.make("one"),
    path: Id.RelativePath.make("one.png"),
    description: "Visible result",
    claimed_revision: "main",
  };
  const capture = (generation: number, patch: Partial<typeof input> = {}) =>
    run(f.controller.workerProgress(sid, generation, "Checked display", { ...input, ...patch }));
  await assert.rejects(capture(1), /generation/);
  await assert.rejects(
    capture(0, { path: Id.RelativePath.make("linked.png") }),
    /assigned directory/,
  );
  await writeFile(join(dir, "large.png"), Buffer.alloc(2 * 1024 * 1024 + 1));
  await assert.rejects(capture(0, { path: Id.RelativePath.make("large.png") }), /limit/);
  const receipt = (await capture(0)).capture!;
  await rm(dir, { recursive: true });
  assert.deepEqual((await capture(0)).capture, receipt);
  await assert.rejects(capture(0, { description: "Changed" }), /different inputs/);
  const c = createWorkflow(
    f.config,
    f.records,
    f.work,
    f.spec,
    f.git,
    f.runtime,
    f.delivery,
    f.locks,
  ).controller;
  const { captureSelection } = await import("../../src/web/capture-selection.ts");
  const region = {
    kind: "region" as const,
    issue_id: id,
    request_id: receipt.request_id,
    hash: receipt.hash,
    x: 0,
    y: 0,
    width: 1,
    height: 1,
  };
  assert.match(await run(captureSelection(c.queries, region)), /selected 1×1/);
  await assert.rejects(
    run(captureSelection(c.queries, { ...region, x: 1 })),
    /inside the original/,
  );
  await assert.rejects(
    run(captureSelection(c.queries, { ...region, request_id: Id.RequestId.make("absent") })),
    /unavailable/,
  );
  assert.equal((await run(c.queries.evidence(receipt))).data, data);
  assert.equal((await run(c.queries.verification(id))).evidence?.length, 1);
  await assert.rejects(
    run(c.queries.evidence({ ...receipt, request_id: Id.RequestId.make("different") })),
    /unavailable/,
  );
});
