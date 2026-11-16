import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { Worker } from "node:worker_threads";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compilerRunning } from "../operational/resources.ts";

test(
  "owned compiler observation finds children created by another service thread",
  { skip: process.platform !== "linux" },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "abra-compiler-observation-"));
    t.onTestFinished(() => rm(root, { recursive: true, force: true }));
    const directory = join(root, ".abracode/reports/.scratch/build-fixture");
    await mkdir(directory, { recursive: true });
    const worker = new Worker(
      `
    const {parentPort,workerData}=require('node:worker_threads');
    const {spawn}=require('node:child_process');
    const child=spawn(process.execPath,['-e','setTimeout(()=>{},15000)','build',workerData.directory],{stdio:'ignore'});
    child.once('spawn',()=>parentPort.postMessage(child.pid));
    parentPort.on('message',()=>child.kill('SIGTERM'));
    child.once('exit',()=>process.exit(0));
  `,
      { eval: true, workerData: { directory } },
    );
    const [pid] = (await once(worker, "message")) as [number];
    t.onTestFinished(async () => {
      const exit = once(worker, "exit");
      worker.postMessage("stop");
      await exit;
    });
    const progress = join(root, "progress.jsonl");
    assert.equal(await compilerRunning(process.pid, root, progress), false);
    await writeFile(
      progress,
      JSON.stringify({ pid: process.pid, directory, stdout_bytes: 1, stderr_bytes: 0 }) + "\n",
    );
    assert.equal(await compilerRunning(process.pid, root, progress), true);
    assert.ok(pid > 0);
  },
);
