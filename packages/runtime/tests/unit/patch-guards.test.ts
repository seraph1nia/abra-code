import * as Id from "@abracode/contracts/identities";
import { Effect, Exit } from "effect";
import { run } from "../effects.ts";
import { test, vi, type TestContext } from "vite-plus/test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { type Context } from "@opencode/plugin/effect/plugin";
import { applying, fixture } from "../fixtures.ts";
import { installGuards } from "../../src/opencode/guards.ts";
async function guard(t: TestContext, role: "explore" | "apply" | "review" = "explore") {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  f.seed.named(Id.IssueId.make("abra-1"));
  const e = await run(
    role === "review"
      ? Effect.gen(function* () {
          const applyingIssue = yield* applying(f);
          f.spec.done = true;
          f.runtime.success(applyingIssue.apply_session_id!);
          return yield* f.controller.advance(applyingIssue.issue_id);
        })
      : role === "apply"
        ? applying(f)
        : f.controller.start(Id.IssueId.make("abra-1"), Id.SessionId.make("ses_supervisor")),
  );
  const sessionID = e[`${role}_session_id`];
  let before: (event: any) => import("effect").Effect.Effect<void>;
  let context: typeof before;
  let shell: typeof before;
  let permission: typeof before;
  const ctx = {
    session: {
      hook: (name: string, handler: typeof before) =>
        Effect.sync(() => {
          if (name === "context") context = handler;
        }),
    },
    permission: {
      hook: (_name: string, handler: typeof before) =>
        Effect.sync(() => {
          permission = handler;
        }),
    },
    shell: {
      hook: (_name: string, fn: typeof before) =>
        Effect.sync(() => {
          shell = fn;
        }),
    },
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
    shell: (cwd: string) => shell({ cwd, env: {} }),
    permission: async (resources: string[]) => {
      const event = {
        sessionID,
        action: "edit",
        resources,
        effect: "ask",
        source: { type: "tool" },
      };
      await run(permission(event));
      return event.effect;
    },
    visible: async (names: string[]) => {
      const tools = Object.fromEntries(names.map((name) => [name, {}]));
      await run(context({ sessionID, model: f.config.models.default, tools, system: [] }));
      return Object.keys(tools);
    },
    invoke: (tool: string) => before!({ tool, sessionID, input: {} }),
    edit: (tool: "write" | "edit", filePath: string) =>
      before!({ tool, sessionID, input: { filePath } }),
    check: (patchText: string) => before!({ tool: "patch", sessionID, input: { patchText } }),
  };
}
test("native patch validates every file and move destination inside the Explore change", async (t) => {
  const { e, check, permission } = await guard(t);
  assert.equal(await permission([`openspec/changes/${e.openspec_change}/proposal.md`]), "ask");
  assert.equal(await permission([".git/config"]), "deny");
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

test("native edits enforce role policy on the requested and resolved path", async (t) => {
  const { e, edit } = await guard(t);
  const base = join(e.worktree_directory!, "openspec/changes", e.openspec_change);
  for (const name of [".Git", ".OpenCode"]) {
    await mkdir(join(base, name));
    await symlink(join(base, name), join(base, name + "-alias"));
    await assert.rejects(run(edit("write", join(base, name + "-alias", "new"))), /orchestration/);
  }
  await writeFile(join(base, "Agents.MD"), "");
  await symlink(join(base, "Agents.MD"), join(base, "guide"));
  await assert.rejects(run(edit("edit", join(base, "guide"))), /orchestration/);
  await symlink(join(base, "missing"), join(base, "dangling"));
  await assert.rejects(run(edit("write", join(base, "dangling"))), /symlink/);
});

test("shell skips a missing external worktree and still enforces live custody", async (t) => {
  const { f, e, shell } = await guard(t);
  vi.spyOn(f.controller.queries, "externalWorktrees").mockReturnValue(
    Effect.succeed([Id.AbsolutePath.make(join(f.root, "missing")), e.worktree_directory!]),
  );
  await run(shell(f.root));
  await assert.rejects(run(shell(e.worktree_directory!)), /external branch custody/);
});

test("execution checks reject forbidden management and inactive assigned sessions", async (t) => {
  const { f, e, invoke } = await guard(t);
  await assert.rejects(run(invoke("abra_work_finish")), /cannot use/);
  await run(f.records.update(e.issue_id, (current) => ({ ...current, active_role: undefined })));
  await assert.rejects(run(invoke("read")), /no longer owns/);
});

test("Apply can edit repository instructions while control paths and worktree containment stay guarded", async (t) => {
  const { e, check, edit } = await guard(t, "apply");
  for (const path of ["AGENTS.md", "docs/AGENTS.md"]) {
    await run(check(`*** Begin Patch\n*** Add File: ${path}\n+Repository guidance\n*** End Patch`));
    await run(edit("write", path));
    await run(edit("edit", path));
  }
  for (const path of [".git", "docs/.git/config", ".opencode/agents/apply.md"])
    await assert.rejects(
      run(check(`*** Begin Patch\n*** Add File: ${path}\n+Forbidden\n*** End Patch`)),
      /orchestration/,
    );
  await assert.rejects(
    run(
      check(
        "*** Begin Patch\n*** Update File: AGENTS.md\n*** Move to: .opencode/AGENTS.md\n@@\n-Old\n+New\n*** End Patch",
      ),
    ),
    /orchestration/,
  );
  await assert.rejects(
    run(edit("write", join(e.worktree_directory!, "../AGENTS.md"))),
    /write root/,
  );
});

test("known worker hook and progress read only the selected execution among 100", async (t) => {
  const { f, e, invoke } = await guard(t);
  for (let i = 1; i < 100; i++)
    await run(
      f.records.create({
        ...e,
        issue_id: Id.IssueId.make(`other-${i}`),
        execution_id: Id.ExecutionId.make(`exec-${i}`),
        explore_session_id: Id.SessionId.make(`ses_other-${i}`),
        session_intent: undefined,
      }),
    );
  const entries = vi.spyOn(f.records.store, "entries");
  const get = vi.spyOn(f.records.store, "get");
  const executionReads = () => get.mock.calls.filter(([key]) => key.startsWith("execution/"));
  const executionScans = () => entries.mock.calls.filter(([prefix]) => prefix === "execution/");
  const ticket = Id.StorageKey.make(`execution/${e.issue_id}`);
  const native = vi.spyOn(f.runtime, "session");
  await run(invoke("read"));
  assert.deepEqual(executionReads(), [[ticket]]);
  get.mockClear();
  await run(f.controller.observeWorker(e.explore_session_id!));
  assert.deepEqual(executionReads(), [[ticket]]);
  assert.deepEqual(native.mock.calls, [[e.explore_session_id]]);
  assert.equal(executionScans().length, 0);
  assert.equal(await run(f.records.workerAssignment(Id.SessionId.make("ses_unknown"))), undefined);
  assert.equal(executionScans().length, 1);
});

test("model context and direct calls use the same captured Review tools", async (t) => {
  const { f, e, visible, invoke } = await guard(t, "review");
  const retained = await run(f.records.execution(e.issue_id));
  assert.ok(retained?.current_phase === "verifying");
  const base = e.configuration_snapshot!.definitions!.review!;
  const names = ["abra_review_changes", "inspect-source", "read"];
  vi.spyOn(f.controller, "recordWorkerTools").mockReturnValue(Effect.void);
  vi.spyOn(f.controller, "workerContextRequest").mockReturnValue(Effect.succeed("Captured"));
  for (const mode of ["current", "legacy", "deny-id", "deny-read", "inactive"]) {
    const profile = {
      ...base,
      permissions: [
        ...base.permissions.filter(
          (rule) => mode !== "legacy" || rule.action !== "abra_review_changes",
        ),
        ...(["deny-id", "deny-read"].includes(mode)
          ? [
              {
                effect: "deny" as const,
                resource: "*",
                action: mode === "deny-id" ? "inspect-source" : "read",
              },
            ]
          : []),
      ],
      contributions: [
        { id: "inspect-source", revision: "1", action: "read" as const, schema_digest: "fixture" },
      ],
    };
    vi.spyOn(f.controller.queries, "assignment").mockReturnValue(
      Effect.succeed({
        ...retained,
        active_role: mode === "inactive" ? undefined : "review",
        configuration_snapshot: {
          ...e.configuration_snapshot!,
          definitions: { ...e.configuration_snapshot!.definitions!, review: profile },
        },
      }),
    );
    const expected = names.filter(
      (name) =>
        mode !== "inactive" &&
        !(mode === "legacy" && name === names[0]) &&
        !(mode === "deny-id" && name === names[1]) &&
        !(mode === "deny-read" && name !== names[0]),
    );
    assert.deepEqual(await visible(names), expected);
    for (const name of names) {
      if (expected.includes(name)) await run(invoke(name));
      else await assert.rejects(run(invoke(name)), /cannot use|no longer owns/);
    }
  }
});
