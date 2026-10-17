import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { test } from "vite-plus/test";

test("doctor checks the absolute central browser version without provisioning or global fallback", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "abracode-browser-doctor-"));
  t.onTestFinished(() => rm(home, { recursive: true, force: true }));
  const bin = join(home, "node_modules/.bin");
  await mkdir(bin, { recursive: true });
  await writeFile(
    join(home, "abracode.yaml"),
    "version: 1\nmodels: { default: { providerID: fixture, id: gpt-fixture } }\n",
  );
  const log = join(home, "browser-calls.jsonl");
  const central = join(bin, "agent-browser");
  await writeFile(
    central,
    `#!${process.execPath}
import { appendFileSync } from 'node:fs';
appendFileSync(process.env.BROWSER_DIAGNOSTIC_LOG, JSON.stringify(process.argv.slice(2))+'\\n');
if (JSON.stringify(process.argv.slice(2)) !== '["--version"]') process.exit(23);
console.log('agent-browser 0.39.1');
`,
    { mode: 0o755 },
  );
  const doctor = () =>
    promisify(execFile)(resolve("node_modules/.bin/tsx"), [resolve("scripts/doctor.ts")], {
      cwd: home,
      env: {
        ...process.env,
        ABRACODE_HOME: home,
        ABRACODE_CONFIG: join(home, "abracode.yaml"),
        BROWSER_DIAGNOSTIC_LOG: log,
      },
      timeout: 15000,
    }).catch((error: { stdout: string; stderr: string }) => error);
  const result = await doctor();
  assert.match(result.stdout, new RegExp(`${central}: agent-browser 0\\.39\\.1`));
  assert.equal(await readFile(log, "utf8"), '["--version"]\n');
  assert.match(result.stdout, /pnpm browser:install/);
  await rm(central);
  const missing = await doctor();
  assert.match(missing.stderr, /Restore the central install/);
  assert.match(missing.stderr, /pnpm rebuild agent-browser/);
  assert.equal(await readFile(log, "utf8"), '["--version"]\n');
});
