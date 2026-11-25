import { test, vi } from "vite-plus/test";
import { Effect } from "effect";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fixture, planned } from "../fixtures.ts";
import { run } from "../effects.ts";

const execute = promisify(execFile);

test("independent processes preserve disjoint patched and owned writes and refuse stale replacements", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(planned(f));
  const file = join(f.root, "execution.json");
  await writeFile(file, JSON.stringify(e));
  for (const mode of ["owned", "replace"] as const) {
    const before = JSON.parse(await readFile(file, "utf8"));
    if (mode === "replace") {
      before.retry_instructions = "Before replacement";
      before.error_or_recovery_reason = "Before replacement";
      await writeFile(file, JSON.stringify(before));
    }
    const barrier = join(f.root, mode);
    const fields = ["retry_instructions", "error_or_recovery_reason"];
    const children = fields.map((field) =>
      execute(
        resolve("node_modules/.bin/tsx"),
        [
          resolve("packages/runtime/tests/helpers/record-writer.ts"),
          file,
          join(f.root, "record-locks"),
          barrier,
          e.issue_id,
          field,
          mode,
        ],
        { timeout: 15_000 },
      ),
    );
    const finished = Promise.allSettled(children);
    t.onTestFinished(() => {
      for (const child of children) if (child.child.exitCode === null) child.child.kill("SIGTERM");
    });
    // Both processes must hold the same old revision before either may commit.
    const deadline = Date.now() + 10_000;
    while (
      !(
        await Promise.all(
          fields.map((field) =>
            access(`${barrier}.${field}.ready`).then(
              () => true,
              () => false,
            ),
          ),
        )
      ).every(Boolean)
    ) {
      assert.ok(Date.now() < deadline, "Record writer did not reach its barrier");
      await new Promise((done) => setTimeout(done, 5));
    }
    await writeFile(`${barrier}.go`, "go");
    const outcomes = (await finished).map((outcome) => {
      if (outcome.status === "rejected") throw outcome.reason;
      return JSON.parse(outcome.value.stdout);
    });
    const after = JSON.parse(await readFile(file, "utf8"));
    assert.equal(after.control_generation, before.control_generation);
    assert.deepEqual(after.operation, before.operation);
    if (mode === "owned") {
      assert.equal(after.retry_instructions, "retry_instructions");
      assert.equal(after.error_or_recovery_reason, "error_or_recovery_reason");
      assert.deepEqual(
        outcomes.map((outcome) => outcome.status),
        ["committed", "committed"],
      );
      assert.equal(after.revision, before.revision + 2);
    } else {
      assert.deepEqual(
        new Set(outcomes.map((outcome) => outcome.status)),
        new Set(["STALE_REVISION", "committed"]),
      );
      assert.equal(after.revision, before.revision + 1);
      for (const [index, field] of fields.entries())
        assert.equal(after[field], outcomes[index].status === "committed" ? field : before[field]);
    }
  }
});

test("admission retries an intervening commit and reuses its active index under the exclusive lock", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(planned(f));
  const store = f.records.store;
  const entries = store.entries.bind(store);
  let scans = 0;
  const spy = vi.spyOn(store, "entries").mockImplementation((prefix) =>
    entries(prefix).pipe(
      Effect.tap(() => {
        assert.equal(f.locks.held, false);
        if (prefix !== "execution/") return Effect.void;
        return ++scans === 1
          ? f.records.commitOwned(e, { retry_instructions: "peer update" })
          : Effect.void;
      }),
    ),
  );
  t.onTestFinished(() => spy.mockRestore());
  const current = await run(
    f.records.withActiveIndex(() => f.records.withActiveIndex(() => f.records.capacityRecords())),
  );
  assert.equal(scans, 2);
  assert.equal(
    current.executions.find((entry) => entry.issue_id === e.issue_id)?.retry_instructions,
    "peer update",
  );
});
