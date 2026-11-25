import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { test } from "vite-plus/test";
import { createWorkflow } from "../../src/opencode/application.ts";
import { interruptApprovalWrite } from "../helpers/retained-execution.ts";
import { CrewError } from "../../src/domain.ts";
import { IssueId, SessionId, FormId, Timestamp } from "@abracode/contracts/identities";
import { Agent } from "@opencode/schema/agent";
import { fixture, planned } from "../fixtures.ts";
import { run } from "../effects.ts";

const supervisor = SessionId.make("ses_supervisor");

test("approval checks the central principal before writing checkpoint state", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const first = await run(planned(f));
  const other = await run(planned(f, IssueId.make("other")));
  const lead = SessionId.make("ses_project-lead");
  f.runtime.sessions.set(lead, {
    id: lead,
    directory: f.config.home,
    agent: Agent.ID.make("project-lead"),
    busy: false,
  });
  const before = await run(f.records.execution(first.issue_id));
  for (const kind of ["plan", "merge"] as const) {
    await assert.rejects(
      run(f.controller.approve(first.issue_id, kind, other.explore_session_id!)),
      /Workers cannot authorize/,
    );
    await assert.rejects(run(f.controller.approve(first.issue_id, kind, lead)), /central Abra/);
  }
  assert.deepEqual(await run(f.records.execution(first.issue_id)), before);
  assert.equal(f.runtime.forms.size, 0);
});

test("a form answered during its first request commits authorization before Apply admission", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(planned(f));
  const request = f.runtime.requestApproval.bind(f.runtime);
  const otherForm = FormId.create();
  f.runtime.requestApproval = (session, form) =>
    request(session, form).pipe(
      Effect.tap(() =>
        f.records.update(e.issue_id, (current) => ({
          ...current,
          approval_receipts: [
            ...current.approval_receipts,
            {
              ...current.approval_receipts[0]!,
              form_id: otherForm,
              rejected_at: Timestamp.make("2026-01-01T00:00:00.000Z"),
            },
          ],
        })),
      ),
      Effect.tap(() => Effect.sync(() => f.runtime.forms.set(form, "approved"))),
    );
  const accepted = await run(f.controller.approve(e.issue_id, "plan", supervisor));
  assert.ok("current_phase" in accepted);
  assert.equal(accepted.current_phase, "applying");
  const retained = (await run(f.records.execution(e.issue_id)))!;
  assert.equal(retained.approval_receipts.length, 2);
  assert.ok(retained.approval_receipts.find((a) => a.form_id === otherForm)?.rejected_at);
  assert.ok(retained.approval_receipts[0]!.authorized_at);
});

test("checkpoint observation, lost form response, restart and admission share exact content evidence", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(planned(f));
  const requested: FormId[] = [];
  const request = f.runtime.requestApproval.bind(f.runtime);
  let loseResponse = true;
  f.runtime.requestApproval = (session, form) =>
    Effect.gen(function* () {
      const retained = (yield* f.records.execution(e.issue_id))!;
      const receipt = retained.approval_receipts.find((a) => a.form_id === form);
      assert.equal(receipt?.session_id, session, "Form identity must be durable before request");
      assert.equal(receipt?.fingerprint, e.plan_fingerprint);
      requested.push(form);
      yield* request(session, form);
      if (loseResponse) {
        loseResponse = false;
        return yield* new CrewError("FORM_RESPONSE_LOST", "Native form response lost");
      }
      return form;
    });
  await assert.rejects(run(f.controller.approve(e.issue_id, "plan", supervisor)), /response lost/);
  const receipt = (await run(f.records.execution(e.issue_id)))!.approval_receipts[0]!;
  assert.equal(receipt.authorized_at, undefined);
  assert.equal(f.runtime.forms.get(receipt.form_id), "pending");

  await run(f.controller.close());
  const restarted = createWorkflow(
    f.catalog,
    f.config,
    f.records,
    f.work,
    f.spec,
    f.git,
    f.runtime,
    f.delivery,
    f.locks,
  ).controller;
  t.onTestFinished(() => run(restarted.close()));
  const pending = await run(restarted.approve(e.issue_id, "plan", supervisor));
  assert.ok("form_id" in pending);
  assert.equal(pending.form_id, receipt.form_id);
  f.runtime.forms.set(receipt.form_id, "approved");
  const observe = () => run(restarted.queries.checkpoint(supervisor, receipt.form_id));
  const before = await run(f.records.execution(e.issue_id));
  assert.equal((await observe()).active, true);
  assert.deepEqual(await run(f.records.execution(e.issue_id)), before);

  const proposal = join(
    e.worktree_directory!,
    "openspec/changes",
    e.openspec_change,
    "proposal.md",
  );
  const original = await readFile(proposal);
  await writeFile(proposal, Buffer.concat([original, Buffer.from("\nChanged after request.\n")]));
  assert.equal((await observe()).active, false);
  await assert.rejects(
    run(restarted.approve(e.issue_id, "plan", supervisor)),
    /Checkpoint changed/,
  );
  assert.equal(
    (await run(f.records.execution(e.issue_id)))!.approval_receipts[0]!.authorized_at,
    undefined,
  );
  assert.equal(requested.length, 2, "Stale content must not request or collect a form");

  await writeFile(proposal, original);
  const [accepted] = await run(restarted.reconcile(e.issue_id));
  assert.equal(accepted!.current_phase, "applying");
  assert.ok(accepted!.approval_receipts[0]!.authorized_at);
  assert.equal((await observe()).active, false);
  assert.deepEqual(requested, [receipt.form_id, receipt.form_id, receipt.form_id]);
  assert.equal(f.runtime.forms.size, 1);

  f.spec.done = true;
  f.runtime.success(accepted!.apply_session_id!);
  await writeFile(proposal, Buffer.concat([original, Buffer.from("\nChanged after admission.\n")]));
  await assert.rejects(run(restarted.advance(e.issue_id)), /planning artifacts changed/);
  assert.equal((await run(f.records.execution(e.issue_id)))!.verification_receipt, undefined);
  assert.equal(f.delivery.calls, 0);
});

test("an interrupted approval receipt commit recollects the same answered form after restart", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(planned(f));
  const pending = await run(f.controller.approve(e.issue_id, "plan", supervisor));
  assert.ok("form_id" in pending);
  f.runtime.forms.set(pending.form_id, "approved");
  interruptApprovalWrite(f.records, "execution/" + e.issue_id, pending.form_id);
  await assert.rejects(
    run(f.controller.approve(e.issue_id, "plan", supervisor)),
    /receipt interrupted/,
  );
  assert.equal(
    (await run(f.records.execution(e.issue_id)))!.approval_receipts[0]!.authorized_at,
    undefined,
  );
  assert.equal(
    (await run(f.controller.queries.checkpoint(supervisor, pending.form_id))).active,
    true,
  );
  await run(f.controller.close());

  const restarted = createWorkflow(
    f.catalog,
    f.config,
    f.records,
    f.work,
    f.spec,
    f.git,
    f.runtime,
    f.delivery,
    f.locks,
  ).controller;
  t.onTestFinished(() => run(restarted.close()));
  const [accepted] = await run(restarted.reconcile(e.issue_id));
  assert.equal(accepted!.current_phase, "applying");
  assert.equal(accepted!.approval_receipts.length, 1);
  assert.equal(accepted!.approval_receipts[0]!.form_id, pending.form_id);
  assert.ok(accepted!.approval_receipts[0]!.authorized_at);
  assert.equal(f.runtime.forms.size, 1);
});
