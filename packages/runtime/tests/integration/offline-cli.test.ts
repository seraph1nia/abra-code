import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { removeFixture } from "../helpers/resources.ts";
const base = "version: 1\nmodels:\n  default: { providerID: example, id: basic, variant: high }\n";

test("offline CLI redacts command secrets and doctor reports missing core without creating state", async (t) => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const command = promisify(execFile);
  const root = await mkdtemp(join(tmpdir(), "abracode-cli-"));
  t.onTestFinished(() => removeFixture(root));
  const env = { ...process.env, ABRACODE_HOME: root, ABRACODE_CONFIG: "selected.yaml" };
  const cli = (script: string, args: string[] = []) =>
    command(resolve("node_modules/.bin/tsx"), [resolve("scripts", script), ...args], { env });
  await writeFile(
    join(root, "selected.yaml"),
    base +
      "repositories:\n  - id: safe\n    path: /uninspected\n    delivery: branch\n    verification: [[command, secret-marker]]\n",
  );
  const shown = await cli("config.ts", ["--show", "--json"]);
  assert.equal(shown.stdout.includes("secret-marker"), false);
  assert.equal(JSON.parse(shown.stdout).models.review.source, "models.default");
  await assert.rejects(cli("doctor.ts"), (error) => {
    const output =
      String((error as { stdout: string }).stdout) + String((error as { stderr: string }).stderr);
    assert.match(output, /unverified/);
    assert.match(output, /node_modules\/\.bin\/opencode/);
    assert.match(output, /No browser was launched/);
    return true;
  });
  assert.deepEqual(await readdir(root), ["selected.yaml"]);
  await writeFile(join(root, "selected.yaml"), base + "surprise: value\n");
  await assert.rejects(cli("config.ts", ["--json"]));
  assert.deepEqual(await readdir(root), ["selected.yaml"]);
});
