import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "yaml";
import { validateInventory, digest } from "./check.mjs";
const lock = "packages:\n  example@1.0.0:\n    resolution: { integrity: sha512-example }\n";
const text = "MPL-2.0 reviewed source-availability evidence";
const evidence = [{ source: "supplier license", sha256: digest(text) }];
const resolution = parse(lock).packages["example@1.0.0"].resolution;
const inventory = () => ({
  version: 1,
  lock_sha256: digest(lock),
  sources: [],
  packages: [
    {
      id: "example@1.0.0",
      license: "MPL-2.0",
      integrity: resolution.integrity,
      installed: true,
      uses: ["optional-platform"],
      evidence,
      fingerprint: digest(
        JSON.stringify({ id: "example@1.0.0", license: "MPL-2.0", resolution, evidence }),
      ),
      disposition: "reviewed: source tools remain under MPL",
    },
  ],
});
await test("mixed-license evidence passes without relicensing a dependency", () =>
  assert.deepEqual(
    validateInventory(inventory(), lock, () => text),
    [],
  ));
await test("unreviewed, changed, missing and stale evidence fails release readiness", () => {
  for (const change of [
    (i) => (i.packages[0].disposition = "pending-review"),
    (i) => (i.packages[0].id = "example@2.0.0"),
    (i) => (i.packages[0].license = "UNKNOWN"),
    (i) => (i.packages[0].evidence = []),
    (i) => (i.lock_sha256 = "old"),
  ]) {
    const value = inventory();
    change(value);
    assert.ok(validateInventory(value, lock, () => text).length);
  }
  assert.ok(validateInventory(inventory(), lock, () => undefined).length);
  assert.ok(validateInventory(inventory(), lock, () => text + "changed").length);
});
