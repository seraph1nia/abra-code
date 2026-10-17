import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { Deferred, Effect, Fiber } from "effect";
import { fixture, applying } from "../fixtures.ts";
import { run } from "../effects.ts";
import { Controller } from "../../src/workflow/controller.ts";
import { RepositoryId, SessionId } from "../../src/identities.ts";

test("research restarts from the saved phase before any worker admission intent exists", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const project = (await run(f.records.project(RepositoryId.make("api"))))!;
  project.plan_approval = false;
  project.verification = [];
  await run(f.records.saveProject(project));
  const { issue } = await run(
    f.controller.createWork(
      {
        repository_id: project.id,
        workflow_policy: "research-only",
        title: "Research recovery",
        description: "Inspect persistence ownership",
        scope: { goal: "Inspect persistence", acceptance: ["Identify ownership"], constraints: [] },
      },
      SessionId.make("ses_supervisor"),
    ),
  );
  const entered = Deferred.makeUnsafe<void>();
  const preflight = f.runtime.preflight.bind(f.runtime);
  f.runtime.preflight = () =>
    Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never));
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const starting = yield* f.controller.start(issue.id).pipe(Effect.forkScoped);
        yield* Deferred.await(entered);
        yield* Fiber.interrupt(starting);
      }),
    ),
  );
  f.runtime.preflight = preflight;
  const before = await run(f.controller.get(issue.id));
  assert.equal(before.current_phase, "researching");
  assert.equal(before.active_role, undefined);
  assert.equal(before.session_intent, undefined);
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
  const [after] = await run(restarted.reconcile(issue.id));
  assert.equal(after.current_phase, "researching");
  assert.equal(after.active_role, "research");
  assert.ok(after.research_session_id);
  assert.equal(f.runtime.creates, 1);
  assert.equal(f.runtime.prompts, 1);
});

test("stale operation saves preserve observation removal as well as newer values", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(applying(f));
  await run(f.controller.workerProgress(e.apply_session_id!, 0, "Previous turn activity"));
  const stale = await run(f.controller.get(e.issue_id));
  const current = await run(f.controller.get(e.issue_id));
  delete current.progress;
  await run(f.records.save(current));
  await run(f.records.save(stale));
  assert.equal(stale.progress, undefined);
  await run(f.records.save(stale));
  assert.equal((await run(f.controller.get(e.issue_id))).progress, undefined);
});
