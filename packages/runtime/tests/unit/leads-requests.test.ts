import assert from "node:assert/strict";
import { test, type TestContext } from "vite-plus/test";
import { Effect } from "effect";
import * as Id from "@abracode/contracts/identities";
import { CrewError } from "../../src/domain.ts";
import { readLeads, leadAccounting } from "../../src/workflow/leads/contracts.ts";
import { type Runtime } from "../../src/opencode/runtime.ts";
import { run } from "../effects.ts";
import { parent, leadID, repo, issue, declaration, prepare } from "../helpers/registered-lead.ts";
async function recoverableLead(t: TestContext, budget = 2) {
  const { f, lead } = await prepare();
  t.onTestFinished(() => run(f.close()));
  const project = (await run(f.records.project(repo)))!;
  await run(f.records.saveProject({ ...project, diagnostic_turns: budget }));
  const request = Id.RequestId.make("lead-required-response");
  await run(
    f.controller.lead().control(parent, {
      action: "message",
      id: leadID,
      revision: lead.revision,
      issue_id: issue,
      request_id: request,
      body: "Inspect the scoped evidence and reply",
    }),
  );
  const session: Runtime["session"] = f.runtime.session.bind(f.runtime);
  const completions = new Map<Id.MessageId, { id: Id.MessageId; at: number }>();
  f.runtime.session = (id: Id.SessionId, bound?: Id.MessageId) =>
    session(id).pipe(
      Effect.map((state) => {
        if (!bound || !state.outcome || !f.runtime.admissions.has(bound)) return state;
        if (!completions.has(bound))
          completions.set(bound, { id: Id.MessageId.make(`msg_idle_${bound}`), at: Date.now() });
        return {
          ...state,
          assignment: { id: bound, outcome: state.outcome, completion: completions.get(bound) },
        };
      }),
    );
  const idle = () =>
    Object.assign(f.runtime.sessions.get(lead.session_id)!, {
      busy: false,
      executing: false,
      outcome: "succeeded",
    });
  idle();
  const read = async () =>
    (await run(readLeads(f.records)))[0]!.requests.find((r) => r.request.request_id === request)!
      .request;
  return { f, lead, request, read, idle };
}

test("lead missing replies consume one management diagnostic attempt and retain one escalation without creating an execution", async (t) => {
  const { f, lead, read, idle } = await recoverableLead(t);
  assert.equal(await run(f.records.execution(issue)), undefined);
  const prompts = f.runtime.prompts;
  await run(f.controller.lead().scan());
  const recovery = (await read()).response_recovery!;
  assert.equal(recovery.status, "admitted");
  assert.match(recovery.prompt, /ORIGINAL request_id lead-required-response/);
  assert.equal((await read()).response_escalation, undefined);
  assert.equal(f.runtime.prompts, prompts + 1);
  assert.equal((await run(leadAccounting(f.records))).turns(issue), 2);
  assert.equal(
    await run(
      f.controller.lead().prompt(lead.session_id, recovery.prompt_id, recovery.prompt, "queue"),
    ),
    true,
  );
  await assert.rejects(
    run(f.controller.lead().prompt(lead.session_id, recovery.prompt_id, "Changed", "queue")),
    { code: "LEAD_PROMPT" },
  );
  await assert.rejects(
    run(f.controller.lead().prompt(lead.session_id, recovery.prompt_id, recovery.prompt, "steer")),
    { code: "LEAD_PROMPT" },
  );
  idle();
  for (let tick = 0; tick < 3; tick++) await run(f.controller.lead().scan());
  const incident = (await read()).response_escalation!;
  assert.match(incident.body, /automatic attempt exhausted/);
  assert.equal(incident.notified, true);
  assert.equal((await read()).response_recovery?.prompt_id, recovery.prompt_id);
  assert.equal(f.runtime.prompts, prompts + 1);
  assert.equal(await run(f.records.execution(issue)), undefined);
});

test("lead recovery replies resolve the original identity and accepted evidence survives disable", async (t) => {
  const { f, lead, request, read, idle } = await recoverableLead(t);
  await run(f.controller.lead().scan());
  const prompts = f.runtime.prompts;
  await run(
    f.controller.lead().action(lead.session_id, {
      action: "reply",
      revision: lead.revision,
      request_id: request,
      body: "Scoped evidence retained",
    }),
  );
  idle();
  await run(f.controller.lead().scan());
  assert.equal((await read()).status, "answered");
  assert.equal((await read()).response_escalation, undefined);
  assert.equal(f.runtime.prompts, prompts);
  const owned: Id.MessageId[] = [];
  const interrupt = f.runtime.interrupt.bind(f.runtime);
  f.runtime.interrupt = (session, prompt, additional) => {
    owned.push(...(prompt ? [prompt] : []), ...(additional ?? []));
    return interrupt(session, prompt, additional);
  };
  await run(
    f.controller
      .lead()
      .control(parent, { ...declaration, expected_revision: lead.revision, enabled: false }),
  );
  assert.ok(owned.includes((await read()).response_recovery!.prompt_id));
  assert.equal((await read()).reply?.body, "Scoped evidence retained");
  await run(f.controller.lead().scan());
  assert.equal(f.runtime.prompts, prompts);
});

test("manual posture, exhausted lead budgets, queued requests and busy sessions cannot produce reminders", async (t) => {
  for (const condition of ["manual", "budget", "queued", "busy"] as const) {
    const { f, read, lead } = await recoverableLead(t, condition === "budget" ? 1 : 2);
    if (condition === "manual") f.config.supervision_mode = "manual";
    if (condition === "queued") f.runtime.promptAdmission = () => Effect.succeed("queued" as const);
    if (condition === "busy")
      Object.assign(f.runtime.sessions.get(lead.session_id)!, { busy: true, executing: true });
    const prompts = f.runtime.prompts;
    for (let tick = 0; tick < 3; tick++) await run(f.controller.lead().scan());
    assert.equal((await read()).response_recovery, undefined);
    assert.equal(f.runtime.prompts, prompts);
    assert.equal((await run(leadAccounting(f.records))).turns(issue), 1);
    if (condition === "manual" || condition === "budget")
      assert.ok((await read()).response_escalation?.notice_id);
  }
});

test("lead escalation notification loss retries one retained synthetic notice and cannot wake a model", async (t) => {
  const { f, read, idle } = await recoverableLead(t);
  await run(f.controller.lead().scan());
  idle();
  const notices = new Map<Id.MessageId, string>();
  let calls = 0;
  f.runtime.notify = (_session, text, id) =>
    Effect.sync(() => {
      assert.ok(id);
      if (notices.has(id)) assert.equal(notices.get(id), text);
      notices.set(id, text);
      calls++;
    });
  const set = f.records.store.set.bind(f.records.store);
  let lose = true;
  f.records.store.set = (key, value) =>
    key === `lead/${leadID}` && lose && JSON.stringify(value).includes('"notified":true')
      ? ((lose = false), Effect.fail(new CrewError("STORAGE", "Lost escalation receipt")))
      : set(key, value);
  const prompts = f.runtime.prompts;
  await run(f.controller.lead().scan());
  assert.equal((await read()).response_escalation?.notified, undefined);
  await run(f.controller.lead().scan());
  await run(f.controller.lead().scan());
  assert.equal((await read()).response_escalation?.notified, true);
  assert.equal(notices.size, 1);
  assert.equal(calls, 2);
  assert.equal(f.runtime.prompts, prompts);
});

test("shared native request recovery preserves correlation, budget, duplicate reply and unresolved interrupted work", async (t) => {
  const { f, lead } = await prepare();
  t.onTestFinished(() => run(f.close()));
  const request = {
    action: "message" as const,
    id: leadID,
    revision: 1,
    issue_id: issue,
    request_id: Id.RequestId.make("lead-question"),
    body: "Investigate scoped state",
  };
  const prompt = f.runtime.prompt.bind(f.runtime);
  let once = true;
  f.runtime.prompt = (...args) =>
    prompt(...args).pipe(
      Effect.andThen(
        Effect.suspend(() => {
          if (once) {
            once = false;
            return Effect.fail(new CrewError("TRANSPORT", "lost admission"));
          }
          return Effect.void;
        }),
      ),
    );
  await assert.rejects(run(f.controller.lead().control(parent, request)), /lost admission/);
  const pending = (await run(readLeads(f.records)))[0]!.requests[0]!.request;
  assert.equal(pending.status, "admission_uncertain");
  assert.equal(f.runtime.prompts, 1);
  await run(f.controller.lead().control(parent, request));
  assert.equal(f.runtime.prompts, 1);
  await assert.rejects(
    run(f.controller.lead().control(parent, { ...request, body: "Changed" })),
    /rebound/,
  );
  await assert.rejects(
    run(
      f.controller.lead().action(parent, {
        action: "reply",
        revision: 1,
        request_id: request.request_id,
        body: "forged",
      }),
    ),
    /principal/,
  );
  const reply = {
    action: "reply" as const,
    revision: 1,
    request_id: request.request_id,
    body: "Evidence retained",
  };
  const first = await run(f.controller.lead().action(lead.session_id, reply));
  assert.deepEqual(await run(f.controller.lead().action(lead.session_id, reply)), first);
  await assert.rejects(
    run(f.controller.lead().action(lead.session_id, { ...reply, body: "rebound" })),
    /another answer/,
  );
  const session = f.runtime.sessions.get(lead.session_id)!;
  session.busy = false;
  session.executing = false;
  session.outcome = "interrupted";
  await run(f.controller.lead().scan());
  await assert.rejects(
    run(
      f.controller
        .lead()
        .control(parent, { ...request, request_id: Id.RequestId.make("beyond-budget") }),
    ),
    /budget/,
  );
  assert.equal(
    (await run(readLeads(f.records)))[0]!.requests[0]!.request.prompt_id,
    pending.prompt_id,
  );
});

test("uncertain absent lead admission holds shared attention capacity and is never blindly replayed", async (t) => {
  const { f, lead } = await prepare();
  t.onTestFinished(() => run(f.close()));
  const request = {
    action: "message" as const,
    id: leadID,
    revision: 1,
    issue_id: issue,
    request_id: Id.RequestId.make("uncertain-absent"),
    body: "Inspect retained source",
  };
  let attempts = 0;
  f.runtime.prompt = () => {
    attempts++;
    return Effect.fail(new CrewError("TRANSPORT", "unknown admission"));
  };
  await assert.rejects(run(f.controller.lead().control(parent, request)), /unknown admission/);
  await run(f.controller.lead().control(parent, request));
  assert.equal(attempts, 1);
  const otherID = Id.LeadId.make("second-lead");
  await run(f.controller.lead().control(parent, { ...declaration, id: otherID }));
  const otherIssue = Id.IssueId.make("second-source");
  f.seed.named(otherIssue, repo);
  await assert.rejects(
    run(
      f.controller.lead().control(parent, {
        ...request,
        id: otherID,
        issue_id: otherIssue,
        request_id: Id.RequestId.make("second-request"),
      }),
    ),
    /capacity/,
  );
  const current = (await run(readLeads(f.records))).find((r) => r.id === lead.id)!;
  assert.equal(current.active, true);
  assert.equal(current.requests[0]!.request.status, "admission_uncertain");
  await run(
    f.controller.lead().control(parent, { ...declaration, expected_revision: 1, enabled: false }),
  );
  const stopped = (await run(readLeads(f.records))).find((r) => r.id === lead.id)!;
  assert.equal(stopped.active, false);
  assert.equal(stopped.requests[0]!.request.status, "superseded");
});
