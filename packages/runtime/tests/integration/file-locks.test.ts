import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Effect } from "effect";
import { AbsolutePath, LockKey } from "../../src/identities.ts";
import { FileLocks } from "../../src/storage/lock.ts";
import { run } from "../effects.ts";

test("the kernel holder excludes another process and releases after owner SIGKILL", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "abra-lock-owner-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const env = { ...process.env };
  delete env.ABRACODE_NODE_BINARY;
  const owner = spawn(
    process.execPath,
    ["--import", "tsx", resolve("packages/runtime/tests/helpers/lock-owner.ts"), root],
    {
      cwd: process.cwd(),
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const exited = new Promise<void>((done) => owner.once("exit", () => done()));
  t.onTestFinished(async () => {
    // Only the process group created by this test; also covers an assertion
    // failure before the owner dies and any surviving kernel holder.
    try {
      if (owner.pid) process.kill(-owner.pid, "SIGKILL");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
    if (owner.exitCode === null && owner.signalCode === null) await exited;
  });
  await new Promise<void>((done, reject) => {
    owner.stdout!.once("data", () => done());
    owner.once("error", reject);
    owner.once("exit", (code) => reject(new Error(`Owner exited before readiness: ${code}`)));
  });
  const other = new FileLocks(AbsolutePath.make(root));
  await assert.rejects(
    run(other.with(LockKey.make("independent-owner"), () => Effect.void, { waitSeconds: 0 })),
    { code: "LOCKED" },
  );
  owner.kill("SIGKILL");
  await exited;
  // Killing only the parent leaves its shell holder to observe pipe EOF. It
  // must release the same kernel lock without an external lease cleanup action.
  await run(other.with(LockKey.make("independent-owner"), () => Effect.void, { waitSeconds: 2 }));
});
