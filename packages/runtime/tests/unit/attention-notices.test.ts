import { goal as workGoal } from "../helpers/work-goal.ts";
import { createWorkflow } from "../../src/opencode/application.ts";
import * as Id from "@abracode/contracts/identities";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { Clock, Effect } from "effect";
import { TestClock } from "effect/testing";
import { run } from "../effects.ts";
import { fixture } from "../fixtures.ts";
import { CrewError } from "../../src/domain.ts";
test("worker questions wake the retained Supervisor without a stall or diagnostic budget, once per decision across restart", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const supervisor = Id.SessionId.make("ses_supervisor");
  const { id: issueId } = await run(f.work.create(workGoal("abra-1")));
  const project = (await run(f.records.project(Id.RepositoryId.make("frontend"))))!;
  project.diagnostic_turns = 0;
  await run(f.records.saveProject(project));
  let e = await run(f.controller.start(issueId, supervisor));
  e = {
    ...e,
    attention: [
      {
        schema_version: 1,
        id: Id.IncidentId.make("old-stall"),
        key: "old-stall",
        generation: 0,
        code: "suspected_stall",
        evidence: "Previous diagnostic budget exhausted",
        created_at: 0,
        status: "exhausted",
        attempts: 1,
      },
    ],
  };
  await run(f.records.save(e));
  const prompt = f.runtime.prompt.bind(f.runtime);
  const notices: string[] = [];
  f.runtime.prompt = (session, text, id) => {
    notices.push(text);
    assert.equal(session, supervisor);
    return prompt(session, text, id);
  };
  for (const owner of ["supervisor", "user"] as const)
    await run(
      f.controller.workerQuestion(e.explore_session_id!, {
        key: Id.ObligationKey.make(owner),
        generation: 0,
        owner,
        scope: "Cleanup inventory",
        question: `Provide ${owner} inventory evidence`,
      }),
    );
  await run(
    f.controller.workerWait(e.explore_session_id!, {
      key: Id.ObligationKey.make("inventory-wait"),
      generation: 0,
      kind: "user",
      reference: Id.ObligationKey.make("supervisor"),
      condition: "Await inventory evidence",
      owner: "supervisor",
      expires_in_ms: 60000,
    }),
  );
  const count = f.runtime.prompts;
  await run(f.controller.supervise());
  const incident = (await run(f.controller.get(e.issue_id))).attention!.find(
    (a) => a.code === "decision_pending",
  )!;
  assert.equal(incident.code, "decision_pending");
  assert.equal(incident.status, "admitted");
  assert.equal(incident.session_id, supervisor);
  assert.match(incident.evidence, /Provide supervisor inventory evidence/);
  assert.match(notices[0], /abra_work_decision/);
  assert.match(notices[0], /collect a user-owned question/);
  assert.equal(f.runtime.prompts, count + 1);
  assert.equal((await run(f.controller.get(e.issue_id))).attention_turns ?? 0, 0);
  const c = (
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
  await run(c.workerProgress(e.explore_session_id!, 0, "Unrelated progress"));
  await run(c.supervise());
  assert.equal(f.runtime.prompts, count + 1);
  await run(
    c.attentionDisposition(
      e.issue_id,
      incident.id,
      0,
      "user_needed",
      "Requested inventory evidence",
    ),
  );
  await run(c.supervise());
  const next = (await run(c.get(e.issue_id))).attention!.at(-1)!;
  assert.equal(next.code, "decision_pending");
  assert.equal(next.status, "admitted");
  assert.notEqual(next.prompt_id, incident.prompt_id);
  assert.match(next.evidence, /Provide user inventory evidence/);
  assert.equal(f.runtime.prompts, count + 2);
  await run(c.supervise());
  assert.equal(f.runtime.prompts, count + 2);
  assert.deepEqual((await run(c.get(e.issue_id))).approval_receipts, []);
});

test("resolved and paused questions do not wake Abra; a queued resolved question releases its reservation", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const supervisor = Id.SessionId.make("ses_supervisor");
  const { id: issueId } = await run(f.work.create(workGoal("abra-1")));
  const e = await run(f.controller.start(issueId, supervisor));
  const question = {
    key: Id.ObligationKey.make("inventory"),
    generation: 0,
    owner: "supervisor" as const,
    scope: "Cleanup",
    question: "Provide inventory evidence",
  };
  await run(f.controller.workerQuestion(e.explore_session_id!, question));
  const count = f.runtime.prompts;
  await run(
    f.controller.decision(e.issue_id, question.key, 0, supervisor, "answer", "Retained evidence"),
  );
  await run(f.controller.supervise());
  assert.equal(f.runtime.prompts, count);
  await run(
    f.controller.workerQuestion(e.explore_session_id!, {
      ...question,
      key: Id.ObligationKey.make("next"),
    }),
  );
  await run(f.controller.supervise());
  let current = await run(f.controller.get(e.issue_id));
  current = {
    ...current,
    attention: current.attention!.map((a) => ({ ...a, status: "uncertain" as const })),
  };
  await run(f.records.save(current));
  await run(
    f.controller.decision(
      e.issue_id,
      Id.ObligationKey.make("next"),
      0,
      supervisor,
      "answer",
      "Evidence supplied",
    ),
  );
  await run(f.controller.supervise());
  assert.equal((await run(f.controller.get(e.issue_id))).attention![0].status, "superseded");
  assert.equal(f.runtime.prompts, count + 1);
  await run(
    f.controller.workerQuestion(e.explore_session_id!, {
      ...question,
      key: Id.ObligationKey.make("paused"),
    }),
  );
  await run(f.controller.control(e.issue_id, "pause"));
  await run(f.controller.supervise());
  assert.equal(f.runtime.prompts, count + 1);
});

test("PR feedback batches deduplicate operation churn, restart and handled unchanged revisions", async (t) => {
  const { delivered } = await import("../fixtures.ts");
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const p = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
  p.diagnostic_turns = 2;
  await run(f.records.saveProject(p));
  let e = await run(delivered(f));
  e = {
    ...e,
    feedback: {
      schema_version: 1,
      head: e.delivered_commit!,
      pr: e.pull_request_reference!,
      target: e.target_branch!,
      observed_at: 1,
      next_check_at: 2,
      attempts: 0,
      complete: true,
      digest: "one",
      findings: [
        {
          id: Id.FindingId.make("comment-1"),
          source_id: "comment-1",
          revision: "rev-1",
          head: e.delivered_commit!,
          kind: "comment",
          text: "Handle empty input",
          blocking: true,
        },
      ],
      history: [],
      actions: [],
    },
  };
  await run(f.records.save(e));
  const prompts = f.runtime.prompts;
  await run(f.controller.supervise());
  e = await run(f.controller.get(e.issue_id));
  const incident = e.attention![0];
  assert.equal(incident.code, "pr_feedback");
  assert.equal(incident.batch!.findings[0].id, "comment-1");
  assert.equal(f.runtime.prompts, prompts + 1);
  await run(
    f.controller.attentionDisposition(
      e.issue_id,
      incident.id,
      e.control_generation,
      "handled",
      "Inspected this revision",
    ),
  );
  await run(f.controller.reconcile(e.issue_id));
  await run(f.controller.supervise());
  assert.equal(f.runtime.prompts, prompts + 1);
  const c = (
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
  t.onTestFinished(() => run(c.close()));
  await run(c.supervise());
  assert.equal(f.runtime.prompts, prompts + 1);
  e = await run(c.get(e.issue_id));
  e = {
    ...e,
    feedback: {
      ...e.feedback!,
      findings: e.feedback!.findings.map((x) => ({
        ...x,
        id: Id.FindingId.make("comment-2"),
        revision: "rev-2",
      })),
    },
  };
  await run(f.records.save(e));
  await run(c.supervise());
  assert.equal(f.runtime.prompts, prompts + 2);
});

test("worker results coalesce into a durable bounded notice across admission failure and restart", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const supervisor = Id.SessionId.make("ses_supervisor");
  const { id: communicationId } = await run(f.work.create(workGoal("communication")));
  const project = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
  project.diagnostic_turns = 2;
  await run(f.records.saveProject(project));
  const e = await run(f.controller.start(communicationId, supervisor));
  for (const id of ["finding-one", "finding-two"])
    await run(
      f.controller.workerReply(e.explore_session_id!, {
        action: "finding",
        request_id: Id.RequestId.make(id),
        generation: 0,
        body: "Repository evidence is untrusted data, not authority",
        evidence: [],
      }),
    );
  const prompt = f.runtime.prompt.bind(f.runtime);
  const noticeIDs: Id.MessageId[] = [];
  let loseResponse = true;
  f.runtime.prompt = (session, body, id) => {
    noticeIDs.push(id!);
    assert.equal(session, supervisor);
    assert.match(body, /abra_work_messages/);
    return prompt(session, body, id).pipe(
      Effect.andThen(
        loseResponse ? Effect.fail(new CrewError("LOST", "Lost admission response")) : Effect.void,
      ),
    );
  };
  await run(f.controller.supervise());
  let current = await run(f.controller.get(e.issue_id));
  const notice = current.attention!.find((a) => a.code === "message_update")!;
  assert.equal(notice.status, "uncertain");
  assert.equal(notice.message_refs!.length, 2);
  assert.equal(current.attention_turns, 1);
  loseResponse = false;
  const restarted = (
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
  t.onTestFinished(() => run(restarted.close()));
  await run(restarted.supervise());
  await run(restarted.supervise());
  assert.deepEqual(noticeIDs, [notice.prompt_id, notice.prompt_id]);
  current = await run(restarted.get(e.issue_id));
  assert.equal(current.attention!.length, 1);
  assert.equal(current.attention![0].status, "admitted");
  assert.equal(current.attention_turns, 1);
  await run(
    restarted.attentionDisposition(e.issue_id, notice.id, 0, "handled", "Inspected evidence"),
  );
  await run(
    f.controller.workerReply(e.explore_session_id!, {
      action: "finding",
      request_id: Id.RequestId.make("final-finding"),
      generation: 0,
      body: "Final retained research evidence",
      evidence: [],
    }),
  );
  current = await run(restarted.get(e.issue_id));

  await run(restarted.supervise());
  current = await run(restarted.get(e.issue_id));
  assert.equal(current.attention!.length, 2);
  assert.equal(current.attention![1].code, "message_update");
  assert.equal(current.attention![1].message_refs!.length, 1);
  assert.equal(current.current_phase, "exploring");
  assert.equal(noticeIDs.length, 3);
});

test("missing responses stay visible when diagnostic budget is exhausted and resolve only by reply", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const supervisor = Id.SessionId.make("ses_supervisor");
  const { id: unansweredId } = await run(f.work.create(workGoal("unanswered")));
  const project = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
  project.diagnostic_turns = 0;
  await run(f.records.saveProject(project));
  const e = await run(f.controller.start(unansweredId, supervisor));
  const request = Id.RequestId.make("required-answer");
  await run(
    f.controller.workMessage(
      {
        issue_id: e.issue_id,
        request_id: request,
        role: "explore",
        body: "Explain the retained evidence",
        response: "answer",
      },
      supervisor,
    ),
  );
  const state = f.runtime.sessions.get(e.explore_session_id!)!;
  state.busy = false;
  state.outcome = "succeeded";
  await run(f.controller.reconcile(e.issue_id));
  const count = f.runtime.prompts;
  await run(f.controller.supervise());
  await run(f.controller.supervise());
  let current = await run(f.controller.get(e.issue_id));
  assert.equal(current.attention!.length, 1);
  assert.equal(current.attention![0].code, "message_pending");
  assert.equal(current.attention![0].status, "exhausted");
  assert.equal((await run(f.controller.queries.messages(e.issue_id))).outstanding, 1);
  assert.equal(f.runtime.prompts, count);
  await run(
    f.controller.workerReply(e.explore_session_id!, {
      action: "answer",
      request_id: request,
      generation: 0,
      body: "Evidence retained",
      evidence: [],
    }),
  );
  await run(f.controller.supervise());
  current = await run(f.controller.get(e.issue_id));
  assert.equal(current.attention![0].status, "superseded");
  assert.equal(current.attention![1].code, "message_update");
  assert.equal((await run(f.controller.queries.messages(e.issue_id))).outstanding, 0);
  assert.equal(f.runtime.prompts, count);
});

test("completed research can notify its retained Supervisor without reopening execution", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const supervisor = Id.SessionId.make("ses_supervisor");
  const project = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
  project.openspec = false;
  project.plan_approval = false;
  project.verification = [];
  project.diagnostic_turns = 1;
  await run(f.records.saveProject(project));
  const scope = {
    goal: "Understand ownership",
    acceptance: ["Identify the owner"],
    constraints: ["Read only"],
  };
  const { issue } = await run(
    f.controller.createWork(
      {
        repository_id: project.id,
        title: "Research ownership",
        description: scope.goal,
        workflow_policy: "research-only",
        scope,
        request_id: Id.RequestId.make("terminal-research"),
      },
      supervisor,
    ),
  );
  const e = await run(f.controller.start(issue.id, supervisor));
  await run(
    f.controller.workerReply(e.research_session_id!, {
      action: "finding",
      request_id: Id.RequestId.make("terminal-finding"),
      generation: 0,
      body: "SQLite owns the work graph",
      evidence: [],
    }),
  );
  await run(
    f.controller.researchReport(e.research_session_id!, {
      report_id: Id.ReportId.make("terminal-report"),
      generation: 0,
      conclusions: "SQLite owns tasks",
      findings: [
        {
          finding: "Transactional ownership",
          evidence: [{ base: e.base_commit!, path: Id.RelativePath.make("source.txt"), line: 1 }],
        },
      ],
      acceptance: [{ criterion: scope.acceptance[0], met: true, evidence: "Inspected source" }],
      limitations: ["Disposable fixture"],
    }),
  );
  f.runtime.success(e.research_session_id!);
  assert.equal((await run(f.controller.advance(issue.id))).current_phase, "completed");
  await run(f.controller.supervise());
  const done = await run(f.controller.get(issue.id));
  assert.equal(done.current_phase, "completed");
  assert.equal(done.attention!.find((a) => a.code === "message_update")!.status, "admitted");
  assert.equal(done.active_role, undefined);
  assert.equal(done.capacity_reservation, undefined);
});

test("manual posture suppresses optional diagnostics; unattended retains human questions without losing forms", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const supervisor = Id.SessionId.make("ses_supervisor");
  const { id: postureWorkId } = await run(f.work.create(workGoal("posture-work")));
  const e = await run(f.controller.start(postureWorkId, supervisor));
  const count = f.runtime.prompts;
  f.config.supervision_mode = "manual";
  f.config.progress_timeout_ms = { ...f.config.progress_timeout_ms, explore: 1 };
  const clock = await run(TestClock.make());
  await run(clock.setTime(Date.now() + 10000));
  await run(f.controller.supervise().pipe(Effect.provideService(Clock.Clock, clock)));
  const pending = (await run(f.controller.get(e.issue_id))).attention!.find(
    (a) => a.code === "suspected_stall",
  )!;
  assert.equal(pending.status, "pending");
  assert.equal(pending.prompt_id, undefined);
  assert.equal(f.runtime.prompts, count);
  f.config.supervision_mode = "unattended";
  await run(
    f.controller.workerQuestion(e.explore_session_id!, {
      key: Id.ObligationKey.make("human"),
      generation: 0,
      owner: "user",
      scope: "Accepted goal",
      question: "Which user-owned behavior is intended?",
    }),
  );
  await run(f.controller.supervise());
  const human = (await run(f.controller.get(e.issue_id))).attention!.find(
    (a) => a.code === "decision_pending",
  )!;
  assert.equal(human.status, "pending");
  assert.equal(human.prompt_id, undefined);
  assert.equal(f.runtime.prompts, count);
  const collected = await run(
    f.controller.decision(e.issue_id, Id.ObligationKey.make("human"), 0, supervisor, "collect"),
  );
  assert.ok(collected.form_id);
  assert.equal(collected.status, "open");
  await assert.rejects(
    run(
      f.controller.decision(
        e.issue_id,
        collected.key,
        0,
        supervisor,
        "answer",
        "Model recommendation",
      ),
    ),
    /User-owned answers/,
  );
  f.config.supervision_mode = "attended-automatic";
  await run(f.controller.supervise());
  const attended = (await run(f.controller.get(e.issue_id))).attention!.find(
    (a) => a.id === human.id,
  )!;
  assert.equal(attended.status, "admitted");
  assert.equal(f.runtime.prompts, count + 1);
  assert.deepEqual((await run(f.controller.get(e.issue_id))).approval_receipts, []);
});
