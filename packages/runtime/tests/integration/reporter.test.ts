import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createDiagramRenderer } from "@abracode/report-export/diagrams";
const command = promisify(execFile);

test(
  "prepared diagram tooling validates supported syntax, rendering failures and portable SVG",
  { timeout: 60000 },
  async (t) => {
    const renderer = await createDiagramRenderer();
    t.onTestFinished(() => renderer.close());
    for (const source of [
      "flowchart LR\n A --> B",
      "sequenceDiagram\n A->>B: Captured evidence",
      "stateDiagram-v2\n [*] --> Observed",
    ]) {
      const svg = await renderer.render(source);
      assert.match(svg, /<svg/);
      assert.doesNotMatch(svg, /<script|<iframe|<image[^>]+https?:/i);
    }
    await assert.rejects(renderer.render("flowchart TD\n A -->"), /Parse error/);
    await assert.rejects(
      renderer.render("flowchart TD\n A@{ shape: nonexistent_shape }"),
      /nonexistent_shape/,
    );
  },
);

test(
  "explicit diagram validator reports bounded source and missing-file errors",
  { timeout: 60000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "abra-prepared-diagrams-"));
    t.onTestFinished(() => rm(root, { recursive: true, force: true }));
    const valid = join(root, "valid.mmd"),
      invalid = join(root, "invalid.mmd");
    await writeFile(valid, "flowchart LR\n A --> B");
    await writeFile(invalid, "flowchart LR\n A -->");
    const cli = resolve("apps/report/scripts/validate.ts"),
      tsx = resolve("node_modules/.bin/tsx");
    const result = await command(tsx, [cli, valid], { timeout: 30000 });
    assert.match(result.stdout, /OK .*valid.mmd/);
    await assert.rejects(command(tsx, [cli, invalid], { timeout: 30000 }), (error) => {
      assert.match(String(Reflect.get(error as Error, "stderr")), /FAIL .*invalid.mmd/);
      return true;
    });
    await assert.rejects(
      command(tsx, [cli, join(root, "missing.mmd")], { timeout: 30000 }),
      (error) => {
        assert.match(String(Reflect.get(error as Error, "stderr")), /ENOENT.*missing.mmd/);
        return true;
      },
    );
  },
);
