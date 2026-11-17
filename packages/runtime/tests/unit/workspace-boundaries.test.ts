import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test } from "vite-plus/test";

const command = promisify(execFile);
test("contributor lint rejects value, type and dynamic workspace escapes and missing direct dependencies", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "abra-boundaries-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const json = (path: string, value: unknown) => writeFile(join(root, path), JSON.stringify(value));
  for (const directory of ["apps/web/src", "packages/contracts/src", "packages/presentation/src"])
    await mkdir(join(root, directory), { recursive: true });
  await json("package.json", { name: "probe", private: true, type: "module" });
  await json("packages/contracts/package.json", {
    name: "@abracode/contracts",
    exports: { "./identities": "./src/identities.ts" },
  });
  await json("packages/presentation/package.json", {
    name: "@abracode/presentation",
    dependencies: { "@abracode/contracts": "workspace:*" },
  });
  await json("apps/web/package.json", {
    name: "@abracode/web",
    imports: {
      "#local": "./src/local.ts",
      "#escape": "./../../../packages/contracts/src/private.ts",
    },
    dependencies: { "@abracode/contracts": "workspace:*" },
    devDependencies: { "build-only": "1.0.0" },
  });
  await json(".oxlintrc.json", {
    jsPlugins: [resolve("scripts/lint/workspace-boundaries.mjs")],
    rules: { "abracode/boundaries": "error" },
  });
  const probes = {
    relative: 'import type { Secret } from "../../../packages/contracts/src/private.ts";',
    reexport: 'export type { Secret } from "../../../packages/contracts/src/private.ts";',
    dynamic: 'void import("../../../packages/contracts/src/private.ts");',
    typequery: 'export type Secret = import("../../../packages/contracts/src/private.ts").Secret;',
    alias: 'import "@/../../../packages/contracts/src/private.ts";',
    host: 'import { readFile } from "node:fs/promises"; void readFile;',
    undeclared: 'import "undeclared-package";',
    privateExport: 'import "@abracode/contracts/src/private.ts";',
    buildOnly: 'import "build-only";',
    privateEscape: 'import "#escape";',
  };
  for (const [name, source] of Object.entries(probes))
    await writeFile(join(root, `apps/web/src/${name}.ts`), source);
  await writeFile(
    join(root, "packages/presentation/src/live.ts"),
    'import "@copilotkit/react-core/v2";',
  );
  const result = await command(
    resolve("node_modules/.bin/oxlint"),
    ["-c", ".oxlintrc.json", "apps", "packages"],
    { cwd: root },
  ).then(
    () => assert.fail("Forbidden imports were accepted"),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(Reflect.get(error, "code"), 1);
      return String(Reflect.get(error, "stdout")) + String(Reflect.get(error, "stderr"));
    },
  );
  for (const name of [...Object.keys(probes), "live"])
    assert.match(result, new RegExp(`${name}\\.ts`));
  assert.match(result, /declared.*direct dependencies/);
  assert.match(result, /explicit public package export/);
  assert.match(result, /host capabilities/);
  for (const name of Object.keys(probes)) await rm(join(root, `apps/web/src/${name}.ts`));
  await rm(join(root, "packages/presentation/src/live.ts"));
  await writeFile(
    join(root, "apps/web/src/accepted.ts"),
    [
      'import type { IssueId } from "@abracode/contracts/identities";',
      'export type { IssueId as PublicId } from "@abracode/contracts/identities";',
      'void import("@abracode/contracts/identities");',
      'export type Id = import("@abracode/contracts/identities").IssueId;',
      'import "@/local.ts";',
      'import "#local";',
    ].join("\n"),
  );
  await command(resolve("node_modules/.bin/oxlint"), ["-c", ".oxlintrc.json", "apps", "packages"], {
    cwd: root,
  });
});
