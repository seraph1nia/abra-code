import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { Schema } from "effect";
import { resolveConfig } from "../../src/config/load.ts";
import {
  DispatchProfilesSchema,
  normalizeDispatch,
  resolveDispatch,
  validateDispatch,
} from "../../src/config/dispatch.ts";
import { WorkerModelSchema } from "../../src/contracts.ts";
import { captureConfiguration } from "../../src/config/snapshot.ts";
import { normalizeIssue } from "../../src/work/model.ts";
import { fixture } from "../fixtures.ts";
import { run } from "../effects.ts";
import * as Id from "../../src/identities.ts";
const model = (id: string, variant?: string) =>
  Schema.decodeSync(WorkerModelSchema)({
    providerID: "fixture",
    id,
    ...(variant ? { variant } : {}),
  });
const yaml = `version: 1
models:
  default: {providerID: fixture, id: default, variant: base}
  overrides:
    apply: {providerID: fixture, id: role, variant: role-variant}
profiles:
  careful: {role: apply, model: {providerID: fixture, id: profile, variant: high}}
  quick: {role: research, model: {providerID: fixture, id: quick}}
`;
const config = () => run(resolveConfig("/installation", "/installation/abracode.yaml", yaml));

test("dispatch rejects empty/incomplete/ambiguous selectors, unknown roles and permission-bearing profiles", async () => {
  for (const bad of [
    {},
    { apply: {} },
    { apply: { model: { id: "missing-provider" } } },
    { apply: { model: model("x"), profile: "careful" } },
    { supervisor: { model: model("x") } },
    { apply: { model: model("x"), tools: ["shell"] } },
  ])
    assert.throws(() => normalizeDispatch(bad), { code: "DISPATCH" });
  assert.throws(() =>
    Schema.decodeUnknownSync(DispatchProfilesSchema, { onExcessProperty: "error" })({
      bad: { role: "apply", model: model("x"), tools: ["shell"] },
    }),
  );
  assert.throws(() =>
    Schema.decodeUnknownSync(DispatchProfilesSchema)(
      Object.fromEntries(
        Array.from({ length: 33 }, (_, i) => [`p${i}`, { role: "apply", model: model("x") }]),
      ),
    ),
  );
  const c = await config();
  assert.throws(() => validateDispatch(c, normalizeDispatch({ apply: { profile: "unknown" } })), {
    code: "DISPATCH_PROFILE",
  });
  assert.throws(() => validateDispatch(c, normalizeDispatch({ apply: { profile: "quick" } })), {
    code: "DISPATCH_ROLE",
  });
  for (const selection of ["unknown", "quick"])
    await assert.rejects(
      run(
        resolveConfig(
          "/installation",
          "/installation/abracode.yaml",
          yaml +
            `repositories:\n  - id: api\n    path: /repository\n    dispatch: {apply: {profile: ${selection}}}\n`,
        ),
      ),
      /Dispatch profile/,
    );
});

test("complete task/model/profile precedence preserves variants only from the chosen selection", async () => {
  const c = await config();
  for (const row of [
    {
      role: "research" as const,
      repository: undefined,
      task: undefined,
      id: "default",
      variant: "base",
      source: "default",
    },
    {
      role: "apply" as const,
      repository: undefined,
      task: undefined,
      id: "role",
      variant: "role-variant",
      source: "role_override",
    },
    {
      role: "apply" as const,
      repository: { apply: { model: model("repository") } },
      task: undefined,
      id: "repository",
      variant: undefined,
      source: "repository.model",
    },
    {
      role: "apply" as const,
      repository: normalizeDispatch({ apply: { profile: "careful" } }),
      task: undefined,
      id: "profile",
      variant: "high",
      source: "repository.profile",
    },
    {
      role: "apply" as const,
      repository: { apply: { model: model("repository") } },
      task: normalizeDispatch({ apply: { profile: "careful" } }),
      id: "profile",
      variant: "high",
      source: "task.profile",
    },
    {
      role: "apply" as const,
      repository: normalizeDispatch({ apply: { profile: "careful" } }),
      task: { apply: { model: model("task") } },
      id: "task",
      variant: undefined,
      source: "task.model",
    },
  ]) {
    const selected = resolveDispatch(c, row.role, row.repository, row.task);
    assert.equal(selected.model.id, row.id);
    assert.equal(selected.model.variant, row.variant);
    assert.equal(selected.provenance.source, row.source);
  }
  const snapshot = captureConfiguration(c, normalizeDispatch({ apply: { profile: "careful" } }));
  assert.equal(snapshot.workers.apply.model.id, "profile");
  assert.equal(snapshot.dispatch_sources.apply.profile, "careful");
  c.profiles = Schema.decodeSync(DispatchProfilesSchema)({
    careful: { role: "apply", model: model("changed") },
  });
  assert.equal(snapshot.workers.apply.model.id, "profile");
});

test("normalized dispatch order is part of stable task request identity", () => {
  const first = normalizeIssue({
    repository_id: "api",
    title: "Task",
    description: "Goal",
    workflow_policy: "full-openspec",
    priority: 2,
    dependencies: [],
    request_id: "dispatch-request",
    dispatch: {
      apply: { model: { providerID: "fixture", id: "task", variant: "high" } },
      research: { profile: "quick" },
    },
  });
  const second = normalizeIssue({
    ...first,
    dispatch: {
      research: { profile: "quick" },
      apply: { model: { variant: "high", id: "task", providerID: "fixture" } },
    },
  });
  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

test("invalid task profiles leave no issue; captured selections survive config edits and explicit pause/resume", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  f.config.profiles = Schema.decodeSync(DispatchProfilesSchema)({
    investigator: { role: "explore", model: model("captured") },
  });
  const input = {
    repository_id: Id.RepositoryId.make("api"),
    title: "Captured task",
    description: "Inspect source",
    request_id: Id.RequestId.make("captured-task"),
    dispatch: normalizeDispatch({ explore: { profile: "investigator" } }),
  };
  await assert.rejects(
    run(
      f.controller.createWork(
        { ...input, dispatch: normalizeDispatch({ apply: { profile: "investigator" } }) },
        Id.SessionId.make("ses_supervisor"),
      ),
    ),
    { code: "DISPATCH_ROLE" },
  );
  assert.equal(f.work.issues.size, 0);
  const issue = (await run(f.controller.createWork(input, Id.SessionId.make("ses_supervisor"))))
    .issue;
  const e = await run(f.controller.start(issue.id));
  assert.equal(e.configuration_snapshot!.workers.explore!.model!.id, "captured");
  assert.equal(e.configuration_snapshot!.dispatch_sources!.explore.source, "task.profile");
  assert.equal(f.runtime.sessions.get(e.explore_session_id!)!.model!.id, "captured");
  f.config.profiles = Schema.decodeSync(DispatchProfilesSchema)({
    investigator: { role: "explore", model: model("changed") },
  });
  await run(f.controller.control(issue.id, "pause"));
  const resumed = await run(f.controller.control(issue.id, "resume"));
  assert.equal(resumed.explore_session_id, e.explore_session_id);
  assert.equal(f.runtime.sessions.get(resumed.explore_session_id!)!.model!.id, "captured");
  assert.equal(
    (await run(f.controller.createWork(input, Id.SessionId.make("ses_supervisor")))).issue.id,
    issue.id,
  );
  const changed = structuredClone(resumed);
  changed.configuration_snapshot = {
    ...resumed.configuration_snapshot!,
    workers: {
      ...resumed.configuration_snapshot!.workers,
      explore: {
        ...resumed.configuration_snapshot!.workers.explore,
        model: model("unauthorized-change"),
      },
    },
  };
  await assert.rejects(run(f.records.save(changed)), { code: "CONFIG_SNAPSHOT" });
});

test("an explicit empty repository dispatch clears defaults while task selectors stay nonempty", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const project = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
  const set = await run(
    f.onboarding.register(
      { id: project.id, path: project.path, dispatch: { apply: { model: model("repository") } } },
      false,
    ),
  );
  assert.equal(set.project.dispatch?.apply?.model?.id, "repository");
  const cleared = await run(
    f.onboarding.register({ id: project.id, path: project.path, dispatch: {} }, false),
  );
  assert.deepEqual(cleared.project.dispatch, {});
  assert.throws(() => normalizeDispatch({}));
});

test("later Apply admission uses the choice captured before Explore and human approval", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  f.config.profiles = Schema.decodeSync(DispatchProfilesSchema)({
    implementer: { role: "apply", model: model("captured-apply") },
  });
  const supervisor = Id.SessionId.make("ses_supervisor");
  const issue = (
    await run(
      f.controller.createWork(
        {
          repository_id: Id.RepositoryId.make("api"),
          title: "Frozen future phase",
          description: "Implement the accepted goal",
          request_id: Id.RequestId.make("frozen-apply"),
          dispatch: normalizeDispatch({ apply: { profile: "implementer" } }),
        },
        supervisor,
      ),
    )
  ).issue;
  const explore = await run(f.controller.start(issue.id, supervisor));
  f.spec.planned = true;
  f.runtime.success(explore.explore_session_id!);
  const planned = await run(f.controller.advance(issue.id));
  assert.equal(planned.current_phase, "awaiting_plan_approval");
  f.config.profiles = Schema.decodeSync(DispatchProfilesSchema)({
    implementer: { role: "apply", model: model("changed-after-explore") },
  });
  const form = await run(f.controller.approve(issue.id, "plan", supervisor));
  assert.ok("form_id" in form);
  f.runtime.forms.set(form.form_id, "approved");
  const applied = await run(f.controller.approve(issue.id, "plan", supervisor));
  assert.ok("current_phase" in applied);
  assert.equal(applied.current_phase, "applying");
  assert.equal(f.runtime.sessions.get(applied.apply_session_id!)!.model!.id, "captured-apply");
  assert.equal(applied.configuration_snapshot!.dispatch_sources!.apply.source, "task.profile");
});
