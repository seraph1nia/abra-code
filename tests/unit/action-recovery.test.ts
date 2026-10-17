import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { Deferred, Effect, Fiber, Schema } from "effect";
import { deliveredPR, noEffect } from "../helpers/delivered-pr.ts";
import { run } from "../effects.ts";
import * as Id from "../../src/identities.ts";
import { CrewError } from "../../src/domain.ts";
import { type Delivery } from "../../src/git/delivery.ts";
import { type PreparedWrite } from "../../src/git/action-contracts.ts";
import { type CurrentAction, ActionSchema } from "../../src/workflow/action-contracts.ts";
import { normalizeAction } from "../../src/workflow/action-state.ts";
import { PRActions } from "../../src/workflow/pr-actions.ts";

function command(action: CurrentAction): PreparedWrite["command"] {
  switch (action.kind) {
    case "ready":
      return { kind: "ready" };
    case "reviewers":
      return { kind: "reviewers", endpoint: "fixture", users: ["alice"], teams: [] };
    case "reply":
      return { kind: "reply", endpoint: "fixture", body: action.target.body, actor: "bot" };
    case "resolve":
      return { kind: "resolve", thread: action.target.thread_id };
    case "rerun":
      return { kind: "rerun", endpoint: "fixture" };
  }
}
for (const kind of ["ready", "reviewers", "reply", "rerun"] as const)
  for (const failure of [
    "COMMAND_FAILED",
    "COMMAND_DEADLINE",
    "INVALID_OUTPUT",
    "interruption",
  ] as const)
    test(`${kind} ${failure} after admission reconciles after restart without replay`, async (t) => {
      const { f, e, p } = await deliveredPR(t, {
        ci_retry: { max_reruns: 1, workflows: [".github/workflows/ci.yml"] },
      });
      const source = {
        id: Id.FindingId.make("source"),
        source_id: "source",
        revision: "r1",
        head: e.delivered_commit!,
        kind: kind === "rerun" ? ("check" as const) : ("comment" as const),
        text: "Accepted finding",
        blocking: true,
        run_id: 7,
        run_attempt: 1,
        workflow: ".github/workflows/ci.yml",
        disposition: {
          status: kind === "rerun" ? ("transient" as const) : ("addressed" as const),
          head: e.delivered_commit!,
          at: 1,
          actor: "controller",
          reason: "Verified current evidence",
        },
      };
      e.feedback = { ...e.feedback!, findings: [source] };
      await run(f.records.save(e));
      let sends = 0,
        observations = 0;
      const entered = Deferred.makeUnsafe<void>();
      const delivery: Delivery = {
        deliver: f.delivery.deliver,
        inspect: f.delivery.inspect.bind(f.delivery),
        merge: f.delivery.merge.bind(f.delivery),
        evidence: f.delivery.evidence.bind(f.delivery),
        actions: {
          prepare: (_p, _e, action) =>
            Effect.succeed({ kind: "write", write: { action, command: command(action) } }),
          submit: () => {
            sends++;
            return failure === "interruption"
              ? Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never))
              : Effect.fail(
                  new CrewError(failure, "Permission read unavailable: response lost after write"),
                );
          },
          reconcile: () => {
            observations++;
            return Effect.succeed({ kind: "confirmed", receipt: `${kind} source receipt` });
          },
        },
      };
      const service = new PRActions(f.records, delivery, f.runtime);
      const input = {
        issue_id: e.issue_id,
        generation: e.control_generation,
        expected_head: e.delivered_commit!,
        kind,
        finding_id: ["reply", "rerun"].includes(kind) ? source.id : undefined,
        users: kind === "reviewers" ? ["alice"] : undefined,
      };
      const actor = Id.SessionId.make("ses_supervisor");
      // Reserve a manual form where needed, then approve that exact retained payload.
      if (kind !== "rerun") {
        await run(service.run(e, p, input, actor));
        f.runtime.forms.set(e.feedback!.actions[0].form_id!, "approved");
      }
      if (failure === "interruption")
        await run(
          Effect.scoped(
            Effect.gen(function* () {
              const fiber = yield* service.run(e, p, input, actor).pipe(Effect.forkScoped);
              yield* Deferred.await(entered);
              yield* Fiber.interrupt(fiber);
            }),
          ),
        );
      else await run(service.run(e, p, input, actor));
      const restored = (await run(f.records.execution(e.issue_id)))!;
      const action = normalizeAction(restored.feedback!.actions[0], restored);
      assert.equal(action.submission.stage, "admitted");
      assert.equal(action.status, failure === "interruption" ? "running" : "uncertain");
      assert.equal(sends, 1);
      await run(f.records.saveControl(restored));
      const restoredDelivery: Delivery = {
        ...delivery,
        actions: {
          prepare: noEffect,
          submit: noEffect,
          reconcile: (project, execution, action) =>
            delivery.actions!.reconcile(project, execution, action),
        },
      };
      await run(
        new PRActions(f.records, restoredDelivery, f.runtime).run(
          restored,
          p,
          { ...input, generation: restored.control_generation, action_id: action.id },
          actor,
        ),
      );
      assert.equal(sends, 1);
      assert.equal(observations, 1);
      assert.equal(restored.feedback!.actions[0].status, "confirmed");
      assert.equal(restored.feedback!.actions[0].id, action.id);
      assert.equal(restored.feedback!.actions[0].form_id, action.form_id);
    });

test("legacy stages round-trip through records with old payloads, forms, receipts and duplicate reservations", async (t) => {
  const { f, e } = await deliveredPR(t);
  const base = {
    schema_version: 1 as const,
    id: "legacy",
    generation: 0,
    head: e.delivered_commit!,
    kind: "reply" as const,
    status: "prepared" as const,
    created_at: 1,
    updated_at: 2,
    authority: "manual",
    finding: Id.FindingId.make("old-finding"),
    revision: "old-revision",
    thread_id: "thread",
    comment_id: 7,
    body: "Exact original body",
    result: "Source receipt",
    form_id: Id.FormId.make("frm_old"),
    session_id: Id.SessionId.make("ses_supervisor"),
    authorized_at: 1,
  };
  const originals = (["prepared", "running", "uncertain", "confirmed", "superseded"] as const).map(
    (status) => ({ ...base, id: `old-${status}`, status }),
  );
  e.feedback = {
    ...e.feedback!,
    actions: [...originals, { ...originals[2], id: "historical-duplicate" }],
  };
  await run(f.records.save(e));
  const restored = (await run(f.records.execution(e.issue_id)))!;
  assert.deepEqual(restored.feedback!.actions, e.feedback.actions);
  const normalized = restored.feedback!.actions.map((a) => normalizeAction(a, restored));
  assert.deepEqual(
    normalized.map((a) => a.submission.stage),
    ["unsubmitted", "admitted", "admitted", "confirmed", "unsubmitted", "admitted"],
  );
  for (const [index, action] of normalized.entries()) {
    assert.deepEqual(action.legacy, restored.feedback!.actions[index]);
    assert.equal(action.form_id, base.form_id);
    assert.equal(action.kind === "reply" && action.target.body, base.body);
    assert.equal(action.id, restored.feedback!.actions[index].id);
  }
  restored.feedback = { ...restored.feedback!, actions: normalized };
  await run(f.records.save(restored));
  assert.deepEqual((await run(f.records.execution(e.issue_id)))!.feedback!.actions, normalized);
  assert.throws(() => Schema.decodeUnknownSync(ActionSchema)({ ...base, schema_version: 3 }));
  assert.throws(() => normalizeAction({ ...base, comment_id: undefined }, restored), /comment ID/);
  assert.throws(() => normalizeAction({ ...base, kind: "rerun" }, restored), /incomplete attempt/);
  assert.throws(
    () => normalizeAction({ ...base, kind: "reviewers" }, restored),
    /explicit targets/,
  );
});

test("crash after durable admission but before process entry never resends", async (t) => {
  const { f, e, p } = await deliveredPR(t);
  const service = new PRActions(f.records, f.delivery, f.runtime);
  const prepared = service.prepare(
    e,
    { issue_id: e.issue_id, generation: 0, expected_head: e.delivered_commit!, kind: "ready" },
    false,
    1,
  );
  e.feedback = {
    ...e.feedback!,
    actions: [
      { ...prepared, status: "running", submission: { stage: "admitted", at: 2 }, updated_at: 2 },
    ],
  };
  await run(f.records.save(e));
  const restored = (await run(f.records.execution(e.issue_id)))!;
  const delivery: Delivery = {
    deliver: f.delivery.deliver,
    inspect: f.delivery.inspect.bind(f.delivery),
    merge: f.delivery.merge.bind(f.delivery),
    evidence: f.delivery.evidence.bind(f.delivery),
    actions: {
      prepare: noEffect,
      submit: noEffect,
      reconcile: () => Effect.succeed({ kind: "awaiting", detail: "No postcondition yet" }),
    },
  };
  await run(
    new PRActions(f.records, delivery, f.runtime).run(restored, p, {
      issue_id: e.issue_id,
      generation: 0,
      expected_head: e.delivered_commit!,
      kind: "ready",
      action_id: prepared.id,
    }),
  );
  assert.equal(
    normalizeAction(restored.feedback!.actions[0], restored).submission.stage,
    "admitted",
  );
  assert.equal(restored.feedback!.actions[0].status, "running");
});

test("unsupported stored action remains intact and unavailable with a record diagnostic", async (t) => {
  const { MemoryStore } = await import("../fixtures.ts");
  const { Records } = await import("../../src/storage/store.ts");
  const { e } = await deliveredPR(t);
  const store = new MemoryStore();
  const records = new Records(store);
  const key = Id.StorageKey.make(`execution/${e.issue_id}`);
  const raw = {
    ...e,
    feedback: {
      ...e.feedback!,
      actions: [{ schema_version: 99, id: "future-action", opaque_receipt: "preserve me" }],
    },
  };
  await run(store.set(key, raw));
  await assert.rejects(run(records.execution(e.issue_id)), /schema_version/);
  const scan = await run(records.executionScan());
  assert.equal(scan.values.length, 0);
  assert.equal(scan.diagnostics[0].key, key);
  assert.deepEqual(await run(store.get(key)), raw);
});

for (const possibleEffect of [true, false])
  test(`mixed historical duplicate reservations preserve budget and admit at most once: possible effect ${possibleEffect}`, async (t) => {
    const { f, e, p } = await deliveredPR(t, {
      reviewers: {
        users: ["alice"],
        teams: [],
        request: "on-ready",
        rerequest_after_correction: false,
      },
    });
    const legacy = {
      schema_version: 1 as const,
      id: "first-reservation",
      generation: 0,
      head: e.delivered_commit!,
      kind: "reviewers" as const,
      status: "prepared" as const,
      created_at: 1,
      updated_at: 2,
      authority: "execution-policy",
      users: ["alice"],
      teams: [],
    };
    e.feedback = {
      ...e.feedback!,
      actions: [
        legacy,
        { ...legacy, id: "second-reservation", status: possibleEffect ? "uncertain" : "prepared" },
      ],
    };
    await run(f.records.save(e));
    let submits = 0;
    const delivery: Delivery = {
      deliver: f.delivery.deliver,
      inspect: f.delivery.inspect.bind(f.delivery),
      merge: f.delivery.merge.bind(f.delivery),
      evidence: f.delivery.evidence.bind(f.delivery),
      actions: {
        prepare: (_p, _e, action) =>
          Effect.succeed({ kind: "write", write: { action, command: command(action) } }),
        submit: () => {
          submits++;
          return Effect.succeed({ kind: "confirmed", receipt: "Request source receipt" });
        },
        reconcile: () =>
          Effect.succeed({
            kind: "awaiting",
            detail: "Still observing the original possible effect",
          }),
      },
    };
    const service = new PRActions(f.records, delivery, f.runtime);
    const selected = service.prepare(
      e,
      {
        issue_id: e.issue_id,
        generation: 0,
        expected_head: e.delivered_commit!,
        kind: "reviewers",
      },
      true,
      3,
    );
    assert.equal(selected.id, possibleEffect ? "second-reservation" : "first-reservation");
    await run(service.automatic(e, p));
    const restored = (await run(f.records.execution(e.issue_id)))!;
    await run(new PRActions(f.records, delivery, f.runtime).automatic(restored, p));
    assert.equal(submits, possibleEffect ? 0 : 1);
    assert.equal(restored.feedback!.actions.length, 2, "Keep both historical reservations");
    assert.ok(restored.feedback!.actions.some((a) => a.status === "superseded"));
    if (possibleEffect)
      assert.ok(
        restored.feedback!.actions.some(
          (a) => a.id === "second-reservation" && a.status === "uncertain",
        ),
      );
  });
