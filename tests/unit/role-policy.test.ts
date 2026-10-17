import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { Schema } from "effect";
import { Skill } from "@opencode/schema/skill";
import { ToolName } from "../../src/identities.ts";
import {
  capabilityRequirements,
  nativePermissions,
  policyAllows,
  protectedControlPath,
} from "../../src/opencode/role-policy.ts";
import { RequiredToolSchema } from "../../src/opencode/capability-contracts.ts";

test("managed roles preserve distinct authority and scoped native edits", () => {
  assert.ok(policyAllows("supervisor", "abra_work_start"));
  assert.ok(!policyAllows("supervisor", "shell"));
  assert.ok(!policyAllows("supervisor", "write"));
  for (const role of ["explore", "apply", "review", "research"] as const) {
    assert.ok(!policyAllows(role, "abra_work_finish"));
    assert.ok(!policyAllows(role, "task"));
    assert.ok(policyAllows(role, "shell"));
    assert.equal(policyAllows(role, "bash"), role === "apply");
  }
  assert.deepEqual(
    nativePermissions("explore", "assigned").find((rule) => rule.action === "edit"),
    { action: "edit", resource: "openspec/changes/assigned/**", effect: "allow" },
  );
  for (const role of ["review", "research"] as const)
    assert.ok(!nativePermissions(role).some((rule) => rule.action === "edit"));
  assert.ok(policyAllows("review", "abra_review_report"));
  assert.ok(!policyAllows("research", "abra_review_report"));
  assert.ok(protectedControlPath("/owned/sub/AGENTS.md", "/owned"));
  assert.ok(protectedControlPath("/owned/.opencode/agent.md", "/owned"));
});

test("capability prerequisites are additive, bounded and cannot grant tools", () => {
  assert.throws(() => Schema.decodeSync(RequiredToolSchema)({ any_of: [] }));
  assert.throws(
    () =>
      capabilityRequirements("review", "full-openspec", {
        required_tools: [{ any_of: [ToolName.make("read"), ToolName.make("bash")] }],
      }),
    /workers.review.required_tools/,
  );
  const req = capabilityRequirements("apply", "lightweight-fix", {
    required_skills: [Skill.ID.make("custom")],
  });
  assert.deepEqual(req.skills, ["abra-browser", "custom"]);
  assert.ok(req.tools.some((group) => group.any_of.includes(ToolName.make("patch"))));
  assert.ok(!req.tools.some((group) => group.any_of.includes(ToolName.make("abra_spec"))));
  assert.deepEqual(capabilityRequirements("research", "research-only").skills, ["abra-browser"]);
  assert.deepEqual(capabilityRequirements("review", "full-openspec").skills, [
    "abra-browser",
    "abra-openspec-execution",
  ]);
});

test("browser command permissions and evidence reads preserve role ceilings", () => {
  for (const role of ["explore", "review", "research"] as const) {
    const rules = nativePermissions(role, "assigned", ["/home/.abracode/browser/ses_one"]);
    assert.deepEqual(
      rules.filter((rule) => rule.action === "shell"),
      [
        { action: "shell", resource: "agent-browser", effect: "allow" },
        { action: "shell", resource: "agent-browser *", effect: "allow" },
      ],
    );
    assert.deepEqual(
      rules.filter((rule) => rule.action === "external_directory"),
      [
        {
          action: "external_directory",
          resource: "/home/.abracode/browser/ses_one/**",
          effect: "allow",
        },
      ],
    );
    for (const workflow of ["research-only", "lightweight-fix", "full-openspec"] as const) {
      const req = capabilityRequirements(role, workflow);
      assert.ok(req.skills.includes(Skill.ID.make("abra-browser")));
      assert.ok(
        req.tools.some((group) => group.any_of.length === 1 && group.any_of[0] === "shell"),
      );
    }
  }
  assert.ok(
    nativePermissions("apply").some((rule) => rule.action === "shell" && rule.resource === "*"),
  );
});
