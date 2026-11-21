import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { realpath, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const installed = (workspace: string, name: string) =>
  createRequire(resolve(workspace, "package.json")).resolve(name);
test("workspace consumers share one Effect, React and A2UI runtime identity under pinned peers", async () => {
  const cases = {
    effect: [
      "packages/runtime",
      "packages/contracts",
      "packages/presentation",
      "apps/web",
      "apps/report",
    ],
    react: ["packages/presentation", "apps/web", "apps/report"],
    "@a2ui/web_core": ["packages/contracts", "packages/presentation", "packages/runtime"],
  };
  for (const [name, workspaces] of Object.entries(cases)) {
    const files = await Promise.all(
      workspaces.map((workspace) => realpath(installed(workspace, name))),
    );
    assert.equal(new Set(files).size, 1, `${name} must have one physical runtime identity`);
    const values = await Promise.all(files.map((file) => import(pathToFileURL(file).href)));
    assert.ok(values.every((value) => value === values[0]));
  }
  const require = createRequire(resolve("packages/runtime/package.json"));
  const agentRequire = createRequire(require.resolve("@a2ui/agent"));
  assert.equal(
    await realpath(agentRequire.resolve("@a2ui/web_core")),
    await realpath(require.resolve("@a2ui/web_core")),
  );
  const zod = JSON.parse(await readFile(require.resolve("zod/package.json"), "utf8"));
  assert.equal(zod.version, "3.25.76");
  const core = JSON.parse(await readFile(require.resolve("@ag-ui/core/package.json"), "utf8"));
  assert.equal(core.version, "1.0.4");
});
