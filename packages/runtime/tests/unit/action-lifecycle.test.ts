import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { Effect, Schema } from "effect";
import { deliveredPR, noEffect } from "../helpers/delivered-pr.ts";
import { run } from "../effects.ts";
import * as Id from "../../src/identities.ts";
import { CrewError } from "../../src/domain.ts";
import { ActionSchema, CurrentActionSchema } from "../../src/workflow/action-contracts.ts";
import { normalizeAction, targetKey } from "../../src/workflow/action-state.ts";
import { PRActions } from "../../src/workflow/pr-actions.ts";
import { GitHubPRActions } from "../../src/git/pr-actions.ts";
import { Forge } from "../../src/git/forge.ts";
import { type Delivery } from "../../src/git/delivery.ts";

test("two job findings reserve and submit one workflow attempt across restart and control generations", async (t) => {
  const { f, e, p } = await deliveredPR(t, {
    ci_retry: { max_reruns: 2, workflows: [".github/workflows/ci.yml"] },
  });
  const findings = [1, 2].map((n) => ({
    id: Id.FindingId.make(`job-${n}`),
    source_id: `job-${n}`,
    revision: "failed-1",
    head: e.delivered_commit!,
    kind: "check" as const,
    text: "Runner unavailable",
    blocking: true,
    run_id: 7,
    run_attempt: 1,
    workflow: ".github/workflows/ci.yml",
    disposition: {
      status: "transient" as const,
      head: e.delivered_commit!,
      at: 1,
      actor: "controller",
      reason: "Runner outage",
    },
  }));
  e.feedback = { ...e.feedback!, findings };
  await run(f.records.save(e));
  let posts = 0;
  const adapter = new GitHubPRActions(
    new Forge(
      {
        run: (_file, args) => {
          if (args.includes("POST")) {
            posts++;
            return Effect.succeed("");
          }
          if (args[1] === "repos/{owner}/{repo}")
            return Effect.succeed(
              JSON.stringify({
                full_name: "fixture/api",
                html_url: p.remote,
                allow_merge_commit: true,
                allow_squash_merge: true,
                allow_rebase_merge: true,
              }),
            );
          return Effect.succeed(
            JSON.stringify({
              id: 7,
              head_sha: e.delivered_commit,
              run_attempt: 1,
              path: ".github/workflows/ci.yml",
              status: "completed",
              conclusion: "failure",
            }),
          );
        },
      },
      Id.Executable.make("fake-forge"),
    ),
    () => Effect.succeed(f.delivery.pr),
  );
  const delivery: Delivery = {
    deliver: f.delivery.deliver,
    inspect: () => Effect.succeed(f.delivery.pr),
    merge: f.delivery.merge.bind(f.delivery),
    evidence: f.delivery.evidence.bind(f.delivery),
    actions: adapter,
  };
  const actions = new PRActions(f.records, delivery, f.runtime);
  const input = {
    issue_id: e.issue_id,
    generation: e.control_generation,
    expected_head: e.delivered_commit!,
    kind: "rerun" as const,
    finding_id: findings[0].id,
  };
  await run(actions.run(e, p, input, undefined, true));
  assert.equal(posts, 1);
  assert.equal(e.feedback!.actions.length, 1);
  const original = normalizeAction(e.feedback!.actions[0], e);
  assert.equal(original.kind, "rerun");
  if (original.kind === "rerun") assert.equal(original.findings.length, 2);
  await run(actions.run(e, p, { ...input, finding_id: findings[1].id }, undefined, true));
  assert.equal(posts, 1, "A second job must not issue another run-level POST");
  const restored = (await run(f.records.execution(e.issue_id)))!;
  await run(f.records.saveControl(restored));
  await run(
    new PRActions(f.records, delivery, f.runtime).run(
      restored,
      p,
      { ...input, generation: restored.control_generation, finding_id: findings[1].id },
      undefined,
      true,
    ),
  );
  assert.equal(posts, 1, JSON.stringify(restored.feedback!.actions));
  assert.equal(restored.feedback!.actions[0].id, original.id);
  assert.equal(restored.feedback!.actions.length, 1);
  const other = { ...findings[0], id: Id.FindingId.make("other-run"), run_id: 8 };
  restored.feedback = { ...restored.feedback!, findings: [...findings, other] };
  const independent = actions.prepare(
    restored,
    { ...input, generation: restored.control_generation, finding_id: other.id },
    true,
    3,
  );
  assert.notEqual(targetKey(independent), targetKey(original));
  assert.throws(() =>
    Schema.decodeUnknownSync(CurrentActionSchema)({ ...original, target: { users: [] } }),
  );
});

test("approved permission preflight failure retries once without fabricating send uncertainty", async (t) => {
  const { f, e, p } = await deliveredPR(t);
  let unavailable = true,
    posts = 0;
  const adapter = new GitHubPRActions(
    new Forge(
      {
        run: (_file, args) => {
          const endpoint = args[1];
          if (args.includes("POST")) {
            posts++;
            return Effect.succeed(
              JSON.stringify({ requested_reviewers: [{ login: "alice" }], requested_teams: [] }),
            );
          }
          if (endpoint === "repos/{owner}/{repo}")
            return Effect.succeed(
              JSON.stringify({
                full_name: "fixture/api",
                html_url: p.remote,
                allow_merge_commit: true,
                allow_squash_merge: true,
                allow_rebase_merge: true,
              }),
            );
          if (endpoint.endsWith("/requested_reviewers"))
            return Effect.succeed('{"users":[],"teams":[]}');
          if (endpoint.includes("/reviews?")) return Effect.succeed("[[]]");
          if (endpoint.includes("/permission"))
            return unavailable
              ? Effect.fail(new CrewError("COMMAND_FAILED", "Permission read unavailable"))
              : Effect.succeed('{"permission":"write"}');
          return Effect.succeed(
            JSON.stringify({
              user: { login: "author" },
              head: { sha: e.delivered_commit },
              base: { ref: e.target_branch },
            }),
          );
        },
      },
      Id.Executable.make("fake-forge"),
    ),
    () => Effect.succeed(f.delivery.pr),
  );
  const delivery: Delivery = {
    deliver: f.delivery.deliver,
    inspect: () => Effect.succeed(f.delivery.pr),
    merge: f.delivery.merge.bind(f.delivery),
    evidence: f.delivery.evidence.bind(f.delivery),
    actions: adapter,
  };
  const actions = new PRActions(f.records, delivery, f.runtime);
  const actor = Id.SessionId.make("ses_supervisor");
  const input = {
    issue_id: e.issue_id,
    generation: e.control_generation,
    expected_head: e.delivered_commit!,
    kind: "reviewers" as const,
    users: ["alice"],
  };
  await run(actions.run(e, p, input, actor));
  const form = e.feedback!.actions[0].form_id!;
  f.runtime.forms.set(form, "approved");
  await run(actions.run(e, p, input, actor));
  assert.equal(posts, 0);
  const prepared = normalizeAction(e.feedback!.actions[0], e);
  assert.equal(prepared.submission.stage, "unsubmitted");
  assert.equal(prepared.preflight?.retryable, true);
  assert.equal(prepared.status, "prepared");
  unavailable = false;
  const restored = (await run(f.records.execution(e.issue_id)))!;
  await run(actions.run(restored, p, input, actor));
  assert.equal(posts, 1, JSON.stringify(restored.feedback!.actions));
  assert.equal(restored.feedback!.actions[0].status, "confirmed");
  assert.equal(restored.feedback!.actions[0].form_id, form);
  assert.equal(restored.feedback!.actions[0].id, prepared.id);
  assert.equal(restored.feedback!.actions.length, 1);
});

test("legacy permission errors stay uncertain and old identity and evidence survive normalization", async (t) => {
  const { f, e, p } = await deliveredPR(t);
  const legacy = {
    schema_version: 1 as const,
    id: "old-request",
    generation: 0,
    head: e.delivered_commit!,
    kind: "reviewers" as const,
    status: "uncertain" as const,
    created_at: 1,
    updated_at: 2,
    authority: "manual",
    users: ["alice"],
    teams: [],
    result: "Permission read unavailable",
    form_id: Id.FormId.make("frm_old"),
    session_id: Id.SessionId.make("ses_supervisor"),
    authorized_at: 1,
  };
  e.feedback = { ...e.feedback!, actions: [legacy, { ...legacy, id: "old-duplicate" }] };
  await run(f.records.save(e));
  let observations = 0;
  const delivery: Delivery = {
    deliver: f.delivery.deliver,
    inspect: () => Effect.succeed(f.delivery.pr),
    merge: f.delivery.merge.bind(f.delivery),
    evidence: f.delivery.evidence.bind(f.delivery),
    actions: {
      prepare: noEffect,
      submit: noEffect,
      reconcile: () => {
        observations++;
        return Effect.succeed({ kind: "awaiting", detail: "No source receipt yet" });
      },
    },
  };
  await run(
    new PRActions(f.records, delivery, f.runtime).run(e, p, {
      issue_id: e.issue_id,
      generation: 0,
      expected_head: e.delivered_commit!,
      kind: "reviewers",
      action_id: legacy.id,
    }),
  );
  const action = normalizeAction(
    e.feedback!.actions[0].id === legacy.id ? e.feedback!.actions[0] : e.feedback!.actions[1],
    e,
  );
  assert.equal(observations, 1);
  assert.equal(action.submission.stage, "admitted");
  assert.equal(action.status, "uncertain");
  assert.deepEqual(action.legacy, legacy);
  assert.equal(action.form_id, legacy.form_id);
  assert.equal(
    e.feedback!.actions.length,
    2,
    "Historical reservations are never silently collapsed",
  );
  assert.throws(() => Schema.decodeUnknownSync(ActionSchema)({ ...legacy, schema_version: 99 }));
  assert.throws(
    () =>
      normalizeAction(
        {
          ...legacy,
          kind: "reply",
          finding: Id.FindingId.make("old-source"),
          revision: "r1",
          body: undefined,
        },
        e,
      ),
    /incomplete/,
  );
});

test("pause between preparation and admission prevents any write", async (t) => {
  const { f, e, p } = await deliveredPR(t, {
    reviewers: {
      users: ["alice"],
      teams: [],
      request: "on-ready",
      rerequest_after_correction: false,
    },
  });
  const delivery: Delivery = {
    deliver: f.delivery.deliver,
    inspect: () => Effect.succeed(f.delivery.pr),
    merge: f.delivery.merge.bind(f.delivery),
    evidence: f.delivery.evidence.bind(f.delivery),
    actions: {
      prepare: (_p, _e, action) =>
        Effect.gen(function* () {
          const paused = (yield* f.records.execution(e.issue_id))!;
          paused.stop_status = "confirmed";
          paused.resume_phase = "awaiting_merge";
          paused.current_phase = "interrupted";
          yield* f.records.saveControl(paused);
          return {
            kind: "write" as const,
            write: {
              action,
              command: {
                kind: "reviewers" as const,
                endpoint: "fixture",
                users: ["alice"],
                teams: [],
              },
            },
          };
        }),
      submit: noEffect,
      reconcile: noEffect,
    },
  };
  await assert.rejects(
    run(
      new PRActions(f.records, delivery, f.runtime).run(
        e,
        p,
        {
          issue_id: e.issue_id,
          generation: 0,
          expected_head: e.delivered_commit!,
          kind: "reviewers",
        },
        undefined,
        true,
      ),
    ),
    /superseded/,
  );
  const paused = (await run(f.records.execution(e.issue_id)))!;
  assert.equal(
    normalizeAction(paused.feedback!.actions[0], paused).submission.stage,
    "unsubmitted",
  );
});

test("permanent preparation denial remains unsubmitted and automatic polling does not spin", async (t) => {
  const { f, e, p } = await deliveredPR(t, {
    reviewers: {
      users: ["alice"],
      teams: [],
      request: "on-ready",
      rerequest_after_correction: false,
    },
  });
  let reads = 0;
  const delivery: Delivery = {
    deliver: f.delivery.deliver,
    inspect: f.delivery.inspect.bind(f.delivery),
    merge: f.delivery.merge.bind(f.delivery),
    evidence: f.delivery.evidence.bind(f.delivery),
    actions: {
      prepare: () => {
        reads++;
        return Effect.fail(new CrewError("REVIEWER_PERMISSION", "Reviewer lacks write access"));
      },
      submit: noEffect,
      reconcile: noEffect,
    },
  };
  const service = new PRActions(f.records, delivery, f.runtime);
  await run(service.automatic(e, p));
  await run(service.automatic(e, p));
  assert.equal(reads, 1);
  const action = normalizeAction(e.feedback!.actions[0], e);
  assert.equal(action.submission.stage, "unsubmitted");
  assert.equal(action.preflight?.retryable, false);
});
