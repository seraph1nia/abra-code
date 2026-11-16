import { checkpointMatchesForm } from "../../src/web/form-binding.ts";
import { Form } from "@opencode/schema/form";
import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Effect } from "effect";
import { CrewError } from "../../src/domain.ts";
import { fixture, planned, delivered } from "../fixtures.ts";
import { run } from "../effects.ts";
import * as Id from "../../src/identities.ts";
const supervisor = Id.SessionId.make("ses_supervisor");

test("browser plan checkpoint observes current Git bytes and leaves the native approval unconsumed", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const execution = await run(planned(f));
  await run(f.controller.approve(execution.issue_id, "plan", supervisor));
  const retained = (await run(f.records.execution(execution.issue_id)))!;
  const approval = retained.approval_receipts.find((receipt) => receipt.kind === "plan")!;
  const read = () => run(f.controller.queries.checkpoint(supervisor, approval.form_id));
  const current = await read();
  assert.equal(current.active, true);
  assert.equal("kind" in current && current.kind, "plan");
  assert.equal(
    (await run(f.controller.queries.checkpoint(Id.SessionId.make("ses_foreign"), approval.form_id)))
      .active,
    false,
  );
  assert.equal(
    (await run(f.controller.queries.checkpoint(supervisor, "frm_unknown"))).active,
    false,
  );
  const proposal = join(
    retained.worktree_directory!,
    "openspec/changes",
    retained.openspec_change,
    "proposal.md",
  );
  const bytes = await readFile(proposal);
  await writeFile(
    proposal,
    Buffer.concat([bytes, Buffer.from("\nChanged after the approval request.\n")]),
  );
  assert.equal((await read()).active, false);
  await writeFile(proposal, bytes);
  assert.equal((await read()).active, true);
  assert.deepEqual(await run(f.records.execution(execution.issue_id)), retained);
  assert.equal(approval.authorized_at, undefined);
  const fingerprint = f.git.planFingerprint.bind(f.git);
  f.git.planFingerprint = () => Effect.fail(new CrewError("GIT_UNAVAILABLE", "Read unavailable"));
  assert.equal((await read()).active, false, "Observation must use the supplied Git adapter");
  assert.deepEqual(await run(f.records.execution(execution.issue_id)), retained);
  f.git.planFingerprint = fingerprint;
  assert.equal((await read()).active, true);
});

test("merge checkpoint does not authorize another delivered-content identity", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const execution = await run(delivered(f));
  await run(f.controller.approve(execution.issue_id, "merge", supervisor));
  const retained = (await run(f.records.execution(execution.issue_id)))!;
  const approval = retained.approval_receipts.find((receipt) => receipt.kind === "merge")!;
  assert.equal(
    (await run(f.controller.queries.checkpoint(supervisor, approval.form_id))).active,
    true,
  );
  retained.delivered_commit = Id.Commit.make("f".repeat(40));
  await run(f.records.save(retained));
  assert.equal(
    (await run(f.controller.queries.checkpoint(supervisor, approval.form_id))).active,
    false,
  );
  assert.equal(
    (await run(f.records.execution(execution.issue_id)))!.approval_receipts.find(
      (receipt) => receipt.form_id === approval.form_id,
    )?.authorized_at,
    undefined,
  );
});

test("decision generation and finishing targets remain exact native bindings after supersession", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const execution = await run(delivered(f));
  const root = execution.worktree_directory!;
  const exclude = await run(f.git.run(root, ["rev-parse", "--git-path", "info/exclude"]));
  await writeFile(exclude, "cache/\n");
  await mkdir(join(root, "cache"));
  await writeFile(join(root, "cache/value"), "Retain");
  const finishing = await run(f.controller.finish(execution.issue_id));
  const decision = finishing.decisions!.find((decision) => decision.status === "open")!;
  await run(
    f.controller.decision(
      execution.issue_id,
      decision.key,
      finishing.control_generation,
      supervisor,
      "collect",
    ),
  );
  const retained = (await run(f.records.execution(execution.issue_id)))!;
  const current = retained.decisions!.find((item) => item.key === decision.key)!;
  assert.ok(current.finishing_target);
  assert.ok(current.form_id);
  const observed = await run(f.controller.queries.checkpoint(supervisor, current.form_id!));
  assert.equal(observed.active, true);
  assert.equal(
    "identity" in observed && observed.identity,
    `${execution.issue_id}:${current.generation}:${current.key}`,
  );
  assert.equal(
    "finishing_target" in observed && observed.finishing_target,
    createHash("sha256").update(JSON.stringify(current.finishing_target)).digest("hex"),
  );
  await run(f.controller.control(execution.issue_id, "pause"));
  assert.equal(
    (await run(f.controller.queries.checkpoint(supervisor, current.form_id!))).active,
    false,
  );
});

test("native form metadata cannot bind stale plan/merge, decision or finishing targets", () => {
  const form: Form.Info = {
    id: Form.ID.make("frm_native"),
    sessionID: supervisor,
    title: "Native checkpoint",
    fields: [{ type: "boolean", key: "authorize", title: "Authorize", default: false }],
    metadata: {
      source: "abracode",
      fingerprint: "content-one",
      decision_identity: "task:0:decision",
      finishing_target: "target-one",
    },
  };
  assert.equal(checkpointMatchesForm(form, { active: true, fingerprint: "content-one" }), true);
  assert.equal(checkpointMatchesForm(form, { active: true, fingerprint: "content-two" }), false);
  assert.equal(checkpointMatchesForm(form, { active: true, identity: "task:1:decision" }), false);
  assert.equal(
    checkpointMatchesForm(form, {
      active: true,
      identity: "task:0:decision",
      finishing_target: "target-two",
    }),
    false,
  );
  assert.equal(checkpointMatchesForm(form, { active: false, fingerprint: "content-one" }), false);
  assert.equal(
    checkpointMatchesForm(form, {
      active: true,
      identity: "task:0:decision",
      finishing_target: "target-one",
    }),
    true,
  );
  assert.equal(
    checkpointMatchesForm(
      { id: form.id, sessionID: form.sessionID, title: form.title, fields: form.fields },
      { active: true, fingerprint: "content-one" },
    ),
    false,
  );
});
