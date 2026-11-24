import assert from "node:assert/strict";
import { Effect, Layer } from "effect";
import { Tool } from "@opencode/schema/tool";
import { Agent } from "@opencode/schema/agent";
import type { ToolEditor } from "@opencode/plugin/effect/tool";
import type { Context } from "@opencode/plugin/effect/plugin";
import { test } from "vite-plus/test";
import type { Controller } from "../../src/workflow/controller.ts";
import { registerTools } from "../../src/opencode/tools.ts";
import { workerPermissions, workerToolAllowed } from "../../src/opencode/role-policy.ts";
import { CrewError } from "../../src/domain.ts";
import * as Id from "@abracode/contracts/identities";
import { fixture } from "../fixtures.ts";
import { run } from "../effects.ts";
import { Agents } from "@abracode/agents";
import { readSkill } from "@abracode/agents/skills";
import { platformLayer } from "../../src/platform.ts";
import { bundledSkills, AgentsLive, sourcesLayer } from "@abracode/agents/bundled";

test("registered memory tools bind all worker roles, captured policy, actual user direction and diagnostic authority", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  f.config.memory = {
    enabled: true,
    directory: Id.AbsolutePath.make("/unused-memory"),
    executable: Id.AbsolutePath.make("/unused-bm"),
  };
  const session = Id.SessionId.make("ses_memory"),
    prompt = Id.MessageId.make("msg_assignment"),
    message = Id.MessageId.make("msg_tool");
  const repo = Id.RepositoryId.make("frontend"),
    directory = Id.AbsolutePath.make("/assigned");
  const ref = {
    scope: { kind: "repository" as const, repository_id: repo },
    path: "note.md",
    revision: "a".repeat(64),
  };
  const tools = new Map<string, Tool.Info>();
  let userText = "Discuss this note";
  const ctx = {
    session: {
      context: () =>
        Effect.succeed([
          { type: "user", id: prompt, text: userText },
          { type: "assistant", id: message },
        ]),
    },
    tool: {
      transform: (fn: (editor: ToolEditor) => void) =>
        Effect.sync(() =>
          fn({
            namespace() {},
            remove() {},
            update() {},
            list() {
              return [];
            },
            get() {
              return undefined;
            },
            add(tool) {
              tools.set(tool.name, tool);
            },
          } as ToolEditor),
        ),
    },
  } as unknown as Context;
  const handled: string[] = [];
  let current: unknown,
    capture: unknown,
    agent = Agent.ID.make("abra"),
    diagnostic = false;
  const controller = {
    memory: {
      enabled: true,
      search: (id: string) => {
        handled.push("search " + id);
        return Effect.succeed({ entries: [] });
      },
      read: (id: string) => {
        handled.push("read " + id);
        return Effect.succeed({ reference: ref, body: "advice", complete: true });
      },
      publish: () => {
        handled.push("publish");
        return Effect.succeed(ref);
      },
    },
    queries: {
      settings: { home: f.config.home },
      assignment: () => Effect.succeed(current),
      capturedWorkerPrompt: () => Effect.succeed(capture),
      session: () =>
        Effect.succeed({
          agent,
          directory: current ? directory : f.config.home,
          metadata: { abracode_supervisor_home: f.config.home },
        }),
    },
    lead: () => ({ principal: () => Effect.undefined }),
    guardAttention: () =>
      diagnostic
        ? Effect.fail(new CrewError("ATTENTION_AUTHORITY", "diagnostic turn"))
        : Effect.void,
    recordSupervisor: () => Effect.void,
  } as unknown as Controller;
  await run(registerTools(ctx, controller, f.onboarding, true, f.setup));
  const call = (name: string, input: unknown) =>
    run(
      tools.get(name)!.execute(input, {
        sessionID: session,
        messageID: message,
        id: Tool.CallID.make("test"),
        agent,
        progress: () => Effect.void,
      }),
    );
  const publish = {
    destination: ref.scope,
    source: { kind: "observation" },
    content: "Check current fixtures.",
  };
  for (const [role, phase] of [
    ["explore", "exploring"],
    ["apply", "applying"],
    ["review", "verifying"],
    ["research", "researching"],
  ] as const) {
    const profile = await run(
      Effect.gen(function* () {
        const agents = yield* Agents;
        return yield* (yield* agents.get(role)).resolve(role);
      }).pipe(
        Effect.provide(
          AgentsLive.pipe(Layer.provide(sourcesLayer()), Layer.provide(platformLayer)),
        ),
      ),
    );
    assert.match(profile.system, /abra-memory/);
    assert.ok(profile.skills.some((s) => s.id === "abra-memory" && !s.preload));
    assert.ok(
      workerPermissions(role, profile, "change", []).some(
        (p) => p.action === "abra_memory_search" && p.effect === "allow",
      ),
    );
    assert.ok(
      !workerPermissions(role, profile, "change", []).some(
        (p) => p.action === "external_directory",
      ),
    );
    assert.ok(!workerToolAllowed(role, profile, "abra_memory_publish"));
    agent = Agent.ID.make(profile.id);
    const e = {
      active_role: role,
      current_phase: phase,
      [role + "_session_id"]: session,
      control_generation: 1,
      prompt_id: prompt,
      worker_context_id: prompt,
      repository_id: repo,
      worktree_directory: directory,
      configuration_snapshot: { memory_reads: true },
    };
    current = e;
    const captured = {
      schema_version: 2,
      role,
      generation: 1,
      session_id: session,
      prompt_id: prompt,
      environment: { agent },
      prepared: { profile },
    };
    capture = captured;
    await call("memory_search", { query: "known" });
    await call("memory_read", { reference: ref });
    const count = handled.length;
    await assert.rejects(
      call("memory_search", { query: "known", repository_id: "other" }),
      /MEMORY_SCOPE/,
    );
    await assert.rejects(call("memory_publish", publish), /WORKER_FORBIDDEN/);
    capture = {
      ...captured,
      prepared: {
        profile: {
          ...profile,
          permissions: [
            ...profile.permissions,
            { action: "abra_memory_*", effect: "deny", resource: "*" },
          ],
        },
      },
    };
    await assert.rejects(call("memory_search", { query: "known" }), /MEMORY_SCOPE/);
    capture = { ...captured, schema_version: 1 };
    await assert.rejects(call("memory_read", { reference: ref }), /MEMORY_SCOPE/);
    capture = captured;
    current = { ...e, control_generation: 2 };
    await assert.rejects(call("memory_search", { query: "known" }), /MEMORY_SCOPE/);
    current = { ...e, configuration_snapshot: {} };
    await assert.rejects(call("memory_search", { query: "known" }), /MEMORY_SCOPE/);
    assert.equal(handled.length, count);
  }
  current = undefined;
  agent = Agent.ID.make("abra");
  await assert.rejects(call("memory_publish", publish), /MEMORY_DIRECTION/);
  userText = "Remember for repository frontend: " + publish.content;
  diagnostic = true;
  await assert.rejects(call("memory_publish", publish), /ATTENTION_AUTHORITY/);
  diagnostic = false;
  await call("memory_publish", publish);
  assert.equal(handled.filter((v) => v === "publish").length, 1);
  const skill = await run(readSkill(bundledSkills, "memory").pipe(Effect.provide(platformLayer)));
  assert.equal(skill.id, "abra-memory");
  assert.match(skill.content, /counterexamples/);
});
