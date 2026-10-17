import * as Id from "../../src/identities.ts";
import { Effect, Exit } from "effect";
import { run } from "../effects.ts";
import { test, type TestContext } from "vite-plus/test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { symlink } from "node:fs/promises";
import { type Context } from "@opencode/plugin/effect/plugin";
import { fixture } from "../fixtures.ts";
import { installGuards } from "../../src/opencode/guards.ts";
async function guard(t: TestContext) {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  f.work.add(Id.IssueId.make("abra-1"));
  const e = await run(
    f.controller.start(Id.IssueId.make("abra-1"), Id.SessionId.make("ses_supervisor")),
  );
  let before: (event: any) => import("effect").Effect.Effect<void>;
  const ctx = {
    session: { hook: () => Effect.void },
    shell: { hook: () => Effect.void },
    tool: {
      hook: (_name: string, fn: typeof before) =>
        Effect.sync(() => {
          before = fn;
        }),
    },
  } as unknown as Context;
  await run(installGuards(ctx, f.controller));
  return {
    f,
    e,
    invoke: (tool: string) => before!({ tool, sessionID: e.explore_session_id, input: {} }),
    check: (patchText: string) =>
      before!({ tool: "patch", sessionID: e.explore_session_id, input: { patchText } }),
  };
}
test("native patch validates every file and move destination inside the Explore change", async (t) => {
  const { e, check } = await guard(t);
  const denied = await run(Effect.exit(check("invalid patch")));
  assert.ok(Exit.isFailure(denied));
  assert.deepEqual(
    denied.cause.reasons.map((reason) => reason._tag),
    ["Fail"],
  );
  const base = `openspec/changes/${e.openspec_change}`;
  await run(
    check(
      `*** Begin Patch\n*** Add File: ${base}/new.md\n+Planning\n*** Update File: ${base}/design.md\n*** Move to: ${base}/renamed.md\n@@\n-## Design\n+## New design\n*** End Patch`,
    ),
  );
  await assert.rejects(
    run(
      check(
        `*** Begin Patch\n*** Add File: ${base}/valid.md\n+Planning\n*** Add File: source.txt\n+Forbidden\n*** End Patch`,
      ),
    ),
    /assigned write root/,
  );
  await assert.rejects(
    run(
      check(
        `*** Begin Patch\n*** Update File: ${base}/design.md\n*** Move to: source.txt\n@@\n-## Design\n+Forbidden\n*** End Patch`,
      ),
    ),
    /assigned write root/,
  );
});
test("native patch rejects symlink escapes, orchestration files and malformed input", async (t) => {
  const { f, e, check } = await guard(t);
  const base = `openspec/changes/${e.openspec_change}`;
  await symlink(f.root, join(e.worktree_directory!, base, "escape"));
  await assert.rejects(
    run(
      check(`*** Begin Patch\n*** Add File: ${base}/escape/outside.txt\n+Forbidden\n*** End Patch`),
    ),
    /symlinks/,
  );
  await assert.rejects(
    run(check(`*** Begin Patch\n*** Add File: ${base}/AGENTS.md\n+Forbidden\n*** End Patch`)),
    /orchestration/,
  );
  await assert.rejects(run(check("*** Begin Patch\n*** End Patch")), /empty/);
  await assert.rejects(run(check("invalid patch")), /Invalid/);
});

test("execution checks reject forbidden management and inactive assigned sessions", async (t) => {
  const { f, e, invoke } = await guard(t);
  await assert.rejects(run(invoke("abra_work_finish")), /cannot use/);
  await run(f.records.update(e.issue_id, (current) => ({ ...current, active_role: undefined })));
  await assert.rejects(run(invoke("read")), /no longer owns/);
});
