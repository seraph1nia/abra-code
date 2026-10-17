import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { fixture, delivered } from "../fixtures.ts";
import { run } from "../effects.ts";
import { CrewError } from "../../src/domain.ts";
import * as Id from "../../src/identities.ts";
import { admitSynchronization } from "../../src/workflow/synchronization.ts";
import { observePublication } from "../../src/workflow/finishing-readiness.ts";
import { NativeRuntime } from "../../src/opencode/runtime.ts";
import { type Context } from "@opencode/plugin/effect/plugin";
import { type FinishingTarget } from "../../src/workflow/finishing-contracts.ts";

test("native finishing forms reconcile response loss with exact metadata and reject free-text or changed selections", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const session = Id.SessionId.make("ses_abra"),
    formID = Id.FormId.make("frm_exact");
  const identity = Id.QuestionIdentity.make("decision-exact");
  const worktree = {
    path: Id.AbsolutePath.make("/tmp/owned"),
    device: "1",
    inode: "2",
    birth: "3",
  };
  const target: FinishingTarget = {
    schema_version: 1,
    generation: 0,
    kind: "residue",
    worktree,
    fingerprint: Id.Fingerprint.make("exact-input"),
    truncated: false,
    files: [],
    paths: [{ path: Id.RelativePath.make("cache"), category: "ignored", kind: "directory" }],
    directories: [
      {
        path: Id.RelativePath.make("cache"),
        identity: { ...worktree, path: Id.AbsolutePath.make("/tmp/owned/cache") },
      },
    ],
  };
  let retained:
    | {
        id: typeof formID;
        metadata: Record<string, string>;
        fields: unknown[];
        state: { status: string; answer?: Record<string, unknown> };
      }
    | undefined;
  let creates = 0;
  const client = {
    session: {
      form: {
        get: () =>
          retained ? Effect.succeed(retained) : Effect.fail({ _tag: "FormNotFoundError" }),
        create: (input: {
          id: typeof formID;
          metadata: Record<string, string>;
          fields: unknown[];
        }) => {
          creates++;
          retained = { ...input, state: { status: "pending" } };
          return Effect.fail(new CrewError("RESPONSE_LOST", "Native form response lost"));
        },
      },
    },
  };
  const runtime = () => {
    const native = new NativeRuntime({} as Context, f.config);
    native.client = () =>
      Effect.succeed(client as unknown as Effect.Success<ReturnType<NativeRuntime["client"]>>);
    return native;
  };
  await assert.rejects(
    run(runtime().requestDisposition(session, formID, "Handle files", identity, target)),
    /response lost/,
  );
  assert.equal(
    await run(runtime().requestDisposition(session, formID, "Handle files", identity, target)),
    formID,
  );
  assert.equal(creates, 1);
  assert.match(JSON.stringify(retained!.fields), /multiselect/);
  assert.deepEqual(await run(runtime().disposition(session, formID, identity, target)), {
    status: "pending",
  });
  retained!.state = { status: "cancelled" };
  assert.deepEqual(await run(runtime().disposition(session, formID, identity, target)), {
    status: "cancelled",
  });
  for (const answer of [
    { action: "delete everything" },
    { answer: "yes remove cache" },
    { action: "generated", generated_paths: ["other"] },
  ]) {
    retained!.state = { status: "answered", answer };
    await assert.rejects(run(runtime().disposition(session, formID, identity, target)));
  }
  retained!.state = {
    status: "answered",
    answer: { action: "generated", generated_paths: ["cache"] },
  };
  assert.deepEqual(await run(runtime().disposition(session, formID, identity, target)), {
    status: "answered",
    answer: { action: "generated", paths: ["cache"] },
  });
  retained!.state = { status: "answered", answer: { action: "defer" } };
  assert.deepEqual(await run(runtime().disposition(session, formID, identity, target)), {
    status: "answered",
    answer: { action: "defer", paths: [] },
  });
  await assert.rejects(
    run(
      runtime().requestDisposition(session, formID, "Changed", identity, {
        ...target,
        fingerprint: Id.Fingerprint.make("different"),
      }),
    ),
    { code: "DECISION_FORM" },
  );
  retained!.metadata.decision_identity = "other";
  await assert.rejects(run(runtime().disposition(session, formID, identity, target)), {
    code: "DECISION_FORM",
  });
});

test("synchronization retains one admission after lost staging response and consumes two attempts across changed input", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  let e = await run(delivered(f));
  const sourceSession = e.apply_session_id!;
  const p = (await run(f.records.project(e.repository_id)))!;
  const original = { plan: e.plan_fingerprint!, archive: e.archive_path!, tree: e.archived_tree! };
  const observe = () => run(observePublication(f.git, f.delivery, p, e));
  const edit = async (value: string) => {
    await writeFile(join(e.worktree_directory!, "source.txt"), value);
    const observed = await observe();
    e.finishing = {
      ...e.finishing,
      schema_version: 1,
      attribution: {
        schema_version: 1,
        generation: e.control_generation,
        head: observed.head,
        fingerprint: observed.content,
        session_id: sourceSession,
        prompt_id: Id.MessageId.make("msg_apply"),
        at: Id.timestampAt(0),
      },
    };
    await run(f.records.save(e));
    return observed;
  };
  const input = await edit("sample first revision\n");
  const gitRun = f.git.run.bind(f.git);
  let lost = false;
  f.git.run = (root, args, options) =>
    gitRun(root, args, options).pipe(
      Effect.flatMap((value) => {
        if (!lost && args.join(" ") === "add --all") {
          lost = true;
          return Effect.fail(new CrewError("RESPONSE_LOST", "Index staging response lost"));
        }
        return Effect.succeed(value);
      }),
    );
  await assert.rejects(run(admitSynchronization(f.git, f.records, e, input)), /response lost/);
  assert.equal(e.finishing!.synchronization!.length, 1);
  assert.equal(e.finishing!.synchronization![0].stage, "admitted");
  f.git.run = gitRun;
  e = (await run(f.records.execution(e.issue_id)))!;
  await run(admitSynchronization(f.git, f.records, e, await observe()));
  assert.equal(e.finishing!.synchronization!.length, 1);
  const finishAttempt = async () => {
    e.finishing = {
      ...e.finishing,
      schema_version: 1,
      synchronization: e.finishing!.synchronization!.map((a) => ({
        ...a,
        stage: "published",
        intended_commit: e.delivered_commit!,
      })),
    };
    e.plan_fingerprint = original.plan;
    e.archive_path = original.archive;
    e.archived_tree = original.tree;
    e.current_phase = "awaiting_merge";
    await run(f.records.save(e));
    e = (await run(f.records.execution(e.issue_id)))!;
  };
  await finishAttempt();
  await run(admitSynchronization(f.git, f.records, e, await edit("sample second revision\n")));
  assert.equal(e.finishing!.synchronization!.length, 2);
  await finishAttempt();
  const third = await edit("sample third revision\n");
  await assert.rejects(run(admitSynchronization(f.git, f.records, e, third)), {
    code: "SYNCHRONIZATION_ALLOWANCE",
  });
  assert.equal(e.finishing!.synchronization!.length, 2);
  assert.equal(e.effective_policy.repair_rounds, 0);
  e = (await run(f.controller.reconcile(e.issue_id)))[0];
  const allowance = e.decisions!.find(
    (d) => d.status === "open" && d.finishing_target?.kind === "additional_attempt",
  )!;
  assert.ok(allowance.form_id);
  f.runtime.dispositions.set(allowance.form_id!, {
    status: "answered",
    answer: { action: "authorize", paths: [] },
  });
  await Promise.all([
    run(f.controller.reconcile(e.issue_id)),
    run(f.controller.reconcile(e.issue_id)),
  ]);
  e = await run(f.controller.get(e.issue_id));
  assert.equal(e.finishing!.synchronization!.length, 3);
  assert.equal(e.finishing!.synchronization![2].additional_authorization, allowance.key);
  assert.equal(e.active_role, "explore");
  assert.equal(e.apply_session_id, undefined);
});

test("lost native retirement response confirms absence once and notification failure never reopens the graph", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  let e = await run(delivered(f));
  f.delivery.merged = true;
  f.delivery.pr!.state = "MERGED";
  const remove = f.runtime.removeWorktree.bind(f.runtime);
  let submissions = 0;
  f.runtime.removeWorktree = (...args) => {
    submissions++;
    return remove(...args).pipe(
      Effect.andThen(
        Effect.fail(new CrewError("RESPONSE_LOST", "Native retirement response lost")),
      ),
    );
  };
  f.runtime.notify = () =>
    Effect.fail(new CrewError("NOTICE_UNAVAILABLE", "Native notification unavailable"));
  e = (await run(f.controller.reconcile(e.issue_id)))[0];
  assert.equal(e.current_phase, "recovery_required");
  assert.equal(e.retirement!.native, "requested");
  e = (await run(f.controller.reconcile(e.issue_id)))[0];
  assert.equal(e.current_phase, "completed");
  assert.equal(submissions, 1);
  assert.equal((await run(f.work.show(e.issue_id))).status, "closed");
  assert.equal(e.finishing!.completion_notice!.status, "pending");
  const message = e.finishing!.completion_notice!.message_id;
  e.finishing = {
    ...e.finishing,
    schema_version: 1,
    completion_notice: { ...e.finishing!.completion_notice!, next_check_at: 0 },
  };
  await run(f.records.save(e));
  f.runtime.notify = () => Effect.void;
  e = (await run(f.controller.reconcile(e.issue_id)))[0];
  assert.equal(e.finishing!.completion_notice!.status, "delivered");
  assert.equal(e.finishing!.completion_notice!.message_id, message);
  assert.equal(submissions, 1);
});
