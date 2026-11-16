import { test, vi } from "vite-plus/test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { dirname } from "node:path";
import { Effect } from "effect";
import { CrewError } from "../../src/domain.ts";
import { ProcessRunner } from "../../src/process.ts";
import { fixture } from "../fixtures.ts";
import { run } from "../effects.ts";

test("a partial fixture setup failure removes its acquired root", async () => {
  let root = "";
  const spy = vi
    .spyOn(ProcessRunner.prototype, "run")
    .mockImplementationOnce((_file, _args, cwd) => {
      root = dirname(cwd);
      return Effect.fail(new CrewError("FIXTURE_PROBE", "Injected setup failure"));
    });
  try {
    await assert.rejects(run(fixture), /Injected setup failure/);
    assert.ok(root.includes("abracode-unit-"));
    await assert.rejects(access(root), { code: "ENOENT" });
  } finally {
    spy.mockRestore();
  }
});

test("a controller shutdown failure still removes the fixture root", async () => {
  const f = await run(fixture);
  f.controller.close = () => Effect.die(new Error("Injected close failure"));
  await assert.rejects(run(f.close()), /Injected close failure/);
  await assert.rejects(access(f.root), { code: "ENOENT" });
});
