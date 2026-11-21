import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "vite-plus/test";
import {
  compatiblePolicy,
  policyIdentity,
  nativePermissions,
  capabilityRequirements,
} from "../../src/opencode/role-policy.ts";

// Captured from production helpers at d03cc086, before moving their owner.
const baseline = {
  supervisor: [
    "6cb7927e8a654bef2fa7b0fbe33efac6927cf38be6c3c62427b12a63b3044ba6",
    "5bca0c5260e276419a8abf029a0108bf2ede685f2df8437124299d4b7c47e586",
  ],
  explore: [
    "b131d942c365ce1067bc5d25160c8136ea53cbdc74310145c5b2af423e8eef4a",
    "15f6d80a7e40444a96ee5546d0713d3d9e69fa64074b65c5b1eb34ce9f497139",
  ],
  apply: [
    "5aa97fc9ef71ae5336a83715ea337203810ea908a7f36e09b7ef0fbb2fda2af4",
    "60228339917157cbe08f1e79b7af4f2597b2ea00dde930ce7d9fc06b263388fb",
  ],
  review: [
    "e24f8198590307ccbebedf9bc4b0dae5e61a56d1281303cb495f576a7040fb63",
    "4cd8c00cbdaac85dc014f977c0206cf6515a993dd54e9acac16e5bca10e6fd0b",
  ],
  research: [
    "a33c4ef3787ef04785bd1ea7b2f725670e041b305a882d93371052fdd84ff3b8",
    "daca278b292982cd3f8038b1c51f77a22d791a64f1f8c5166f25288e9fed8f6a",
  ],
} as const;

test("historical policy bytes, permission order/resources and engineering prerequisites remain exact", () => {
  for (const role of Object.keys(baseline) as (keyof typeof baseline)[]) {
    assert.ok(compatiblePolicy(role, baseline[role][0]));
    if (role !== "review") assert.equal(policyIdentity(role), baseline[role][0]);
    const payload = {
      permissions: nativePermissions(role, "assigned", ["/read-root"]).filter(
        (p) => p.action !== "abra_review_changes",
      ),
      requirements:
        role !== "supervisor" ? capabilityRequirements(role, "full-openspec", {}, false) : null,
    };
    assert.equal(
      createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
      baseline[role][1],
    );
  }
});
