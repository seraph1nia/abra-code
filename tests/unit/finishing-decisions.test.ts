import { Effect } from "effect";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { mkdir, writeFile, rename, access, rm } from "node:fs/promises";
import { join } from "node:path";
import * as Id from "../../src/identities.ts";
import { delivered, fixture } from "../fixtures.ts";
import { run } from "../effects.ts";
import { deliveryOutcome, DeliveryOutcomeSchema } from "../../src/workflow/delivery-outcome.ts";
import { section, stateLabel } from "../../src/visibility/presentation.ts";
import { Schema } from "effect";

async function retained(files: string[]) {
  const f = await run(fixture);
  const e = await run(delivered(f));
  const exclude = await run(
    f.git.run(e.worktree_directory!, ["rev-parse", "--git-path", "info/exclude"]),
  );
  await writeFile(exclude, files.map((path) => `${path}\n`).join(""));
  return { f, e, root: e.worktree_directory! };
}

test("undelivered finishing forms remain visible and observers preserve the retained snapshot", async (t) => {
  const { f, e, root } = await retained(["cache/"]);
  t.onTestFinished(() => run(f.close()));
  delete e.supervisor_session_id;
  await run(f.records.save(e));
  await mkdir(join(root, "cache"));
  await writeFile(join(root, "cache/value"), "preserve");
  let current = await run(f.controller.finish(e.issue_id));
  const question = current.decisions!.find((d) => d.status === "open")!;
  assert.equal(current.finishing!.routing![0].status, "undelivered");
  const before = structuredClone(current);
  const outcome = deliveryOutcome(current, "in_progress", Date.now());
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(Schema.decodeSync(DeliveryOutcomeSchema)(JSON.parse(JSON.stringify(outcome)))),
    ),
    JSON.parse(JSON.stringify(outcome)),
  );
  assert.equal(outcome.finishing!.questions[0].routing, "undelivered");
  assert.match(outcome.next_action, /undelivered/);
  const item = {
    issue_id: e.issue_id,
    title: "Finishing",
    priority: 1,
    issue_status: "in_progress" as const,
    eligible: false,
    phase: current.current_phase,
    sessions: [],
    blockers: [],
    decisions: current.decisions,
    outcome,
  };
  assert.equal(section(item), "attention");
  assert.match(stateLabel(item), /form undelivered/);
  assert.deepEqual(current, before);
  await assert.rejects(
    run(
      f.controller.decision(
        e.issue_id,
        question.key,
        current.control_generation,
        e.apply_session_id!,
        "collect",
      ),
    ),
    { code: "WORKER_FORBIDDEN" },
  );
  await run(
    f.controller.decision(
      e.issue_id,
      question.key,
      current.control_generation,
      Id.SessionId.make("ses_supervisor"),
      "collect",
    ),
  );
  current = await run(f.controller.get(e.issue_id));
  assert.ok(current.decisions!.find((d) => d.key === question.key)!.form_id);
  assert.equal(current.finishing!.authorizations, undefined);
  await access(join(root, "cache/value"));
});

test("defer stays quiet and explicit reconsideration retains old form history", async (t) => {
  const { f, e, root } = await retained(["build-output/"]);
  t.onTestFinished(() => run(f.close()));
  await mkdir(join(root, "build-output"));
  await writeFile(join(root, "build-output/cache"), "generated");
  await run(f.controller.approve(e.issue_id, "merge", e.supervisor_session_id!));
  let current = await run(f.controller.get(e.issue_id));
  const question = current.decisions!.find((d) => d.status === "open")!;
  f.runtime.dispositions.set(question.form_id!, {
    status: "answered",
    answer: { action: "defer", paths: [] },
  });
  current = (await run(f.controller.reconcile(e.issue_id)))[0];
  const count = f.runtime.dispositions.size;
  for (let i = 0; i < 3; i++) await run(f.controller.reconcile(e.issue_id));
  assert.equal(f.runtime.dispositions.size, count);
  assert.equal(f.delivery.merged, false);
  await access(join(root, "build-output/cache"));
  await run(
    f.controller.decision(
      e.issue_id,
      question.key,
      question.generation,
      e.supervisor_session_id!,
      "reconsider",
    ),
  );
  current = (await run(f.controller.reconcile(e.issue_id)))[0];
  const reconsidered = current.decisions!.find((d) => d.key === question.key)!;
  assert.notEqual(reconsidered.form_id, question.form_id);
  assert.equal(reconsidered.finishing_history![0].form_id, question.form_id);
  f.runtime.dispositions.set(reconsidered.form_id!, {
    status: "answered",
    answer: { action: "generated", paths: [Id.RelativePath.make("build-output")] },
  });
  current = (await run(f.controller.reconcile(e.issue_id)))[0];
  assert.equal(current.finishing!.authorizations!.length, 1);
  await writeFile(join(root, "build-output/regenerated"), "later generated data");
  const approval = current.approval_receipts.find(
    (a) => a.kind === "merge" && a.fingerprint === current.delivered_commit,
  )!;
  f.runtime.forms.set(approval.form_id, "approved");
  assert.equal((await run(f.controller.reconcile(e.issue_id)))[0].current_phase, "completed");
});

test("a generated-directory answer cannot authorize a replacement directory", async (t) => {
  const { f, e, root } = await retained(["build-output/"]);
  t.onTestFinished(() => run(f.close()));
  await mkdir(join(root, "build-output"));
  await writeFile(join(root, "build-output/keep"), "original");
  await run(f.controller.approve(e.issue_id, "merge", e.supervisor_session_id!));
  const question = (await run(f.controller.get(e.issue_id))).decisions!.find(
    (d) => d.status === "open",
  )!;
  f.runtime.dispositions.set(question.form_id!, {
    status: "answered",
    answer: { action: "generated", paths: [Id.RelativePath.make("build-output")] },
  });
  await rename(join(root, "build-output"), join(root, "old-output"));
  await mkdir(join(root, "build-output"));
  await writeFile(join(root, "build-output/keep"), "replacement");
  const blocked = (await run(f.controller.reconcile(e.issue_id)))[0];
  assert.equal(blocked.current_phase, "recovery_required");
  assert.equal(blocked.finishing?.authorizations?.length ?? 0, 0);
  assert.equal(f.delivery.merged, false);
  await access(join(root, "old-output/keep"));
  await access(join(root, "build-output/keep"));
});

test("preservation is verified by absence and resumes post-merge closure without finish", async (t) => {
  const { f, e, root } = await retained(["private-note"]);
  t.onTestFinished(() => run(f.close()));
  await writeFile(join(root, "private-note"), "user data");
  f.delivery.pr!.state = "MERGED";
  f.delivery.merged = true;
  const waiting = await run(f.controller.finish(e.issue_id));
  assert.equal(waiting.current_phase, "cleaning");
  assert.ok(waiting.delivery_receipt);
  const question = waiting.decisions!.find((d) => d.status === "open")!;
  const target = question.finishing_target;
  assert.ok(target);
  assert.equal(target.kind, "residue");
  if (target.kind === "residue")
    assert.deepEqual(target.files, [], "Post-merge notes must not be included in a merged PR");
  f.runtime.dispositions.set(question.form_id!, {
    status: "answered",
    answer: { action: "preserve", paths: [Id.RelativePath.make("private-note")] },
  });
  await rename(join(root, "private-note"), join(f.root, "preserved-note"));
  const completed = (await run(f.controller.reconcile(e.issue_id)))[0];
  assert.equal(completed.current_phase, "completed");
  await access(join(f.root, "preserved-note"));
  assert.equal((await run(f.work.show(e.issue_id))).status, "closed");
});

test("ignored inclusion stages only selected files and enters validation without another adoption form", async (t) => {
  const { f, e, root } = await retained(["selected-note", "unselected-note"]);
  t.onTestFinished(() => run(f.close()));
  await writeFile(join(root, "selected-note"), "deliver this");
  await writeFile(join(root, "unselected-note"), "preserve this");
  await run(f.controller.approve(e.issue_id, "merge", e.supervisor_session_id!));
  const question = (await run(f.controller.get(e.issue_id))).decisions!.find(
    (d) => d.status === "open",
  )!;
  f.runtime.dispositions.set(question.form_id!, {
    status: "answered",
    answer: { action: "include", paths: [Id.RelativePath.make("selected-note")] },
  });
  const current = (await run(f.controller.reconcile(e.issue_id)))[0];
  assert.equal(current.current_phase, "planning");
  assert.equal(current.finishing!.synchronization!.length, 1);
  assert.equal(f.delivery.calls, 1, "Publication still requires checks and independent Review");
  assert.equal(
    current.decisions!.some((d) => d.status === "open" && d.finishing_target?.kind === "adopt"),
    false,
  );
  assert.equal(await run(f.git.run(root, ["ls-files", "--", "selected-note"])), "selected-note");
  assert.equal(await run(f.git.run(root, ["ls-files", "--", "unselected-note"])), "");
  await access(join(root, "unselected-note"));
});

test("changed selected file content invalidates inclusion before staging", async (t) => {
  const { f, e, root } = await retained(["selected-note"]);
  t.onTestFinished(() => run(f.close()));
  await writeFile(join(root, "selected-note"), "original selection");
  await run(f.controller.approve(e.issue_id, "merge", e.supervisor_session_id!));
  const question = (await run(f.controller.get(e.issue_id))).decisions!.find(
    (d) => d.status === "open",
  )!;
  f.runtime.dispositions.set(question.form_id!, {
    status: "answered",
    answer: { action: "include", paths: [Id.RelativePath.make("selected-note")] },
  });
  await writeFile(join(root, "selected-note"), "changed selection");
  const current = (await run(f.controller.reconcile(e.issue_id)))[0];
  assert.equal(current.current_phase, "recovery_required");
  assert.match(current.error_or_recovery_reason!, /content changed/);
  assert.equal(await run(f.git.run(root, ["ls-files", "--", "selected-note"])), "");
  assert.equal(f.delivery.calls, 1);
  await access(join(root, "selected-note"));
});

test("fresh residue absence survives a concurrent observation update and closes preserved work", async (t) => {
  const { f, e, root } = await retained(["private-note"]);
  t.onTestFinished(() => run(f.close()));
  await writeFile(join(root, "private-note"), "fixture-owned note");
  f.delivery.pr!.state = "MERGED";
  f.delivery.merged = true;
  const waiting = await run(f.controller.finish(e.issue_id));
  assert.equal(waiting.current_phase, "cleaning");
  await rm(join(root, "private-note"));
  const command = f.git.run.bind(f.git);
  let updated = false;
  let observed = 0;
  f.git.run = (...args) =>
    command(...args).pipe(
      Effect.tap((output) =>
        Effect.gen(function* () {
          if (updated || !args[1].includes("--ignored") || output) return;
          updated = true;
          yield* f.records.update(e.issue_id, (current) => {
            observed = (current.attention_turns ?? 0) + 1;
            return { ...current, attention_turns: observed };
          });
        }),
      ),
    );
  const done = await run(f.controller.finish(e.issue_id));
  assert.ok(updated);
  assert.equal(done.current_phase, "completed");
  assert.equal(done.attention_turns, observed);
  assert.ok(!done.decisions?.some((d) => d.status === "open"));
  assert.equal((await run(f.work.show(e.issue_id))).status, "closed");
});
