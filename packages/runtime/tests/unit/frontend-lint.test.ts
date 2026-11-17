import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, copyFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test } from "vite-plus/test";

const command = promisify(execFile);
test(
  "normal frontend lint rejects hook, dependency, purity, synchronization and unnamed-control defects",
  { timeout: 30_000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "abra-frontend-lint-"));
    t.onTestFinished(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, "apps/web/src"), { recursive: true });
    await mkdir(join(root, "scripts/lint"), { recursive: true });
    await symlink(resolve("node_modules"), join(root, "node_modules"), "dir");
    await symlink(resolve("apps/web/node_modules"), join(root, "apps/web/node_modules"), "dir");
    await copyFile(
      "scripts/lint/workspace-boundaries.mjs",
      join(root, "scripts/lint/workspace-boundaries.mjs"),
    );
    await copyFile("apps/web/package.json", join(root, "apps/web/package.json"));
    await writeFile(join(root, "package.json"), JSON.stringify({ type: "module", private: true }));
    await writeFile(
      join(root, "vite.config.ts"),
      `export { default } from ${JSON.stringify(pathToFileURL(resolve("vite.config.ts")).href)};`,
    );
    await writeFile(
      join(root, "apps/web/tsconfig.json"),
      JSON.stringify({ compilerOptions: { jsx: "react-jsx", strict: true }, include: ["src"] }),
    );
    await writeFile(
      join(root, "apps/web/src/probe.tsx"),
      `
import { useEffect, useState } from "react";
export function Conditional({ on }: { on: boolean }) { if (on) useState(0); return <button />; }
export function Dependency({ value }: { value: string }) { useEffect(() => { document.title = value; }, []); return null; }
export function Impure() { return <p>{Date.now()}</p>; }
export function Synchronized({ value }: { value: string }) { const [copy, setCopy] = useState(value); useEffect(() => setCopy(value), [value]); return <p>{copy}</p>; }
`,
    );
    const invoke = () =>
      command(
        resolve("node_modules/.bin/vp"),
        ["lint", "--type-aware", "--deny-warnings", "--format", "json", "apps/web/src"],
        { cwd: root, timeout: 15_000, maxBuffer: 8 * 1024 * 1024 },
      );
    const invalid = await invoke().then(
      () => assert.fail("Invalid frontend passed normal lint"),
      (error: unknown) => {
        assert.equal(
          Reflect.get(error as object, "code"),
          1,
          String(Reflect.get(error as object, "stdout")).slice(0, 2000) +
            String(Reflect.get(error as object, "stderr")),
        );
        return JSON.parse(String(Reflect.get(error as object, "stdout"))) as {
          diagnostics: { code: string }[];
        };
      },
    );
    const codes = invalid.diagnostics.map((diagnostic) => diagnostic.code).join("\n");
    for (const rule of [
      "rules-of-hooks",
      "exhaustive-deps",
      "purity",
      "set-state-in-effect",
      "control-has-associated-label",
    ])
      assert.match(codes, new RegExp(rule));
    await writeFile(
      join(root, "apps/web/src/probe.tsx"),
      `
export function Accessible() { return <section aria-label="Scrollable evidence" tabIndex={0}><pre tabIndex={0} aria-label="Source">retained</pre><button aria-label="Refresh evidence">Refresh</button></section>; }
`,
    );
    await invoke();
  },
);
