import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { Effect } from "effect";
import { Skill } from "@opencode/schema/skill";
import { type Context } from "@opencode/plugin/effect/plugin";
import { AbsolutePath } from "../../src/identities.ts";
import { registerSkills } from "../../src/opencode/skills.ts";
import { capabilityRequirements } from "../../src/opencode/role-policy.ts";
import { engineeringGuidance } from "../../src/opencode/engineering-skills.ts";
import { resolveSkills } from "../../src/opencode/worker-environment.ts";
import { workerPrompt } from "../../src/workflow/prompts.ts";
import { fixture } from "../fixtures.ts";
import { IssueId } from "../../src/identities.ts";
import { readFile } from "node:fs/promises";
import { run } from "../effects.ts";

const expected = {
  explore: ["codebase-design", "domain-modeling", "verification"],
  apply: ["codebase-design", "domain-modeling", "diagnosing-bugs", "verification", "blast-radius"],
  review: ["codebase-design", "verification", "blast-radius"],
  research: [],
};

test("portable registration preserves local skills centrally and at foreign locations", async () => {
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
    await run(registerSkills(ctx, AbsolutePath.make(resolve(".")), central));
    assert.equal(inventory.get(local.id), local);
    for (const name of expected.apply) {
      const skill = inventory.get(`abra-${name}`);
      assert.ok(skill);
      assert.ok(skill.content.includes("Adapted from"));
      assert.ok(!/\]\((?:\.\/)?(?:references|DEEPENING|DESIGN-IT-TWICE)/.test(skill.content));
    }
    assert.equal(inventory.has("abra-orchestration"), central);
    assert.ok(inventory.has("abra-openspec-execution"));
  }
});

test("new admissions select the role matrix additively and load only relevant procedures", async () => {
  for (const role of ["explore", "apply", "review", "research"] as const) {
    const workflow = role === "research" ? "research-only" : "full-openspec";
    const configured = { required_skills: [Skill.ID.make("local-fixture")] };
    const req = capabilityRequirements(role, workflow, configured);
    assert.deepEqual(req.skills, [
      ...(workflow === "full-openspec" ? ["abra-openspec-execution"] : []),
      ...expected[role].map((name) => `abra-${name}`),
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
  const id = IssueId.make("engineering-prompt");
  f.work.add(id);
  const e = await run(f.controller.start(id));
  const issue = f.work.issues.get(id)!;
  for (const role of ["explore", "apply", "review", "research"] as const) {
    const workflow = role === "research" ? "research-only" : "full-openspec";
    const prompt = workerPrompt({ ...e, workflow_policy: workflow }, issue, role);
    const leaf = await readFile(resolve(`.opencode/agents/${role}.md`), "utf8");
    for (const name of expected[role]) {
      assert.ok(prompt.includes(`abra-${name}`));
      assert.ok(leaf.includes(`abra-${name}`));
    }
    if (role === "research") assert.ok(!prompt.includes("abra-codebase-design"));
    else assert.match(prompt, /does not require every procedure/);
    if (role === "apply" || role === "review") {
      const lightweight = workerPrompt({ ...e, workflow_policy: "lightweight-fix" }, issue, role);
      assert.match(lightweight, /Approved short scope:/);
      assert.ok(!lightweight.includes("abra-openspec-execution"));
      assert.ok(lightweight.includes("abra-verification"));
    }
  }
});
