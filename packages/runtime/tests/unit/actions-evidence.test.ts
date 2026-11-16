import { normalizeAction } from "../../src/workflow/action-state.ts";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { Effect } from "effect";
import { fixture } from "../fixtures.ts";
import { run } from "../effects.ts";
import { Forge } from "../../src/git/forge.ts";
import { actionsEvidence } from "../../src/git/actions.ts";
import { GitHubPRActions } from "../../src/git/pr-actions.ts";
import { CrewError } from "../../src/domain.ts";
import * as Id from "../../src/identities.ts";

for (const mode of ["available", "logs-unavailable", "incomplete-jobs", "foreign-head"] as const)
  test(`Actions evidence ${mode} preserves bounded, independent failure detail`, async (t) => {
    const f = await run(fixture);
    t.onTestFinished(() => run(f.close()));
    const p = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
    const head = Id.Commit.make("a".repeat(40));
    const calls: { args: string[]; limit?: number }[] = [];
    const forge = new Forge(
      {
        run: (_file, args, _cwd, _env, options) => {
          calls.push({ args, limit: options?.max_output_bytes });
          if (args[0] === "run")
            return mode === "logs-unavailable"
              ? Effect.fail(new CrewError("COMMAND_FAILED", "Logs permission unavailable"))
              : Effect.succeed("Run checks\tAssertion failed: missing invariant\n");
          if (args[1].includes("/jobs?"))
            return Effect.succeed(
              JSON.stringify([
                {
                  total_count: mode === "incomplete-jobs" ? 2 : 1,
                  jobs: [
                    {
                      id: 70,
                      run_id: 7,
                      name: "CI",
                      status: "completed",
                      conclusion: "failure",
                      steps: [{ name: "Test", conclusion: "failure" }],
                    },
                  ],
                },
              ]),
            );
          return Effect.succeed(
            JSON.stringify({
              id: 7,
              head_sha: mode === "foreign-head" ? "b".repeat(40) : head,
              run_attempt: 2,
              path: ".github/workflows/ci.yml",
              status: "completed",
              conclusion: "failure",
            }),
          );
        },
      },
      Id.Executable.make("fixture-forge"),
    );
    const evidence = await run(
      actionsEvidence(
        forge,
        p,
        "fixture/api",
        "https://example.invalid/fixture/api/actions/runs/7/job/70",
        head,
      ),
    );
    if (mode === "foreign-head") {
      assert.ok(evidence.evidence_unavailable);
      assert.equal("run_id" in evidence, false);
      return;
    }
    assert.equal("run_id" in evidence && evidence.run_id, 7);
    assert.equal("run_attempt" in evidence && evidence.run_attempt, 2);
    if (mode === "available") {
      assert.match("logs" in evidence ? (evidence.logs ?? "") : "", /missing invariant/);
      assert.equal(evidence.evidence_unavailable, undefined);
      const detail = calls.find((c) => c.args[0] === "run")!;
      assert.ok(detail.args.includes("--attempt"));
      assert.equal(detail.limit, 32768);
      assert.equal(detail.args.includes("--debug"), false);
    } else assert.ok(evidence.evidence_unavailable);
    assert.equal(
      calls.some((c) => c.args.includes("POST")),
      false,
    );
  });

test("a rerun refuses an older attempt or changed workflow before sending", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const { delivered } = await import("../fixtures.ts");
  const e = await run(delivered(f)),
    p = (await run(f.records.project(e.repository_id)))!;
  let attempt = 1,
    path = ".github/workflows/ci.yml",
    posts = 0;
  const forge = new Forge(
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
            run_attempt: attempt,
            path,
            status: "completed",
            conclusion: "failure",
          }),
        );
      },
    },
    Id.Executable.make("fixture-forge"),
  );
  const action = {
    schema_version: 1 as const,
    id: "rerun-7",
    generation: e.control_generation,
    head: e.delivered_commit!,
    kind: "rerun" as const,
    status: "running" as const,
    created_at: 1,
    updated_at: 2,
    authority: "execution-policy",
    finding: Id.FindingId.make("failure"),
    revision: "attempt-2",
    run_id: 7,
    run_attempt: 2,
    workflow: ".github/workflows/ci.yml",
  };
  const actions = new GitHubPRActions(forge, () => Effect.succeed(f.delivery.pr));
  await assert.rejects(
    run(actions.prepare(p, e, normalizeAction(action, e))),
    /completed failed attempt/,
  );
  attempt = 2;
  path = ".github/workflows/foreign.yml";
  await assert.rejects(run(actions.prepare(p, e, normalizeAction(action, e))), /head\/workflow/);
  assert.equal(posts, 0);
});

test("legacy inline reply marker reconciles its original parent without a new post", async (t) => {
  const { deliveredPR } = await import("../helpers/delivered-pr.ts");
  const { f, e, p } = await deliveredPR(t);
  const legacy = {
    schema_version: 1 as const,
    id: "original-inline-reply",
    generation: 0,
    head: e.delivered_commit!,
    kind: "reply" as const,
    status: "uncertain" as const,
    created_at: 1,
    updated_at: 2,
    authority: "execution-policy",
    finding: Id.FindingId.make("old-source"),
    revision: "r1",
    thread_id: "thread-7",
    comment_id: 7,
    body: "Exact verified correction",
  };
  const calls: string[][] = [];
  const adapter = new GitHubPRActions(
    new Forge(
      {
        run: (_file, args) => {
          calls.push(args);
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
          if (args[1] === "user") return Effect.succeed('{"login":"abra-bot"}');
          if (args[1].includes("/comments?"))
            return Effect.succeed(
              JSON.stringify([
                [
                  {
                    body: `${legacy.body}\n\n<!-- abracode-action:${legacy.id} -->`,
                    user: { login: "abra-bot" },
                    html_url: `${e.pull_request_reference}#discussion_r8`,
                    in_reply_to_id: 7,
                  },
                ],
              ]),
            );
          return Effect.die(new Error(`Unexpected remote command ${args[1]}`));
        },
      },
      Id.Executable.make("fake-forge"),
    ),
    () => Effect.succeed(f.delivery.pr),
  );
  const normalized = normalizeAction(legacy, e);
  const outcome = await run(adapter.reconcile(p, e, normalized));
  assert.equal(outcome.kind, "confirmed");
  assert.equal(normalized.id, legacy.id);
  assert.equal(
    calls.some((args) => args.includes("POST")),
    false,
  );
});
