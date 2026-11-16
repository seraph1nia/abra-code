import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "yaml";
import { validateInventory, digest, reusableSupplier } from "./check.mjs";
import { parseLock } from "./lock.mjs";
import { classifyUses } from "./uses.mjs";
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

await test("pnpm toolchain documents participate in license checks and reachability", () => {
  const combined = `importers:
  .:
    packageManagerDependencies:
      pnpm: {version: 12.21.0}
packages:
  pnpm@12.21.0: {resolution: {integrity: sha512-toolchain}}
snapshots:
  pnpm@12.21.0: {}
---
${lock}`;
  assert.deepEqual(Object.keys(parseLock(combined).packages), ["pnpm@12.21.0", "example@1.0.0"]);
  assert.deepEqual(classifyUses(parseLock(combined)).get("pnpm@12.21.0"), ["contributor-build"]);
  const value = inventory();
  value.lock_sha256 = digest(combined);
  assert.ok(
    validateInventory(value, combined, () => text).includes("Unreviewed license: pnpm@12.21.0"),
  );
  assert.throws(() => parseLock(`${lock}\n---\npackages:\n  example@1.0.0: {}\n`), /Conflicting/);
  assert.throws(() => parseLock("packages: ["));
});

await test("linked workspaces retain transitive distribution uses through relative links and cycles", () => {
  const uses = classifyUses({
    importers: {
      ".": { dependencies: { "@local/contracts": { version: "link:packages/contracts" } } },
      "apps/web": { dependencies: { "@local/ui": { version: "link:../../packages/ui" } } },
      "apps/report": { dependencies: { "@local/ui": { version: "link:../../packages/ui" } } },
      "packages/ui": {
        dependencies: { "@local/contracts": { version: "link:../contracts" } },
      },
      "packages/contracts": {
        dependencies: { example: { version: "1.0.0" }, "@local/ui": { version: "link:../ui" } },
      },
    },
    packages: { "example@1.0.0": {} },
    snapshots: {},
  });
  assert.deepEqual(uses.get("example@1.0.0"), [
    "application-runtime",
    "report-artifact",
    "web-client",
  ]);
  assert.throws(
    () =>
      classifyUses({
        importers: { ".": { dependencies: { missing: { version: "link:packages/missing" } } } },
        packages: {},
      }),
    /Missing workspace importer/,
  );
});

await test("incremental refresh reuses only matching resolutions with exact retained evidence", () => {
  const record = inventory().packages[0];
  assert.equal(
    reusableSupplier(record, resolution, () => text),
    true,
  );
  assert.equal(
    reusableSupplier(record, { integrity: "sha512-changed" }, () => text),
    false,
  );
  assert.equal(
    reusableSupplier(record, resolution, () => "changed license bytes"),
    false,
  );
  assert.equal(
    reusableSupplier(record, resolution, () => undefined),
    false,
  );
  assert.equal(
    reusableSupplier(undefined, resolution, () => text),
    false,
  );
});
