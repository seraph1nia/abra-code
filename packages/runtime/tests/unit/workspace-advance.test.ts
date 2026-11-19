import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { advanceAfterIdle, NativeWorkspaceCommandError } from "../helpers/workspace-advance.ts";

const before = {
  execution: {
    execution_id: "execution",
    control_generation: 0,
    current_phase: "planning",
    prompt_id: "explore-prompt",
    explore_session_id: "explore",
  },
  sessions: [{ id: "explore", busy: false, executing: false, outcome: "succeeded" }],
};
const after = {
  execution: {
    ...before.execution,
    current_phase: "applying",
    active_role: "apply",
    prompt_id: "apply-prompt",
    apply_session_id: "apply",
  },
  sessions: [...before.sessions, { id: "apply", busy: true, executing: true }],
};
const busy = () =>
  new NativeWorkspaceCommandError(
    "abra_work_control",
    "WRITER_BUSY: A managed session still runs in this worktree",
  );

test("browser explicit advance reobserves a stale idle race without another admission", async () => {
  let advances = 0;
  let reads = 0;
  const contexts: string[] = [];
  const result = await advanceAfterIdle({
    before,
    advance: async () => {
      advances++;
      throw busy();
    },
    readStatus: async () => {
      reads++;
      return after;
    },
    context: async (session) => {
      contexts.push(session);
      return [{ id: `${session}-prompt`, type: "user" }];
    },
  });
  assert.equal(advances, 1);
  assert.equal(reads, 1);
  assert.deepEqual(contexts, ["explore", "apply"]);
  assert.equal(result?.current_assignment_admissions, 1);
  assert.equal(result?.after.prompt_id, "apply-prompt");
});

for (const error of [
  new Error("WRITER_BUSY: A managed session still runs in this worktree"),
  new NativeWorkspaceCommandError("abra_work_approve", busy().nativeMessage),
  new NativeWorkspaceCommandError("abra_work_control", "SESSION_OUTCOME: Unknown"),
  new NativeWorkspaceCommandError("abra_work_control", "WRITER_BUSY: Unexpected refusal"),
])
  test(`browser advance keeps unexpected errors visible: ${error.message}`, async () => {
    await assert.rejects(
      advanceAfterIdle({
        before,
        advance: async () => {
          throw error;
        },
        readStatus: async () => {
          assert.fail("Unexpected errors must not be classified as an advance race");
        },
        context: async () => [],
      }),
      (observed) => observed === error,
    );
  });

for (const [name, status, copies] of [
  [
    "phase revocation",
    { ...after, execution: { ...after.execution, current_phase: "blocked" } },
    1,
  ],
  ["generation change", { ...after, execution: { ...after.execution, control_generation: 1 } }, 1],
  ["no fresh activity or progress", before, 1],
  ["duplicate native session", { ...after, sessions: [...after.sessions, after.sessions[1]!] }, 1],
  ["duplicate admission", after, 2],
  ["missing admission", after, 0],
] as const)
  test(`browser advance refuses ${name} after WRITER_BUSY`, async () => {
    await assert.rejects(
      advanceAfterIdle({
        before,
        advance: async () => {
          throw busy();
        },
        readStatus: async () => status,
        context: async (session) =>
          session === "apply"
            ? Array.from({ length: copies }, () => ({ type: "user", id: "apply-prompt" }))
            : [],
      }),
      assert.AssertionError,
    );
  });
