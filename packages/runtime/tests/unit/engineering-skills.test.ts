import { ExpressPromptGenerator } from "@a2ui/agent";
import { catalog } from "@abracode/contracts/web/catalog";
import { compileWorkView } from "../../src/web/express.ts";
import { goal as workGoal } from "../helpers/work-goal.ts";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Effect } from "effect";
import { Skill } from "@opencode/schema/skill";
import { Agent } from "@opencode/schema/agent";
import { Model } from "@opencode/schema/model";
import { Provider } from "@opencode/schema/provider";
import { type Context } from "@opencode/plugin/effect/plugin";
import { AbsolutePath, ObligationKey } from "@abracode/contracts/identities";
import { registerSkills } from "@abracode/agents/native";
import { bundledSkills } from "@abracode/agents/bundled";
import { platformLayer } from "../../src/platform.ts";
import { capabilityRequirements } from "../../src/opencode/role-policy.ts";
import { engineeringGuidance } from "@abracode/agents/engineering-skills";
import { resolveSkills, resolveCapturedSkills } from "../../src/opencode/worker-environment.ts";
import { assignmentDecisions, workerPrompt } from "../../src/workflow/worker-context.ts";
import { fixture } from "../fixtures.ts";
import { access, cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { run } from "../effects.ts";

const expected = {
  explore: ["codebase-design", "domain-modeling", "verification"],
  apply: ["codebase-design", "domain-modeling", "diagnosing-bugs", "verification", "blast-radius"],
  review: ["codebase-design", "verification", "blast-radius"],
  research: [],
};

test("portable registration preserves local skills without a developer skill directory", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "abra-runtime-skills-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const skills = join(root, "packages/agents/assets/skills");
  await cp(bundledSkills, skills, { recursive: true });
  await assert.rejects(access(join(root, ".agents")), /ENOENT/);
  for (const central of [false, true]) {
    const local = { id: Skill.ID.make("local-fixture"), content: "Local instructions" };
    const inventory = new Map<string, Pick<Skill.Info, "id" | "content">>([[local.id, local]]);
    const ctx = {
      skill: {
        transform: (f: (editor: { add: (skill: Skill.Info) => void }) => void) =>
          Effect.sync(() =>
            f({
              add: (skill) => {
                inventory.set(skill.id, skill);
              },
            }),
          ),
      },
    } as unknown as Context;
    await run(
      registerSkills(ctx, skills, central, ["express"]).pipe(Effect.provide(platformLayer)),
    );
    assert.equal(inventory.get(local.id), local);
    for (const name of expected.apply) {
      const skill = inventory.get(`abra-${name}`);
      assert.ok(skill);
      assert.ok(skill.content.includes("Adapted from"));
      assert.ok(!/\]\((?:\.\/)?(?:references|DEEPENING|DESIGN-IT-TWICE)/.test(skill.content));
    }
    assert.equal(inventory.has("abra-express"), central);
    const express = inventory.get("abra-express");
    if (express) {
      const signatures = new ExpressPromptGenerator([catalog])
        .generateCatalogInstructions()
        .split("\n")
        .filter((line) => line.startsWith("• "));
      assert.deepEqual(
        express.content.split("\n").filter((line) => line.startsWith("• ")),
        signatures,
      );
      const examples = [...express.content.matchAll(/```express\n([\s\S]*?)```/g)];
      assert.equal(examples.length, 4);
      for (const [, example] of examples) compileWorkView("example", example);
    }
    assert.equal(inventory.has("abra-orchestration"), central);
    assert.ok(inventory.has("abra-openspec-execution"));
    assert.ok(!inventory.has("abra-testing"));
    assert.ok(inventory.has("abra-memory"));
    assert.equal(inventory.has("abra-thoughts"), central);
    assert.equal(inventory.size, central ? 15 : 10);
  }
});

test("retained testing requirements block explicitly while relocated skill observations stay immutable", async () => {
  const id = Skill.ID.make("abra-testing");
  const prior = {
    id,
    name: Skill.Name.make(id),
    path: AbsolutePath.make("/old/.agents/skills/testing/SKILL.md"),
    content: "Previously registered contributor testing guidance",
  };
  const resolved = await run(
    resolveSkills("research", "research-only", { required_skills: [id] }, [prior], "/worker"),
  );
  const environment = {
    ...resolved,
    agent: Agent.ID.make("research"),
    model: {
      providerID: Provider.ID.make("fixture"),
      id: Model.ID.make("fixture"),
    },
  };
  const before = structuredClone(environment);
  await assert.rejects(
    run(resolveCapturedSkills("research", environment, [], "/worker")),
    /required skill abra-testing.*missing, ambiguous or unusable/,
  );
  const observed = await run(
    resolveCapturedSkills(
      "research",
      environment,
      [{ ...prior, path: AbsolutePath.make("/relocated/skill.md") }],
      "/worker",
    ),
  );
  assert.deepEqual(observed, resolved);
  assert.deepEqual(environment, before);
});

test("new admissions select the role matrix additively and load only relevant procedures", async () => {
  for (const role of ["explore", "apply", "review", "research"] as const) {
    const workflow = role === "research" ? "research-only" : "full-openspec";
    const configured = { required_skills: [Skill.ID.make("local-fixture")] };
    const req = capabilityRequirements(role, workflow, configured);
    assert.deepEqual(req.skills, [
      ...(workflow === "full-openspec" ? ["abra-openspec-execution"] : []),
      ...expected[role].map((name) => `abra-${name}`),
      ...(role === "review" ? ["abra-open-code-review-delegate"] : []),
      "local-fixture",
    ]);
    const inventory = req.skills.map((id) => ({
      id,
      name: Skill.Name.make(id),
      path: AbsolutePath.make(`/installed/${id}/SKILL.md`),
      content: "Offline procedure",
    }));
    const resolved = await run(resolveSkills(role, workflow, configured, inventory, "/foreign"));
    assert.equal(resolved.skills.at(-1)?.source, `workers.${role}.required_skills`);
    assert.ok(resolved.skills.every((s) => s.digest.length === 64 && s.loading === "unobserved"));
    if (role !== "research") {
      const missing = inventory.filter((s) => s.id !== `abra-${expected[role][0]}`);
      for (const entries of [
        missing,
        [...inventory, inventory[1]],
        inventory.map((s, i) => (i === 1 ? { ...s, content: " " } : s)),
      ])
        await assert.rejects(
          run(resolveSkills(role, workflow, configured, entries, "/foreign")),
          /at \/foreign: required skill abra-codebase-design \(role-policy\)/,
        );
      assert.match(
        engineeringGuidance(role, workflow),
        /conditionally.*does not require every procedure/s,
      );
    } else assert.equal(engineeringGuidance(role, workflow), "");
  }
});

test("conditional prompts and role leaves retain policy-specific assignments", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const { id } = await run(f.work.create(workGoal("engineering-prompt")));
  const e = await run(f.controller.start(id));
  const issue = await run(f.work.show(id));
  const decision = {
    key: ObligationKey.make("storage"),
    scope: "Storage",
    schema_version: 1 as const,
    question: "Choose storage",
    owner: "user" as const,
    session_id: "controller" as const,
    status: "answered" as const,
    opened_at: 1,
    answer: "SQLite",
    generation: 2,
  };
  const active = {
    ...e,
    control_generation: 2,
    decisions: [{ ...decision, generation: 1, answer: "Redis" }, decision],
  };
  const prompt = workerPrompt(active, issue, "apply");
  assert.match(prompt, /SQLite/);
  assert.doesNotMatch(prompt, /Redis/);
  assert.equal(assignmentDecisions(active)[0].basis, "current_generation");
  assert.throws(
    () =>
      assignmentDecisions({ ...active, decisions: [decision, { ...decision, answer: "Other" }] }),
    /Conflicting current answers/,
  );
  for (const role of ["explore", "apply", "review", "research"] as const) {
    const workflow = role === "research" ? "research-only" : "full-openspec";
    const prompt = workerPrompt({ ...e, workflow_policy: workflow }, issue, role);
    const leaf = await readFile(resolve(`packages/agents/assets/${role}.md`), "utf8");
    for (const name of expected[role]) {
      assert.ok(prompt.includes(`abra-${name}`));
      assert.ok(leaf.includes(`abra-${name}`));
    }
    if (role === "explore") {
      const procedure = await readFile(
        resolve("packages/agents/assets/skills/openspec-execution/SKILL.md"),
        "utf8",
      );
      assert.match(prompt, /abra-openspec-execution/);
      assert.match(procedure, /Apply prerequisite closure/);
      assert.match(procedure, /neither design nor a redundant report/);
      assert.match(procedure, /captured plan requirement/);
    }
    if (role === "research") assert.ok(!prompt.includes("abra-codebase-design"));
    else assert.match(prompt, /does not require every procedure/);
    if (role === "apply" || role === "review") {
      const lightweight = workerPrompt({ ...e, workflow_policy: "lightweight-fix" }, issue, role);
      assert.match(lightweight, /Approved short scope:/);
      assert.ok(!lightweight.includes("abra_spec apply"));
      assert.ok(lightweight.includes("abra-verification"));
    }
  }
});
