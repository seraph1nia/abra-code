import assert from "node:assert/strict";
import { OpenCode } from "@opencode/client";
import { roleEngineeringSkills } from "../../src/opencode/engineering-skills.ts";
import { type Role } from "../../src/domain.ts";
import { type SessionId } from "../../src/identities.ts";

export const proofSource = `import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
assert.equal(readFileSync('source.txt','utf8'), 'sample\\n');
console.log('sample consumer observed sample');
`;

/** Deterministic provider sequence; real tools and controller checks supply the observations. */
export function engineeringCalls(user: string, role: string) {
  if (!user.includes("engineering-acceptance") || !["explore", "apply", "review"].includes(role))
    return [];
  const workflow = user.includes("Approved short scope:") ? "lightweight-fix" : "full-openspec";
  const calls: { name: string; args: Record<string, unknown> }[] = roleEngineeringSkills(
    role as Role,
    workflow,
  ).map(({ name }) => ({ name: "skill", args: { id: `abra-${name}` } }));
  if (role === "apply" && !user.includes("Approved short scope:"))
    calls.push(
      { name: "read", args: { path: "README.md" } },
      { name: "write", args: { path: "sample-proof.mjs", content: proofSource } },
      { name: "shell", args: { command: "node sample-proof.mjs" } },
      {
        name: "abra_worker_progress",
        args: {
          generation: Number(/Control generation: (\d+)/.exec(user)![1]),
          summary:
            "Diagnosis: consumer reproduction expects sample but reads original. Hypothesis: source content is the cause; rerun the same consumer after the scoped edit. No verification recipe exists here; using the existing documented node check.",
        },
      },
    );
  if (role === "review")
    calls.push(
      { name: "read", args: { path: "source.txt" } },
      ...(!user.includes("Approved short scope:")
        ? [{ name: "read", args: { path: "sample-proof.mjs" } }]
        : []),
      { name: "shell", args: { command: "touch forbidden-engineering-review" } },
    );
  calls.push(
    { name: "abra_work_finish", args: { issue_id: "forbidden-engineering-management" } },
    {
      name: "task",
      args: {
        description: "forbidden engineering delegation",
        prompt: "Edit another worktree",
        subagent_type: "general",
      },
    },
  );
  return calls;
}

export async function assertEngineeringWorker(
  client: ReturnType<typeof OpenCode.make>,
  sessionID: SessionId,
  role: "explore" | "apply" | "review",
) {
  const messages = await client.session.context({ sessionID });
  const calls = messages.flatMap((m) =>
    m.type === "assistant" ? m.content.filter((p) => p.type === "tool") : [],
  );
  for (const { name } of roleEngineeringSkills(role, "full-openspec")) {
    const call = calls.find(
      (p) =>
        p.type === "tool" &&
        p.name === "skill" &&
        p.state.status !== "streaming" &&
        p.state.input.id === `abra-${name}`,
    );
    assert.ok(call?.type === "tool" && call.state.status === "completed", JSON.stringify(call));
    assert.match(JSON.stringify(call.state.content), /Adapted from/);
  }
  for (const name of ["abra_work_finish", "task"]) {
    const call = calls.find((p) => p.type === "tool" && p.name === name);
    assert.ok(call?.type === "tool" && call.state.status === "error", JSON.stringify(call));
  }
  if (role === "apply") {
    const documentedCheck = calls.find(
      (p) =>
        p.type === "tool" &&
        p.name === "read" &&
        p.state.status !== "streaming" &&
        p.state.input.path === "README.md",
    );
    assert.ok(documentedCheck?.type === "tool" && documentedCheck.state.status === "completed");
    assert.match(JSON.stringify(documentedCheck.state.content), /existing source-content check/);
    const runs = calls.filter(
      (p) =>
        p.type === "tool" &&
        p.name === "shell" &&
        p.state.status !== "streaming" &&
        typeof p.state.input.command === "string" &&
        p.state.input.command.startsWith("node sample-proof.mjs"),
    );
    assert.equal(runs.length, 2, JSON.stringify(runs));
    for (const [i, call] of runs.entries()) {
      assert.ok(call.type === "tool" && call.state.status === "completed", JSON.stringify(call));
      assert.equal(call.state.metadata?.exit, i === 0 ? 1 : 0, JSON.stringify(call));
    }
    assert.match(JSON.stringify(runs[1]), /sample consumer observed sample/);
  }
  if (role === "review") {
    assert.ok(
      calls.some(
        (p) =>
          p.type === "tool" &&
          p.name === "read" &&
          p.state.status === "completed" &&
          p.state.input.path === "sample-proof.mjs",
      ),
    );
    assert.ok(
      calls.some(
        (p) =>
          p.type === "tool" &&
          p.name === "shell" &&
          p.state.status === "error" &&
          p.state.input.command === "touch forbidden-engineering-review",
      ),
    );
  }
  return {
    role,
    session_id: sessionID,
    skills: roleEngineeringSkills(role, "full-openspec").map((s) => `abra-${s.name}`),
    calls: calls.map((p) =>
      p.type === "tool"
        ? {
            name: p.name,
            status: p.state.status,
            ...(p.state.status !== "streaming" ? { input: p.state.input } : {}),
            ...(p.state.status === "completed"
              ? {
                  metadata: p.state.metadata,
                  output: p.state.content
                    .filter((c) => c.type === "text")
                    .map((c) => c.text)
                    .join("\n")
                    .slice(0, 1200),
                }
              : {}),
          }
        : p,
    ),
  };
}
