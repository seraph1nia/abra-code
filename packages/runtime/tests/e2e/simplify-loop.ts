import assert from "node:assert/strict";
import { cp, mkdir, readFile, writeFile, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { repo } from "../fixtures.ts";
import { run } from "../effects.ts";
import { Git } from "../../src/git/repository.ts";
import { ProcessRunner } from "../../src/process.ts";
import { AbsolutePath, IssueId } from "../../src/identities.ts";

type Call = { name: string; args: any };
/** Deterministic native worker script; these cases measure contracts, not model judgment. */
export async function simplifyCalls(user: string, role: string, calls: Call[]) {
  if (!user.includes("simplify-loop:")) return;
  const round = Number(/Correction round (\d+)/.exec(user)?.[1] ?? 0);
  if (role === "explore" && user.includes("Retained schema: abra-compact-v1")) {
    for (let i = calls.length - 1; i >= 0; i--)
      if (calls[i]!.args.path?.endsWith("/design.md")) calls.splice(i, 1);
    if (user.includes("simplify-loop:skip")) {
      const proposal = calls.find((c) => c.args.path?.endsWith("/proposal.md"))!;
      proposal.args.content =
        "## Why\nClarify unchanged internal tooling.\n## What Changes\nSimplify fixture implementation.\n## Capabilities\n### New Capabilities\nNone.\n### Modified Capabilities\nNone.\n## Impact\nInternal tooling only.\n";
      for (let i = calls.length - 1; i >= 0; i--)
        if (calls[i]!.args.path?.includes("/specs/")) calls.splice(i, 1);
      const directory = /Worktree: ([^\n]+)/.exec(user)![1]!,
        change = /OpenSpec change: ([^. ]+)\./.exec(user)![1]!,
        path = `openspec/changes/${change}/.openspec.yaml`;
      calls.push({
        name: "write",
        args: {
          path,
          content:
            (await readFile(join(directory, path), "utf8"))
              .replace(/^skip_specs: true\s*$/gm, "")
              .trimEnd() + "\nskip_specs: true\n",
        },
      });
    }
  }
  if (role === "apply" && user.includes("simplify-loop:routine") && round === 0)
    calls.find((c) => c.args.path === "source.txt")!.args.content = "broken sample\n";
  if (role === "review") {
    const report = calls.find((c) => c.name === "abra_review_report")!.args;
    report.spec_verification.coherence.evidence = `Selected schema planning choices and source.txt agree; correction round ${round}.`;
    if (/simplify-loop:(repeated|exhausted|uncertain|scope-change)/.test(user)) {
      report.passed = false;
      report.findings = user.includes("simplify-loop:exhausted")
        ? `Distinct in-scope fixture defect ${round}`
        : "Retained fixture boundary needs clarification or correction";
      report.scope_status = user.includes("simplify-loop:uncertain")
        ? "uncertain"
        : user.includes("simplify-loop:scope-change")
          ? "scope_change"
          : "in_scope";
      report.spec_verification.correctness = { status: "failed", evidence: report.findings };
    }
  }
}

export async function simplifyLoopJourney(o: {
  root: string;
  home: string;
  forgeState: string;
  supervisor: string;
  client: any;
  invoke: (tool: string, args: any) => Promise<any>;
  eventually: <T>(action: () => Promise<T | undefined>, timeout?: number) => Promise<T>;
  restart: () => Promise<void>;
  observe: (value: unknown) => void;
}) {
  const git = new Git(new ProcessRunner());
  const path = AbsolutePath.make(await run(repo(o.root, "compact-routine")));
  await mkdir(join(path, "openspec/schemas"), { recursive: true });
  await cp(
    resolve("openspec/schemas/abra-compact-v1"),
    join(path, "openspec/schemas/abra-compact-v1"),
    { recursive: true },
  );
  await writeFile(join(path, "openspec/config.yaml"), "schema: abra-compact-v1\n");
  await run(git.commit(path, IssueId.make("compact-schema")));
  await run(git.run(path, ["push", "origin", "main"]));
  await writeFile(
    o.forgeState,
    JSON.stringify({ remote: `${path}.git`, check: "pass", counts: {}, merge_hold: true }),
  );
  await o.invoke("abra_project_onboard", {
    id: "compact-loop",
    path,
    action: "register",
    delivery: "github-pr",
    plan_approval: false,
    merge_approval: true,
    repair_rounds: 2,
    diagnostic_turns: 0,
    max_workers: 2,
    max_executions: 8,
    verification: [
      [
        process.execPath,
        "-e",
        'if(require("fs").readFileSync("source.txt","utf8")!=="sample\\n")process.exit(1)',
      ],
    ],
  });
  const create = async (kind: string, fields: Record<string, unknown> = {}) =>
    (
      await o.invoke("abra_work_create", {
        repository_id: "compact-loop",
        title: `Compact ${kind} contract`,
        request_id: `simplify-native-${kind}`,
        description: `simplify-loop:${kind} Preserve the sample behavior and selected planning contract.`,
        ...fields,
      })
    ).issue;
  const status = (id: string) => o.invoke("abra_work_status", { issue_id: id });
  const wait = (id: string, predicate: (s: any) => boolean) =>
    o.eventually(async () => {
      const s = await status(id);
      if (predicate(s)) return s;
      if (["failed", "recovery_required"].includes(s.execution.current_phase))
        throw Error(
          JSON.stringify({
            phase: s.execution.current_phase,
            error: s.execution.error_or_recovery_reason,
          }),
        );
      return undefined;
    }, 90000);
  const routine = await create("routine");
  await o.invoke("abra_work_start", { issue_id: routine.id });
  const finished = await wait(routine.id, (s) => s.execution.current_phase === "awaiting_merge"),
    e = finished.execution;
  assert.equal(e.openspec_schema_binding.name, "abra-compact-v1");
  assert.equal(e.openspec_schema_binding.source, "project");
  assert.equal(e.plan_approval_required, false);
  assert.equal(e.rounds.length, 1);
  assert.equal(e.rounds[0].source, "check");
  assert.equal(e.review_receipt.passed, true);
  assert.equal(e.review_receipt.fingerprint, e.verification_receipt.fingerprint);
  assert.notEqual(e.apply_session_id, e.explore_session_id);
  assert.notEqual(e.review_session_id, e.apply_session_id);
  assert.equal(
    e.approval_receipts.some((r: any) => r.kind === "plan"),
    false,
  );
  assert.deepEqual(finished.execution_contract.repair, {
    configured: 2,
    allowance: 2,
    consumed: 1,
    remaining: 1,
  });
  const archived = join(e.worktree_directory, e.archive_path),
    original = await readFile(join(archived, ".openspec.yaml"), "utf8");
  await assert.rejects(access(join(archived, "design.md")), /ENOENT/);
  const merge = await o.invoke("abra_work_approve", { issue_id: e.issue_id, kind: "merge" });
  assert.ok(merge.form_id);
  assert.equal((await status(e.issue_id)).execution.current_phase, "awaiting_merge");
  o.observe({
    compact_routine: {
      schema: e.openspec_schema_binding.name,
      plan_forms: 0,
      merge_form: merge.form_id,
      rounds: e.rounds.length,
      same_content: e.review_receipt.fingerprint,
      archived_without_design: true,
    },
  });

  const stronger = await create("stronger", {
    openspec_schema: "spec-driven",
    require_plan_approval: true,
  });
  await o.invoke("abra_work_start", { issue_id: stronger.id });
  const planned = await wait(
    stronger.id,
    (s) => s.execution.current_phase === "awaiting_plan_approval",
  );
  const plan = await o.invoke("abra_work_approve", { issue_id: stronger.id, kind: "plan" });
  assert.ok(plan.form_id);
  assert.equal(planned.execution_contract.plan_approval.source, "task_requirement");
  assert.equal(planned.execution.openspec_schema_binding.name, "spec-driven");
  assert.equal(planned.execution.apply_session_id, undefined);
  const dependent = await create("dependent", { dependencies: [stronger.id] });
  await o.restart();
  const restored = await status(stronger.id);
  assert.equal(restored.execution.current_phase, "awaiting_plan_approval");
  assert.equal(restored.execution.apply_session_id, undefined);
  assert.deepEqual(
    restored.execution.openspec_schema_binding,
    planned.execution.openspec_schema_binding,
  );
  assert.deepEqual(restored.execution.effective_policy, planned.execution.effective_policy);
  assert.equal(
    (await o.invoke("abra_work_approve", { issue_id: stronger.id, kind: "plan" })).form_id,
    plan.form_id,
  );
  assert.ok(
    (await o.client.session.form.list({ sessionID: o.supervisor })).some(
      (f: any) => f.id === plan.form_id,
    ),
  );
  assert.equal(
    (await o.invoke("abra_work_list", {})).executions.some((e: any) => e.issue_id === dependent.id),
    false,
  );
  assert.deepEqual(
    (await status(routine.id)).execution_contract.repair,
    finished.execution_contract.repair,
  );
  o.observe({
    stronger_plan: {
      schema: "spec-driven",
      form: plan.form_id,
      restored: true,
      dependent_blocked: true,
      apply_sessions: 0,
    },
  });

  // Keep the PR fixture single-owned; other cases stop before publication.
  for (const kind of ["repeated", "exhausted", "uncertain", "scope-change"] as const) {
    if (kind === "exhausted")
      await o.invoke("abra_project_onboard", {
        id: "compact-loop",
        action: "register",
        repair_rounds: 1,
      });
    const issue = await create(kind);
    await o.invoke("abra_work_start", { issue_id: issue.id });
    const blocked = await wait(
        issue.id,
        (s) =>
          s.execution.current_phase === "blocked" &&
          s.execution.decisions?.some((d: any) => d.status === "open"),
      ),
      rounds = blocked.execution.rounds?.length ?? 0,
      decision = blocked.execution.decisions.find((d: any) => d.status === "open");
    assert.equal(rounds, kind === "repeated" || kind === "exhausted" ? 1 : 0);
    assert.match(
      decision.question,
      kind === "repeated"
        ? /Repeated correction/
        : kind === "exhausted"
          ? /budget exhausted/
          : kind === "uncertain"
            ? /clarification/
            : /revised scope/,
    );
    assert.equal(blocked.execution.delivered_commit, undefined);
    const inbox = await o.client.session.inbox.list({
      sessionID: blocked.execution.apply_session_id,
    });
    if (kind === "uncertain") {
      await o.invoke("abra_work_control", { issue_id: issue.id, action: "pause" });
      await o.restart();
      const paused = await wait(issue.id, (s) => s.execution.stop_status === "confirmed");
      assert.equal(paused.execution.stop_status, "confirmed");
      assert.ok(
        paused.execution.decisions.some((d: any) => d.key === decision.key && d.status === "open"),
      );
      assert.equal(paused.execution.rounds?.length ?? 0, 0);
    }
    await o.invoke("abra_work_status", { issue_id: issue.id });
    assert.deepEqual(
      await o.client.session.inbox.list({ sessionID: blocked.execution.apply_session_id }),
      inbox,
    );
    assert.equal(await readFile(join(archived, ".openspec.yaml"), "utf8"), original);
    await access(blocked.execution.worktree_directory);
    o.observe({
      correction_stop: {
        kind,
        rounds,
        question: decision.question,
        no_delivery: true,
        no_replayed_inbox: true,
        previous_archive_preserved: true,
      },
    });
  }

  // A separate branch-preservation repository completes the valid native skip route.
  const skipPath = AbsolutePath.make(await run(repo(o.root, "compact-skip")));
  await cp(join(path, "openspec/schemas"), join(skipPath, "openspec/schemas"), { recursive: true });
  await writeFile(join(skipPath, "openspec/config.yaml"), "schema: abra-compact-v1\n");
  await run(git.commit(skipPath, IssueId.make("compact-skip-schema")));
  await run(git.run(skipPath, ["push", "origin", "main"]));
  await o.invoke("abra_project_onboard", {
    id: "compact-skip",
    path: skipPath,
    action: "register",
    delivery: "branch",
    plan_approval: false,
    repair_rounds: 0,
    verification: [
      [
        process.execPath,
        "-e",
        'if(require("fs").readFileSync("source.txt","utf8")!=="sample\\n")process.exit(1)',
      ],
    ],
  });
  const skipped = (
    await o.invoke("abra_work_create", {
      repository_id: "compact-skip",
      title: "Unchanged behavior",
      request_id: "simplify-native-skip",
      description:
        "simplify-loop:skip Simplify internal implementation without changing specification-level behavior.",
    })
  ).issue;
  await o.invoke("abra_work_start", { issue_id: skipped.id });
  const complete = await wait(skipped.id, (s) => s.execution.current_phase === "completed");
  assert.equal(complete.execution.openspec_schema_binding.name, "abra-compact-v1");
  const metadata = await run(
    git.run(AbsolutePath.make(`${skipPath}.git`), [
      "show",
      `${complete.execution.delivered_commit}:${complete.execution.archive_path}/.openspec.yaml`,
    ]),
  );
  assert.match(metadata, /skip_specs: true/);
  assert.equal(
    complete.execution.review_receipt.fingerprint,
    complete.execution.verification_receipt.fingerprint,
  );
  o.observe({
    compact_skip: {
      completed: true,
      native_skip_marker: true,
      schema: complete.execution.openspec_schema_binding.name,
      matching_review: true,
    },
  });
  return {
    simplify_loop: "pass",
    routine_merge_pending: true,
    stronger_plan_pending: true,
    scripted_contract_proof: true,
  };
}
