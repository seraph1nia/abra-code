import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, realpath, rm, writeFile, lstat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { installSource, installationRoot } from "../e2e/install.ts";
import { removeFixture } from "../helpers/resources.ts";

test("shared suppliers retain private workspace resolution and source edits", async (t) => {
  const root = await installationRoot("abra-source-links-");
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const home = join(root, "installation");
  await mkdir(home);
  await installSource(home, { buildWeb: false, sharedSuppliers: true });
  assert.equal(await lstat(join(home, "node_modules/.modules.yaml")).then((s) => s.isFile()), true);
  assert.equal(
    await lstat(join(home, "node_modules/.pnpm-task-run-state-v1")).catch(() => undefined),
    undefined,
  );
  const runtime = createRequire(join(home, "packages/runtime/package.json"));
  assert.equal(
    runtime.resolve("@abracode/contracts/identities"),
    join(home, "packages/contracts/src/identities.ts"),
  );
  assert.equal(
    await realpath(join(home, "node_modules/@abracode/runtime")),
    join(home, "packages/runtime"),
  );
  assert.equal(
    await realpath(join(home, "packages/runtime/node_modules/effect")),
    await realpath(resolve("packages/runtime/node_modules/effect")),
  );
  const source = "packages/contracts/src/identities.ts";
  const original = await readFile(resolve(source), "utf8");
  await writeFile(join(home, source), original + "\n// Private fixture change\n");
  assert.equal(await readFile(resolve(source), "utf8"), original);
  assert.notEqual(await readFile(join(home, source), "utf8"), original);
});

test("compiler fixtures isolate renderer suppliers while sharing unrelated tools", async (t) => {
  const root = await installationRoot("abra-renderer-suppliers-");
  t.onTestFinished(() => removeFixture(root));
  await installSource(root, { buildWeb: false });
  for (const path of [
    "node_modules/vite-plus",
    "apps/report/node_modules/mermaid",
    "apps/report/node_modules/react",
    "packages/presentation/node_modules/react",
  ])
    assert.ok((await realpath(join(root, path))).startsWith(root + "/"), path);
  const tool = "node_modules/@opencode/cli";
  assert.equal(await realpath(join(root, tool)), await realpath(resolve(tool)));
  const supplier = "apps/report/node_modules/mermaid/package.json";
  const original = await readFile(resolve(supplier), "utf8");
  await writeFile(join(root, supplier), original + "\n");
  assert.equal(await readFile(resolve(supplier), "utf8"), original);
  assert.notEqual(await readFile(join(root, supplier), "utf8"), original);
});
