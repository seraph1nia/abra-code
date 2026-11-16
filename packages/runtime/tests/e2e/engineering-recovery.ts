import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import { Agent } from "@opencode/schema/agent";
import { OpenCode } from "@opencode/client";
import { type Context } from "@opencode/plugin/effect/plugin";
import { type Execution } from "../../src/domain.ts";
import * as Id from "../../src/identities.ts";
import { loadConfig } from "../../src/config/load.ts";
import { makeClient } from "../../src/opencode/client.ts";
import { capabilityRequirements, policyIdentity } from "../../src/opencode/role-policy.ts";
import { NativeRuntime } from "../../src/opencode/runtime.ts";
import { digestText } from "../../src/opencode/worker-environment.ts";
import { WorkerContextSchema } from "../../src/workflow/worker-context-contracts.ts";
import { run } from "../effects.ts";

/** Seed a historical capture, not a new managed prompt or a claim of native admission. */
export async function capturePreSuite(
  client: ReturnType<typeof OpenCode.make>,
  e: Execution,
  home: string,
) {
  assert.ok(e.worktree_directory && e.explore_session_id && e.base_commit);
  const skill = (
    await client.skill.list({ location: { directory: e.worktree_directory } })
  ).data.find((s) => s.id === "abra-openspec-execution")!;
  const session = await client.session.get({ sessionID: e.explore_session_id });
  const requirements = capabilityRequirements("explore", "full-openspec");
  const guidance = "Historical pre-suite Explore guidance";
  const captured = Schema.decodeUnknownSync(WorkerContextSchema)({
    schema_version: 1,
    issue_id: e.issue_id,
    execution_id: e.execution_id,
    repository_id: e.repository_id,
    generation: e.control_generation,
    role: "explore",
    session_id: e.explore_session_id,
    prompt_id: "msg_retained_pre_suite_fixture",
    workflow: "full-openspec",
    directory: e.worktree_directory,
    base: e.base_commit,
    policy: policyIdentity("explore"),
    environment: {
      agent: session.agent ?? Agent.ID.make("build"),
      model: session.model,
      tools: requirements.tools,
      skills: [
        {
          id: skill.id,
          path: skill.path,
          digest: digestText(skill.content),
          source: "role-policy",
          loading: "unobserved",
        },
      ],
    },
    guidance: {
      path: join(home, ".opencode/agents/explore.md"),
      content: guidance,
      digest: digestText(guidance),
    },
    prompt: "Retained pre-suite prompt payload",
    scope_reference: `openspec/changes/${e.openspec_change}`,
    approvals: e.approval_receipts,
    references: [],
    decisions: [],
    at: new Date().toISOString(),
  });
  const path = join(home, "pre-suite-context.json");
  await writeFile(path, JSON.stringify(captured));
  return path;
}

/** Exact captured prerequisites over actual native inventory after the fixture's server restart. */
export async function assertPreSuiteAfterRestart(
  e: Execution,
  home: string,
  path: string,
  url: string,
  password: string,
) {
  const raw = await readFile(path, "utf8");
  const captured = Schema.decodeUnknownSync(WorkerContextSchema)(JSON.parse(raw));
  const ctx = {
    storage: {
      get: (key: string) =>
        Effect.succeed(
          key === `worker-context/${captured.prompt_id}` ? JSON.parse(raw) : undefined,
        ),
    },
  } as unknown as Context;
  const runtime = new NativeRuntime(ctx, await run(loadConfig(home)));
  const client = await run(
    makeClient({ url, auth: { type: "basic", username: "opencode", password } }),
  );
  runtime.client = () => Effect.succeed(client);
  const retained = { ...e, prompt_id: captured.prompt_id, worker_context_id: captured.prompt_id };
  const resolved = await run(runtime.preflight(retained, "explore", captured.prompt_id));
  assert.deepEqual(resolved, captured.environment);
  assert.equal(await readFile(path, "utf8"), raw);
  const fresh = await run(
    runtime.preflight({ ...e, prompt_id: undefined, worker_context_id: undefined }, "explore"),
  );
  assert.ok(fresh);
  assert.ok(fresh.skills.some((s) => s.id === "abra-codebase-design"));
  assert.ok(fresh.skills.some((s) => s.id === "abra-domain-modeling"));
  assert.ok(fresh.skills.some((s) => s.id === "abra-verification"));
  return {
    historical_prompt: Id.MessageId.make(captured.prompt_id),
    retained: resolved,
    fresh_skill_ids: fresh.skills.map((s) => s.id),
    capture_unchanged: true,
    native_restart: true,
  };
}
