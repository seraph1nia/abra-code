import { Effect } from "effect";
import { Controller } from "../../src/workflow/controller.ts";
import { CrewError } from "../../src/domain.ts";
import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { BatchInputSchema, normalizeBatch } from "../../src/work/batch.ts";
import { strictInput } from "../../src/opencode/tool-definition.ts";
import { run } from "../effects.ts";
import { fixture } from "../fixtures.ts";
import * as Id from "../../src/identities.ts";

const task = {
  client_key: "one",
  repository_id: Id.RepositoryId.make("api"),
  title: "Task",
  description: "Requested goal",
};
const batch = { request_id: Id.RequestId.make("batch-request"), tasks: [task] };

test("batch contracts bound keyed tasks and reject ambiguous references or authority fields", () => {
  const validate = strictInput(BatchInputSchema)["~standard"].validate;
  for (const input of [
    { ...batch, tasks: [] },
    { ...batch, tasks: Array.from({ length: 33 }, (_, i) => ({ ...task, client_key: String(i) })) },
    { ...batch, tasks: [task, task] },
    { ...batch, tasks: [{ ...task, priority: -1 }] },
    { ...batch, tasks: [{ ...task, dependencies: ["one"] }] },
    { ...batch, tasks: [{ ...task, dependencies: [{ type: "local", issue_id: "one" }] }] },
    { ...batch, auto_merge: true },
    { ...batch, tasks: [{ ...task, request_id: "adopt-existing" }] },
  ])
    assert.ok("issues" in validate(input));
  assert.ok("value" in validate(batch));
  for (const dependencies of [
    [{ type: "local", client_key: "missing" }],
    [{ type: "local", client_key: "one" }],
  ])
    assert.throws(() => normalizeBatch({ ...batch, tasks: [{ ...task, dependencies }] }));
  assert.throws(
    () =>
      normalizeBatch({
        ...batch,
        tasks: [
          { ...task, dependencies: [{ type: "local", client_key: "two" }] },
          { ...task, client_key: "two", dependencies: [{ type: "local", client_key: "one" }] },
        ],
      }),
    { code: "BATCH_CYCLE" },
  );
});

test("batch normalization is deterministic for reordered definitions, fields and duplicate dependencies", () => {
  const first = {
    ...batch,
    tasks: [
      {
        ...task,
        client_key: "a",
        title: "  Task  ",
        scope: { constraints: [], acceptance: ["Pass"], goal: "Goal" },
        dependencies: [
          { type: "local", client_key: "A" },
          { type: "local", client_key: "A" },
        ],
      },
      { ...task, client_key: "A" },
    ],
  };
  const second = {
    tasks: [
      { description: "Requested goal", title: "Task", repository_id: "api", client_key: "A" },
      {
        description: "Requested goal",
        title: "Task",
        client_key: "a",
        repository_id: "api",
        scope: { goal: "Goal", acceptance: ["Pass"], constraints: [] },
        dependencies: [{ client_key: "A", type: "local" }],
      },
    ],
    request_id: "batch-request",
  };
  assert.equal(JSON.stringify(normalizeBatch(first)), JSON.stringify(normalizeBatch(second)));
});

test("batch intake validates every project, workflow and scope without dispatching", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const sender = Id.SessionId.make("ses_supervisor");
  for (const invalid of [
    { ...task, client_key: "bad", repository_id: Id.RepositoryId.make("missing") },
    { ...task, client_key: "bad", workflow_policy: "research-only" as const },
    {
      ...task,
      client_key: "bad",
      workflow_policy: "lightweight-fix" as const,
      quality_profile: "strict" as const,
      scope: { goal: "Bounded", acceptance: ["Pass"], constraints: [] },
    },
  ])
    await assert.rejects(
      run(f.controller.createWorkBatch({ ...batch, tasks: [task, invalid] }, sender)),
    );
  assert.equal((await run(f.work.list)).length, 0);
  assert.equal(f.runtime.creates, 0);
  const result = await run(
    f.controller.createWorkBatch(
      {
        ...batch,
        tasks: [
          { ...task, dependencies: [{ type: "local", client_key: "later" }] },
          { ...task, client_key: "later" },
        ],
      },
      sender,
    ),
  );
  assert.equal(result.tasks.length, 2);
  const one = result.tasks.find((t) => t.client_key === "one")!,
    later = result.tasks.find((t) => t.client_key === "later")!;
  assert.deepEqual(one.issue.dependencies, [later.issue.id]);
  assert.equal(one.readiness?.eligible, false);
  assert.equal(later.readiness?.eligible, true);
  assert.equal(f.runtime.creates, 0);
  assert.deepEqual(
    (
      await run(
        f.controller.createWorkBatch(
          {
            ...batch,
            tasks: [
              { ...task, client_key: "later" },
              { ...task, dependencies: [{ type: "local", client_key: "later" }] },
            ],
          },
          sender,
        ),
      )
    ).tasks.map((t) => t.issue.id),
    result.tasks.map((t) => t.issue.id),
  );
});

test("a lost batch response returns the original mapping after controller restart", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const create = f.work.createBatch.bind(f.work);
  let lose = true;
  f.work.createBatch = (input) =>
    create(input).pipe(
      Effect.flatMap((result) => {
        if (lose) {
          lose = false;
          return Effect.fail(new CrewError("RESPONSE_LOST", "Batch response lost"));
        }
        return Effect.succeed(result);
      }),
    );
  const sender = Id.SessionId.make("ses_supervisor");
  await assert.rejects(run(f.controller.createWorkBatch(batch, sender)), { code: "RESPONSE_LOST" });
  const recorded = await run(f.work.list);
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
  const recovered = await run(restarted.createWorkBatch(batch, sender));
  assert.equal(recovered.tasks[0].issue.id, recorded[0].id);
  assert.equal(f.work.creations, 1);
  assert.equal(f.runtime.creates, 0);
});

test("batch research follow-ons retain exact report validation and dependencies", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const sender = Id.SessionId.make("ses_supervisor");
  const p = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
  p.openspec = false;
  p.plan_approval = false;
  p.verification = [];
  await run(f.records.saveProject(p));
  const scope = {
    goal: "Understand ownership",
    acceptance: ["Identify the owner"],
    constraints: ["Read only"],
  };
  const { issue } = await run(
    f.controller.createWork(
      {
        repository_id: task.repository_id,
        title: task.title,
        description: task.description,
        workflow_policy: "research-only",
        scope,
        request_id: Id.RequestId.make("batch-source-report"),
      },
      sender,
    ),
  );
  const source = await run(f.controller.start(issue.id, sender));
  const report = await run(
    f.controller.researchReport(source.research_session_id!, {
      report_id: Id.ReportId.make("batch-source"),
      generation: 0,
      conclusions: "SQLite owns tasks",
      findings: [
        {
          finding: "Claims are transactional",
          evidence: [
            { base: source.base_commit!, path: Id.RelativePath.make("source.txt"), line: 1 },
          ],
        },
      ],
      acceptance: [{ criterion: scope.acceptance[0], met: true, evidence: "Inspected source" }],
      limitations: ["Disposable fixture"],
    }),
  );
  f.runtime.success(source.research_session_id!);
  await run(f.controller.advance(issue.id));
  const input = {
    request_id: Id.RequestId.make("batch-report-follow-on"),
    tasks: [
      {
        ...task,
        repository_id: Id.RepositoryId.make("frontend"),
        report_reference: { issue_id: issue.id, report_id: report.report_id, hash: report.hash },
      },
    ],
  };
  const count = f.runtime.creates;
  const result = await run(f.controller.createWorkBatch(input, sender));
  assert.deepEqual(result.tasks[0].issue.dependencies, [issue.id]);
  assert.deepEqual(result.tasks[0].issue.report_reference, input.tasks[0].report_reference);
  await assert.rejects(
    run(
      f.controller.createWorkBatch(
        {
          ...input,
          request_id: Id.RequestId.make("bad-report"),
          tasks: [
            {
              ...input.tasks[0],
              report_reference: {
                ...input.tasks[0].report_reference,
                hash: Id.ContentHash.make("0".repeat(64)),
              },
            },
          ],
        },
        sender,
      ),
    ),
    { code: "REPORT_REFERENCE" },
  );
  assert.equal((await run(f.work.list)).length, 2);
  assert.equal(f.runtime.creates, count);
});
