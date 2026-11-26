import { workGraphAt } from "../helpers/work-database.ts";
import { tmpdir } from "node:os";
import { retainedExecution } from "../helpers/retained-execution.ts";
import { Queries } from "../../src/workflow/queries.ts";
import { Git } from "../../src/git/repository.ts";
import { ProcessRunner } from "../../src/process.ts";
import { checkpointMatchesForm } from "../../src/web/form-binding.ts";
import { Form } from "@opencode/schema/form";
import assert from "node:assert/strict";
import { test, type TestContext } from "vite-plus/test";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Effect } from "effect";
import { CrewError } from "../../src/domain.ts";
import { fixtureConfig, FakeRuntime, FakeSpec } from "../fixtures.ts";
import { run } from "../effects.ts";
import * as Id from "@abracode/contracts/identities";
const supervisor = Id.SessionId.make("ses_supervisor");

async function checkpointFixture(t: TestContext, root: string, kind: "plan" | "merge") {
  const git = new Git(new ProcessRunner());
  const directory = Id.AbsolutePath.make(root);
  const change = Id.ChangeName.make("work-one");
  const commit = Id.Commit.make("a".repeat(40));
  if (kind === "plan") {
    const path = join(root, "openspec/changes", change);
    await mkdir(path, { recursive: true });
    await writeFile(join(path, "proposal.md"), "Original proposal");
  }
  const fingerprint = kind === "plan" ? await run(git.planFingerprint(directory, change)) : commit;
  const approval: import("../../src/domain.ts").Approval =
    kind === "plan"
      ? {
          kind: "plan",
          fingerprint: Id.Fingerprint.make(fingerprint),
          form_id: Id.FormId.make("frm_checkpoint"),
          session_id: supervisor,
        }
      : {
          kind: "merge",
          fingerprint: commit,
          form_id: Id.FormId.make("frm_checkpoint"),
          session_id: supervisor,
        };
  const { records, execution } = await retainedExecution({
    current_phase: kind === "plan" ? "awaiting_plan_approval" : "awaiting_merge",
    worktree_directory: directory,
    base_commit: commit,
    target_branch: Id.BranchName.make("main"),
    openspec_change: change,
    plan_fingerprint: Id.Fingerprint.make(fingerprint),
    delivered_commit: kind === "merge" ? commit : undefined,
    approval_receipts: [approval],
  });
  const config = await run(fixtureConfig(root));
  const queries = new Queries(
    config,
    records,
    (await workGraphAt(t)).graph,
    new FakeSpec(),
    git,
    new FakeRuntime(git),
  );
  return { records, execution, git, queries, approval };
}

test("browser plan checkpoint observes current Git bytes and leaves the native approval unconsumed", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "abra-checkpoint-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const f = await checkpointFixture(t, root, "plan");
  const { execution: retained, approval } = f;
  const read = () => run(f.queries.checkpoint(supervisor, approval.form_id));
  const current = await read();
  assert.equal(current.active, true);
  assert.equal("kind" in current && current.kind, "plan");
  assert.equal(
    (await run(f.queries.checkpoint(Id.SessionId.make("ses_foreign"), approval.form_id))).active,
    false,
  );
  assert.equal((await run(f.queries.checkpoint(supervisor, "frm_unknown"))).active, false);
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
  assert.deepEqual(await run(f.records.execution(retained.issue_id)), retained);
  assert.equal(approval.authorized_at, undefined);
  const fingerprint = f.git.planFingerprint.bind(f.git);
  f.git.planFingerprint = () => Effect.fail(new CrewError("GIT_UNAVAILABLE", "Read unavailable"));
  assert.equal((await read()).active, false, "Observation must use the supplied Git adapter");
  assert.deepEqual(await run(f.records.execution(retained.issue_id)), retained);
  f.git.planFingerprint = fingerprint;
  assert.equal((await read()).active, true);
});

test("merge checkpoint does not authorize another delivered-content identity", async (t) => {
  const root = "/fixture";
  const f = await checkpointFixture(t, root, "merge");
  let { execution: retained, approval } = f;
  assert.equal((await run(f.queries.checkpoint(supervisor, approval.form_id))).active, true);
  retained = { ...retained, delivered_commit: Id.Commit.make("f".repeat(40)) };
  await run(f.records.save(retained));
  assert.equal((await run(f.queries.checkpoint(supervisor, approval.form_id))).active, false);
  assert.equal(
    (await run(f.records.execution(retained.issue_id)))!.approval_receipts.find(
      (receipt) => receipt.form_id === approval.form_id,
    )?.authorized_at,
    undefined,
  );
});

test("decision generation and finishing targets remain exact native bindings after supersession", async (t) => {
  let { records, execution, queries } = await checkpointFixture(t, "/fixture", "merge");
  const key = Id.ObligationKey.make("finishing-residue");
  execution = {
    ...execution,
    decisions: [
      {
        schema_version: 1,
        generation: execution.control_generation,
        key,
        scope: "finishing",
        question: "Preserve local residue?",
        owner: "user",
        session_id: "controller",
        opened_at: 0,
        status: "open",
        form_session: supervisor,
        form_id: Id.FormId.make("frm_finishing"),
        finishing_target: {
          schema_version: 1,
          generation: execution.control_generation,
          kind: "residue",
          worktree: { path: execution.worktree_directory!, device: "1", inode: "2", birth: "3" },
          fingerprint: Id.Fingerprint.make("residue"),
          paths: [{ path: Id.RelativePath.make("cache"), kind: "directory", category: "ignored" }],
          files: [],
          directories: [],
          truncated: false,
        },
      },
    ],
  };
  execution = await run(records.save(execution));
  const retained = (await run(records.execution(execution.issue_id)))!;
  const current = retained.decisions!.find((item) => item.key === key)!;
  assert.ok(current.finishing_target);
  assert.ok(current.form_id);
  const observed = await run(queries.checkpoint(supervisor, current.form_id!));
  assert.equal(observed.active, true);
  assert.equal(
    "identity" in observed && observed.identity,
    `${execution.issue_id}:${current.generation}:${current.key}`,
  );
  assert.equal(
    "finishing_target" in observed && observed.finishing_target,
    createHash("sha256").update(JSON.stringify(current.finishing_target)).digest("hex"),
  );
  await run(records.commitControl(execution));
  assert.equal((await run(queries.checkpoint(supervisor, current.form_id!))).active, false);
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
