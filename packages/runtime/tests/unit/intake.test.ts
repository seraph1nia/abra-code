import { goal as workGoal } from "../helpers/work-goal.ts";
import { createWorkflow } from "../../src/opencode/application.ts";
import * as Id from "@abracode/contracts/identities";
import { CrewError } from "../../src/domain.ts";
import { domainEffect, run } from "../effects.ts";
import { Effect } from "effect";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { fixture } from "../fixtures.ts";

const goal = {
  repository_id: Id.RepositoryId.make("api"),
  title: "Refactor to Agent Package Manager",
  description:
    "Investigate the existing APM configuration and propose a refactor to make it authoritative.",
  request_id: Id.RequestId.make("apm-refactor-1"),
};
test("requested goals create associated WorkGraph work that can immediately start Explore", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const created = await run(f.controller.createWork(goal, Id.SessionId.make("ses_supervisor")));
  assert.equal(created.issue.title, goal.title);
  assert.equal(created.issue.description, goal.description);
  assert.equal(created.issue.priority, 2);
  assert.equal(created.issue.repository_id, "api");
  assert.equal(created.issue.workflow_policy, "full-openspec");
  assert.equal(created.readiness?.eligible, true);
  assert.equal(f.runtime.creates, 0);
  const e = await run(f.controller.start(created.issue.id, Id.SessionId.make("ses_supervisor")));
  assert.equal(e.current_phase, "exploring");
  const persisted = await run(f.records.execution(created.issue.id));
  assert.equal(persisted?.schema_version, 1);
  assert.deepEqual(persisted?.effective_policy, e.effective_policy);
  assert.ok(e.worktree_directory && e.explore_session_id);
  assert.equal(
    (await run(f.controller.createWork(goal, Id.SessionId.make("ses_supervisor")))).issue.id,
    created.issue.id,
  );
  assert.equal((await run(f.work.list)).length, 1);
});
test("creation validates repository, goal, priority and dependencies before mutating WorkGraph", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  await assert.rejects(
    run(
      f.controller.createWork(
        { ...goal, repository_id: Id.RepositoryId.make("unknown") },
        Id.SessionId.make("ses_supervisor"),
      ),
    ),
    /Register/,
  );
  await assert.rejects(
    run(f.controller.createWork({ ...goal, title: " " }, Id.SessionId.make("ses_supervisor"))),
    /title/,
  );
  await assert.rejects(
    run(f.controller.createWork({ ...goal, description: "" }, Id.SessionId.make("ses_supervisor"))),
    /goal|description/,
  );
  await assert.rejects(
    run(f.controller.createWork({ ...goal, priority: 5 }, Id.SessionId.make("ses_supervisor"))),
    /priority/i,
  );
  await assert.rejects(
    run(
      f.controller.createWork(
        { ...goal, dependencies: [Id.IssueId.make("missing")] },
        Id.SessionId.make("ses_supervisor"),
      ),
    ),
    /Missing/,
  );
  assert.equal((await run(f.work.list)).length, 0);
  const { id: prerequisiteId } = await run(
    f.work.create({ ...workGoal("prerequisite"), repository_id: Id.RepositoryId.make("frontend") }),
  );
  const created = await run(
    f.controller.createWork(
      { ...goal, priority: 0, dependencies: [prerequisiteId] },
      Id.SessionId.make("ses_supervisor"),
    ),
  );
  assert.equal(created.issue.priority, 0);
  assert.equal(created.readiness?.eligible, false);
  assert.match(created.readiness!.blockers.join(), /dependency/i);
  await assert.rejects(run(f.controller.start(created.issue.id)), /dependency/i);
  assert.equal(f.seed.countEvents("claimed"), 0);
});
test("missing project setup permits recording a goal and reports the start blocker", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const p = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
  await run(
    f.records.store.set(Id.StorageKey.make("project/api"), {
      ...p,
      openspec: false,
      verification: [],
    }),
  );
  const created = await run(f.controller.createWork(goal, Id.SessionId.make("ses_supervisor")));
  assert.equal(created.readiness?.eligible, false);
  assert.match(created.readiness!.blockers.join(), /OpenSpec/);
  assert.match(created.readiness!.blockers.join(), /Verification/);
});
test("a lost creation response recovers the authoritative issue across controller restarts", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const create = f.work.create.bind(f.work);
  let loseResponse = true;
  f.work.create = (input) =>
    domainEffect(
      Effect.gen(function* () {
        const issue = yield* create(input);
        if (loseResponse) {
          loseResponse = false;
          throw Error("Creation response lost");
        }
        return issue;
      }),
    );
  await assert.rejects(
    run(f.controller.createWork(goal, Id.SessionId.make("ses_supervisor"))),
    /response lost/,
  );
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
  const recovered = await run(restarted.createWork(goal, Id.SessionId.make("ses_supervisor")));
  assert.equal(recovered.issue.id, (await run(f.work.list))[0]!.id);
  assert.equal((await run(f.work.list)).length, 1);
  await assert.rejects(
    run(
      restarted.createWork(
        { ...goal, description: "A different goal" },
        Id.SessionId.make("ses_supervisor"),
      ),
    ),
    /different goal/,
  );
});
test("a failed creation can safely retry the same request", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const create = f.work.create.bind(f.work);
  f.work.create = () => Effect.fail(new CrewError("FIXTURE_FAILURE", "Creation failed"));
  await assert.rejects(
    run(f.controller.createWork(goal, Id.SessionId.make("ses_supervisor"))),
    /Creation failed/,
  );
  f.work.create = create;
  const created = await run(f.controller.createWork(goal, Id.SessionId.make("ses_supervisor")));
  assert.ok(created.issue.id);
  assert.equal((await run(f.work.list)).length, 1);
});
test("implicit request identity deduplicates retries while explicit new requests remain distinct", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const { request_id: _key, ...input } = goal;
  const first = await run(f.controller.createWork(input, Id.SessionId.make("ses_supervisor")));
  assert.equal(
    (await run(f.controller.createWork(input, Id.SessionId.make("ses_supervisor")))).issue.id,
    first.issue.id,
  );
  const next = await run(
    f.controller.createWork(
      { ...input, request_id: Id.RequestId.make("apm-refactor-2") },
      Id.SessionId.make("ses_supervisor"),
    ),
  );
  assert.notEqual(next.issue.id, first.issue.id);
  assert.equal((await run(f.work.list)).length, 2);
});

test("full-spec intake retains schema and an affirmative plan requirement without allowing policy weakening", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const sender = Id.SessionId.make("ses_schema-intake"),
    input = {
      ...goal,
      openspec_schema: Id.SpecSchemaName.make("spec-driven"),
      require_plan_approval: true as const,
    };
  const created = await run(f.controller.createWork(input, sender));
  assert.equal(created.issue.openspec_schema, "spec-driven");
  assert.equal(created.issue.require_plan_approval, true);
  assert.equal((await run(f.controller.createWork(input, sender))).issue.id, created.issue.id);
  for (const changed of [
    { ...input, openspec_schema: Id.SpecSchemaName.make("abra-compact-v1") },
    { ...input, require_plan_approval: undefined },
  ])
    await assert.rejects(run(f.controller.createWork(changed, sender)), /different|rebind/);
  for (const workflow_policy of ["research-only", "lightweight-fix"] as const)
    await assert.rejects(
      run(
        f.controller.createWork(
          {
            ...input,
            request_id: Id.RequestId.make(`incompatible-${workflow_policy}`),
            workflow_policy,
          },
          sender,
        ),
      ),
      /full-openspec/,
    );
  assert.equal((await run(f.work.list)).length, 1);
});

test("the controller fixture refuses a dependent claim and records a successful retry once", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const { issue: parent } = await run(
    f.controller.createWork(goal, Id.SessionId.make("ses_supervisor")),
  );
  const { issue: child } = await run(
    f.controller.createWork(
      { ...goal, request_id: Id.RequestId.make("child"), dependencies: [parent.id] },
      Id.SessionId.make("ses_supervisor"),
    ),
  );
  const owner = Id.ExecutionId.make("owner");
  await assert.rejects(run(f.work.claim(child.id, owner)), { code: "NOT_READY" });
  assert.equal((await run(f.work.show(child.id))).status, "open");
  assert.deepEqual(
    (await run(f.work.history(child.id))).map((e) => e.kind),
    ["created"],
  );
  await run(f.work.claim(parent.id, owner));
  await run(f.work.close(parent.id, owner));
  await run(f.work.claim(child.id, owner));
  await run(f.work.claim(child.id, owner));
  assert.deepEqual(
    (await run(f.work.history(child.id))).map((e) => e.kind),
    ["created", "claimed"],
  );
});
