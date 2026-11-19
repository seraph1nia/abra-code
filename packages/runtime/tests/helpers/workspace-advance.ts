import assert from "node:assert/strict";

export class NativeWorkspaceCommandError extends Error {
  constructor(
    readonly tool: string,
    readonly nativeMessage: string,
  ) {
    super(`${tool}: ${nativeMessage}`);
  }
}

type AdvanceStatus = {
  execution: {
    execution_id: string;
    control_generation: number;
    current_phase: string;
    prompt_id?: string;
    active_role?: string;
    explore_session_id?: string;
    apply_session_id?: string;
    review_session_id?: string;
    research_session_id?: string;
  };
  sessions: readonly {
    id: string;
    busy?: boolean;
    executing?: boolean;
    completion_pending?: boolean;
    outcome?: string;
  }[];
};

function identity(status: AdvanceStatus) {
  const execution = status.execution;
  return {
    execution_id: execution.execution_id,
    control_generation: execution.control_generation,
    current_phase: execution.current_phase,
    prompt_id: execution.prompt_id,
    active_role: execution.active_role,
  };
}

/** Only the browser's redundant explicit advance may race normal reconciliation.
 * A refusal is not success: reobserve current native progress and admission. */
export async function advanceAfterIdle(input: {
  before: AdvanceStatus;
  advance: () => Promise<unknown>;
  readStatus: () => Promise<AdvanceStatus>;
  context: (session: string) => Promise<readonly { id: string; type: string }[]>;
}) {
  try {
    await input.advance();
    return;
  } catch (error) {
    if (
      !(error instanceof NativeWorkspaceCommandError) ||
      error.tool !== "abra_work_control" ||
      error.nativeMessage !== "WRITER_BUSY: A managed session still runs in this worktree"
    )
      throw error;
    const { before } = input;
    assert.ok(
      before.sessions.length > 0 &&
        before.sessions.every(
          (session) =>
            session.busy === false && session.executing !== true && session.outcome === "succeeded",
        ),
      "Only an advance based on a prior successful idle observation may be reobserved",
    );
    const after = await input.readStatus();
    assert.equal(after.execution.execution_id, before.execution.execution_id);
    assert.equal(after.execution.control_generation, before.execution.control_generation);
    assert.ok(
      !["blocked", "failed", "interrupted", "recovery_required"].includes(
        after.execution.current_phase,
      ),
      `Busy refusal must preserve valid progress: ${after.execution.current_phase}`,
    );
    assert.equal(new Set(after.sessions.map((session) => session.id)).size, after.sessions.length);
    for (const role of ["explore", "apply", "review", "research"] as const) {
      const key = `${role}_session_id` as const;
      if (before.execution[key]) assert.equal(after.execution[key], before.execution[key]);
      if (after.execution[key])
        assert.equal(
          after.sessions.filter((session) => session.id === after.execution[key]).length,
          1,
          "Every retained role must have exactly one native session observation",
        );
    }
    assert.ok(
      after.sessions.some(
        (session) => session.busy || session.executing || session.completion_pending,
      ) ||
        after.execution.prompt_id !== before.execution.prompt_id ||
        after.execution.current_phase !== before.execution.current_phase,
      "A busy refusal requires fresh native activity or forward lifecycle progress",
    );
    assert.ok(after.execution.prompt_id, "Current native assignment must remain retained");
    const contexts = await Promise.all(after.sessions.map((session) => input.context(session.id)));
    assert.equal(
      contexts
        .flat()
        .filter((message) => message.type === "user" && message.id === after.execution.prompt_id)
        .length,
      1,
      "Reobservation must find exactly one admission of the current assignment",
    );
    return {
      before: identity(before),
      after: identity(after),
      sessions: after.sessions.map(({ id, busy, executing, outcome }) => ({
        id,
        busy,
        executing,
        outcome,
      })),
      current_assignment_admissions: 1,
    };
  }
}
