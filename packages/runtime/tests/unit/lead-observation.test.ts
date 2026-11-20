import assert from "node:assert/strict";
import { test, vi } from "vite-plus/test";
import { Schema } from "effect";
import { Agent } from "@opencode/schema/agent";
import * as Id from "../../src/identities.ts";
import { fixture } from "../fixtures.ts";
import { run } from "../effects.ts";
import { LeadRecordSchema, leadKey, readLeads } from "../../src/workflow/lead-contracts.ts";
import { LeadEvidencePageSchema } from "../../src/visibility/lead-observation.ts";
import { visibility } from "../../src/visibility/protocol.ts";
import { WorkSnapshotSchema as BrowserWorkSnapshot } from "../../src/web/wire.ts";
import { Visibility } from "../../src/visibility/read-model.ts";

const parent = Id.SessionId.make("ses_lead-observer");
const issue = Id.IssueId.make("lead-observed-task");
const repo = Id.RepositoryId.make("api");
const id = Id.LeadId.make("observed-lead");
const model = { providerID: Id.ProviderId.make("fixture"), id: Id.ModelId.make("fixture") };
async function setup() {
  const f = await run(fixture);
  const management = f.controller.lead();
  f.runtime.sessions.set(parent, {
    id: parent,
    directory: f.config.home,
    busy: false,
    agent: Agent.ID.make("abra"),
  });
  await run(f.controller.recordSupervisor(parent));
  f.seed.named(issue, repo);
  await run(
    management.control(parent, {
      action: "register",
      id,
      expected_revision: 0,
      repositories: [repo],
      model,
      enabled: true,
    }),
  );
  return f;
}

test("ticket lead reads hydrate only the selected issue as other repositories grow", async (t) => {
  const f = await setup();
  t.onTestFinished(() => run(f.close()));
  const peer = Id.IssueId.make("another-lead-task");
  f.seed.named(peer, repo);
  const queries = f.controller.queries;
  const fleet = vi.spyOn(queries, "observe");
  const summaries = vi.spyOn(f.work, "repositoryIssueSummaries");
  const hydrate = f.work["hydrate"].bind(f.work);
  const hydrated: string[] = [];
  f.work["hydrate"] = (rows, links) => {
    hydrated.push(...rows.map((row) => String(row.id)));
    return hydrate(rows, links);
  };
  for (const unrelated of [0, 1000]) {
    for (let n = 0; n < unrelated; n++)
      f.seed.named(Id.IssueId.make(`elsewhere-${n}`), Id.RepositoryId.make("frontend"));
    hydrated.length = 0;
    summaries.mockClear();
    const list = await run(queries.leadEvidence({ issue_id: issue }));
    assert.deepEqual(
      list.entries.map((lead) => lead.id),
      [id],
    );
    assert.deepEqual(hydrated, [issue]);
    assert.equal(summaries.mock.calls.length, 0);

    const page = await run(queries.leadEvidence({ issue_id: issue, lead_id: id }));
    assert.deepEqual(
      page.detail?.related_work.map((task) => task.issue_id),
      [peer, issue],
    );
    assert.equal(page.detail?.related_total, 2);
    assert.deepEqual(summaries.mock.calls, [[repo]]);
    assert.deepEqual(hydrated, [issue, issue]);
    assert.equal(fleet.mock.calls.length, 0);
  }
});

test("scoped lead observation retains paged requests, proposals and accepted work after disable/scope change without mutation", async (t) => {
  const f = await setup();
  const management = f.controller.lead();
  t.onTestFinished(() => run(f.close()));
  const initial = (await run(readLeads(f.records)))[0]!;
  await assert.rejects(
    run(
      management.control(parent, {
        action: "register",
        id,
        expected_revision: 1,
        repositories: [Id.RepositoryId.make("frontend")],
        model,
        enabled: false,
      }),
    ),
    /Disable and confirm stop/,
  );
  const interrupted: Id.SessionId[] = [];
  const interrupt = f.runtime.interrupt.bind(f.runtime);
  f.runtime.interrupt = (session, ...arguments_) => {
    interrupted.push(session);
    return interrupt(session, ...arguments_);
  };
  for (let index = 0; index < 6; index++)
    await run(
      management.action(initial.session_id, {
        action: "propose",
        revision: 1,
        batch: {
          request_id: Id.RequestId.make(`proposal-${index}`),
          tasks: [
            {
              client_key: "one",
              repository_id: repo,
              title: `Captured proposal ${index}`,
              description: "Retained evidence to inspect",
              workflow_policy: "research-only",
              scope: { goal: "Inspect", acceptance: ["Evidence"], constraints: [] },
              dependencies: [{ type: "existing", issue_id: issue }],
            },
          ],
        },
      }),
    );
  await run(
    management.control(parent, {
      action: "accept",
      id,
      revision: 1,
      request_id: Id.RequestId.make("proposal-0"),
    }),
  );
  await run(
    management.control(parent, {
      action: "register",
      id,
      expected_revision: 1,
      repositories: [repo],
      model,
      enabled: false,
    }),
  );
  await run(
    management.control(parent, {
      action: "register",
      id,
      expected_revision: 2,
      repositories: [Id.RepositoryId.make("frontend")],
      model,
      enabled: false,
    }),
  );
  const stopped = (await run(readLeads(f.records)))[0]!;
  assert.deepEqual(interrupted, [initial.session_id]);
  assert.equal(stopped.stop_pending, false);
  assert.equal(stopped.provisioned, false);
  assert.notEqual(stopped.session_id, initial.session_id);
  const at = "2026-11-16T01:00:00Z";
  const retained = Schema.decodeUnknownSync(LeadRecordSchema)({
    ...stopped,
    requests: Array.from({ length: 21 }, (_, index) => ({
      issue_id: issue,
      request: {
        schema_version: 1,
        request_id: `historical-${index}`,
        prompt_id: `msg_historical_${index}`,
        generation: 1,
        sender_session_id: parent,
        recipient_session_id: initial.session_id,
        prompt: "PRIVATE_NATIVE_PROMPT",
        body: `Retained historical request ${index}`,
        delivery: "queue",
        status: "answered",
        response: "answer",
        created_at: at,
        acknowledged_at: at,
        reply: { body: `Retained answer ${index}`, evidence: [], at },
      },
    })),
  });
  await run(f.records.store.set(leadKey(id), retained));
  const counters = {
    prompts: f.runtime.prompts,
    creates: f.runtime.creates,
    issues: (await run(f.work.list)).length,
    forms: f.runtime.forms.size,
  };
  const page = await run(f.controller.queries.leadEvidence({ issue_id: issue, lead_id: id }));
  assert.equal(page.entries[0]?.state, "disabled");
  assert.equal(page.entries[0]?.scope, "retained_history");
  assert.equal(page.entries[0]?.session_available, false);
  assert.equal(page.entries[0]?.request_count, 21);
  assert.equal(page.entries[0]?.outstanding_count, 0);
  assert.equal(page.entries[0]?.pending_proposal_count, 5);
  assert.equal(page.detail?.requests.length, 10);
  assert.equal(page.detail?.request_next, 10);
  assert.equal(page.detail?.proposals.length, 5);
  assert.equal(page.detail?.proposal_next, 5);
  assert.equal(page.detail?.requests[0].recipient_session_id, initial.session_id);
  assert.ok(page.detail?.proposals[0].tasks[0].accepted_issue_id);
  assert.ok(!JSON.stringify(page).includes("PRIVATE_NATIVE_PROMPT"));
  const next = await run(
    f.controller.queries.leadEvidence({
      issue_id: issue,
      lead_id: id,
      request_offset: 20,
      proposal_offset: 5,
    }),
  );
  assert.equal(next.detail?.requests.length, 1);
  assert.equal(next.detail?.requests[0].reply?.body, "Retained answer 20");
  assert.equal(next.detail?.proposals[0].tasks[0].title, "Captured proposal 5");
  assert.equal(next.detail?.request_next, undefined);
  assert.equal(next.detail?.proposal_next, undefined);
  assert.ok(Schema.is(LeadEvidencePageSchema)(page));
  assert.ok("value" in (await visibility.methods.leads.output["~standard"].validate(page)));
  assert.deepEqual((await run(readLeads(f.records)))[0], retained);
  assert.deepEqual(
    {
      prompts: f.runtime.prompts,
      creates: f.runtime.creates,
      issues: (await run(f.work.list)).length,
      forms: f.runtime.forms.size,
    },
    counters,
  );
  const unrelated = Id.IssueId.make("unrelated-project-task");
  f.seed.named(unrelated, Id.RepositoryId.make("worker"));
  await assert.rejects(
    run(f.controller.queries.leadEvidence({ issue_id: unrelated, lead_id: id })),
    /no configured or retained relationship/,
  );
});

test("lead index covers retained pages and isolates malformed rows without treating unknown sessions as idle", async (t) => {
  const f = await setup();
  t.onTestFinished(() => run(f.close()));
  const initial = (await run(readLeads(f.records)))[0]!;
  for (let index = 0; index < 21; index++) {
    const record = Schema.decodeSync(LeadRecordSchema)({
      ...initial,
      id: `extra-${String(index).padStart(2, "0")}`,
      session_id: `ses_extra_${index}`,
      retired_sessions: [],
      requests: [],
      proposals: [],
    });
    await run(f.records.store.set(leadKey(record.id), record));
  }
  await run(f.records.store.set(Id.StorageKey.make("lead/malformed"), { malformed: true }));
  const first = await run(f.controller.queries.leadEvidence({ issue_id: issue }));
  assert.equal(first.total, 22);
  assert.equal(first.entries.length, 20);
  assert.equal(first.next_offset, 20);
  assert.equal(first.diagnostics.length, 1);
  assert.equal(first.entries[0].state, "unavailable");
  assert.equal(first.entries[0].session_available, false);
  const next = await run(
    f.controller.queries.leadEvidence({ issue_id: issue, offset: first.next_offset }),
  );
  assert.equal(next.entries.length, 2);
  assert.equal(next.total, 22);
  assert.equal(next.next_offset, undefined);
  assert.ok(
    !next.entries.some((entry) => first.entries.some((previous) => previous.id === entry.id)),
  );
});

test("proposal attention remains discoverable and readable in a registered repository with no tasks", async (t) => {
  const f = await setup();
  const management = f.controller.lead();
  t.onTestFinished(() => run(f.close()));
  const repository = Id.RepositoryId.make("worker"),
    lead = Id.LeadId.make("empty-repository-lead");
  await run(
    management.control(parent, {
      action: "register",
      id: lead,
      expected_revision: 0,
      repositories: [repository],
      model,
      enabled: true,
    }),
  );
  const registration = (await run(readLeads(f.records))).find((record) => record.id === lead)!;
  await run(
    management.action(registration.session_id, {
      action: "propose",
      revision: 1,
      batch: {
        request_id: Id.RequestId.make("empty-repository-proposal"),
        tasks: [
          {
            client_key: "new",
            repository_id: repository,
            title: "Proposed new work",
            description: "No work admitted yet",
            workflow_policy: "research-only",
            scope: { goal: "Inspect", acceptance: ["Evidence"], constraints: [] },
          },
        ],
      },
    }),
  );
  const before = f.runtime.prompts;
  const index = await run(
    f.controller.queries.leadEvidence({ repository_id: repository, lead_id: lead }),
  );
  assert.equal(index.issue_id, undefined);
  assert.equal(index.repository_id, repository);
  assert.equal(index.detail?.proposals[0].accepted, false);
  assert.equal(index.detail?.related_total, 0);
  assert.equal(
    (await run(f.work.list)).some((task) => task.repository_id === repository),
    false,
  );
  const native = await run(new Visibility(f.controller).snapshot());
  const browser = Schema.decodeSync(BrowserWorkSnapshot)(native);
  const attention = browser.management?.entries.find((entry) => entry.lead_id === lead);
  assert.equal(attention?.repository_id, repository);
  assert.equal(attention?.proposals, 1);
  assert.equal(attention?.unanswered, 0);
  assert.equal(f.runtime.prompts, before);
  await assert.rejects(run(f.controller.queries.leadEvidence({})), /Select exactly one/);
  await assert.rejects(
    run(f.controller.queries.leadEvidence({ issue_id: issue, repository_id: repository })),
    /Select exactly one/,
  );
});
