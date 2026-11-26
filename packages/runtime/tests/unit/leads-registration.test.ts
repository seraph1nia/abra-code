import { createWorkflow } from "../../src/opencode/application.ts";
import assert from "node:assert/strict";
import { test, vi } from "vite-plus/test";
import { Effect, Schema } from "effect";
import { Agent } from "@opencode/schema/agent";
import * as Id from "@abracode/contracts/identities";
import { CrewError } from "../../src/domain.ts";
import { LeadStore } from "../../src/workflow/leads/store.ts";
import { LeadRecordSchema, readLeads } from "../../src/workflow/leads/contracts.ts";
import { fixture } from "../fixtures.ts";
import { run } from "../effects.ts";
import { Visibility } from "../../src/visibility/read-model.ts";
import { parent, leadID, issue, model, declaration, prepare } from "../helpers/registered-lead.ts";
test("lead authority indexes update across independent readers when a registration changes", async (t) => {
  const { f, lead } = await prepare();
  t.onTestFinished(() => run(f.close()));
  const reader = new LeadStore(f.records, f.work);
  const writer = new LeadStore(f.records, f.work);
  const entries = vi.spyOn(f.records.store, "entries");
  t.onTestFinished(() => entries.mockRestore());
  assert.equal((await run(reader.principal(lead.session_id)))?.enabled, true);
  assert.equal(await run(reader.principal(parent)), undefined);
  assert.equal(entries.mock.calls.filter(([prefix]) => prefix === "lead/").length, 1);
  await run(writer.save({ ...lead, enabled: false }));
  assert.equal((await run(reader.principal(lead.session_id)))?.enabled, false);
  assert.equal(entries.mock.calls.filter(([prefix]) => prefix === "lead/").length, 2);
});

test("lead observer isolates malformed registrations while authority remains deny-first", async (t) => {
  const { f, lead } = await prepare();
  t.onTestFinished(() => run(f.close()));
  const before = {
    prompts: f.runtime.prompts,
    creates: f.runtime.creates,
    forms: f.runtime.forms.size,
  };
  const view = new Visibility(f.controller);
  const initial = await run(view.snapshot());
  assert.equal(initial.leads![0]!.id, lead.id);
  assert.equal(initial.leads![0]!.session_available, true);
  assert.equal(initial.leads![0]!.enabled, true);
  assert.deepEqual(initial.leads![0]!.assigned_work, [issue]);
  await run(f.records.store.set(Id.StorageKey.make("lead/broken"), { malformed: true }));
  const isolated = await run(view.snapshot());
  assert.equal(isolated.leads!.length, 1);
  assert.equal(isolated.lead_diagnostics!.length, 1);
  await assert.rejects(run(readLeads(f.records)), { code: "INVALID_DATA" });
  assert.deepEqual(
    { prompts: f.runtime.prompts, creates: f.runtime.creates, forms: f.runtime.forms.size },
    before,
  );
});

test("lead inspection shows pending shutdown before disabled without changing authority", async (t) => {
  const { f, lead } = await prepare();
  t.onTestFinished(() => run(f.close()));
  const bundle = await run(f.controller.queries.observe());
  const effects = {
    prompts: f.runtime.prompts,
    creates: f.runtime.creates,
    forms: f.runtime.forms.size,
  };
  for (const [enabled, stop_pending, expected] of [
    [true, false, "idle"],
    [true, true, "stopping"],
    [false, true, "stopping"],
    [false, false, "disabled"],
  ] as const) {
    const retained = { ...lead, enabled, stop_pending };
    await run(f.records.store.set(Id.StorageKey.make(`lead/${lead.id}`), retained));
    const { leads } = await run(f.controller.queries.leadOverview(bundle));
    assert.equal(leads[0]!.state, expected);
    assert.equal(leads[0]!.enabled, enabled);
    assert.equal(leads[0]!.session_available, true);
    assert.deepEqual((await run(readLeads(f.records)))[0], retained);
  }
  assert.deepEqual(
    { prompts: f.runtime.prompts, creates: f.runtime.creates, forms: f.runtime.forms.size },
    effects,
  );
});

test("a lead request returns a project error when its registered repository disappears", async (t) => {
  const { f, lead } = await prepare();
  t.onTestFinished(() => run(f.close()));
  f.records.project = () => Effect.undefined;
  await assert.rejects(
    run(
      f.controller.lead().control(parent, {
        action: "message",
        id: leadID,
        revision: lead.revision,
        issue_id: issue,
        request_id: Id.RequestId.make("missing-project"),
        body: "Check the repository",
      }),
    ),
    { code: "PROJECT_MISSING" },
  );
});

test("lead registration persists session intent before creation and retries the same identity after response loss", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  f.runtime.sessions.set(parent, {
    id: parent,
    directory: f.config.home,
    busy: false,
    agent: Agent.ID.make("abra"),
  });
  await run(f.controller.recordSupervisor(parent));
  const original = f.runtime.managementSession.bind(f.runtime);
  let once = true;
  f.runtime.managementSession = (...args) =>
    original(...args).pipe(
      Effect.andThen(
        Effect.suspend(() => {
          if (once) {
            once = false;
            return Effect.fail(new CrewError("TRANSPORT", "response lost"));
          }
          return Effect.void;
        }),
      ),
    );
  await assert.rejects(run(f.controller.lead().control(parent, declaration)), /response lost/);
  const intent = (await run(readLeads(f.records)))[0]!;
  assert.equal(intent.provisioned, false);
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
  await run(restarted.lead().control(parent, declaration));
  const retained = (await run(readLeads(f.records)))[0]!;
  assert.equal(retained.session_id, intent.session_id);
  assert.equal(retained.provisioned, true);
  assert.equal(
    [...f.runtime.sessions.values()].filter((s) => s.agent === "project-lead").length,
    1,
  );
  assert.equal(retained.revision, 1);
  assert.throws(() =>
    Schema.decodeSync(LeadRecordSchema)({
      ...retained,
      retired_sessions: [retained.session_id],
    }),
  );
  await assert.rejects(run(restarted.lead().control(retained.session_id, declaration)), /Abra/);
  await assert.rejects(
    run(
      restarted.lead().control(parent, {
        ...declaration,
        expected_revision: 0,
        model: { ...model, id: Id.ModelId.make("different") },
      }),
    ),
    /revision/,
  );
});

test("a moved lead session is refused before native request admission", async (t) => {
  const { f, lead } = await prepare();
  t.onTestFinished(() => run(f.close()));
  f.runtime.sessions.get(lead.session_id)!.directory = Id.AbsolutePath.make("/foreign-location");
  const prompts = f.runtime.prompts;
  await assert.rejects(
    run(
      f.controller.lead().control(parent, {
        action: "message",
        id: leadID,
        revision: lead.revision,
        issue_id: issue,
        request_id: Id.RequestId.make("moved-lead-request"),
        body: "Inspect only the registered scope",
      }),
    ),
    { code: "LEAD_SESSION" },
  );
  assert.equal(f.runtime.prompts, prompts);
  const retained = (await run(readLeads(f.records)))[0]!.requests[0]!.request;
  assert.equal(retained.status, "pending");
});

test("disable confirms native stop before revision/model/scope changes, retired sessions never regain management authority", async (t) => {
  const { f, lead } = await prepare();
  t.onTestFinished(() => run(f.close()));
  await run(
    f.controller.lead().control(parent, {
      action: "message",
      id: leadID,
      revision: 1,
      issue_id: issue,
      request_id: Id.RequestId.make("open"),
      body: "Pending work",
    }),
  );
  await assert.rejects(
    run(
      f.controller.lead().control(parent, {
        ...declaration,
        expected_revision: 1,
        repositories: [Id.RepositoryId.make("other")],
      }),
    ),
    /Registered|Disable/,
  );
  const interrupt = f.runtime.interrupt.bind(f.runtime);
  let once = true;
  f.runtime.interrupt = (...args) =>
    once
      ? ((once = false), Effect.fail(new CrewError("TRANSPORT", "stop lost")))
      : interrupt(...args);
  const disable = { ...declaration, expected_revision: 1, enabled: false };
  await assert.rejects(run(f.controller.lead().control(parent, disable)), /stop lost/);
  assert.equal((await run(readLeads(f.records)))[0]!.stop_pending, true);
  await assert.rejects(
    run(f.controller.lead().action(lead.session_id, { action: "status", revision: 2 })),
    /principal/,
  );
  await run(f.controller.lead().control(parent, disable));
  const stopped = (await run(readLeads(f.records)))[0]!;
  assert.equal(stopped.active, false);
  assert.equal(stopped.stop_pending, false);
  assert.equal(stopped.requests[0]!.request.status, "superseded");
  const changed = {
    ...declaration,
    expected_revision: 2,
    model: { ...model, id: Id.ModelId.make("new-model") },
  };
  await run(f.controller.lead().control(parent, changed));
  const current = (await run(readLeads(f.records)))[0]!;
  assert.notEqual(current.session_id, lead.session_id);
  assert.ok(current.retired_sessions.includes(lead.session_id));
  assert.equal((await run(f.controller.lead().principal(lead.session_id)))!.id, leadID);
  await assert.rejects(
    run(f.controller.lead().action(lead.session_id, { action: "status", revision: 3 })),
    /principal/,
  );
});

test("a newly registered lead skips completed work predating its routing scope", async (t) => {
  const { f, lead } = await prepare();
  t.onTestFinished(() => run(f.close()));
  const e = await run(f.controller.start(issue, parent));
  await run(
    f.records.store.set(Id.StorageKey.make(`execution/${issue}`), {
      ...e,
      active_role: undefined,
      current_phase: "completed",
      updated_at: "2020-01-01T00:00:00.000Z",
    }),
  );
  const prompts = f.runtime.prompts;
  await run(f.controller.lead().scan());
  assert.equal(f.runtime.prompts, prompts);
  assert.equal((await run(readLeads(f.records))).find((r) => r.id === lead.id)?.requests.length, 0);
});
