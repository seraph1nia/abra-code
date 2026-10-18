import * as Id from "../../src/identities.ts";
import { Clock, Deferred, Effect, Fiber, Schedule } from "effect";
import { TestClock } from "effect/testing";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProcessRunner, type CommandProgress } from "../../src/process.ts";
import { exists } from "../../src/filesystem.ts";
import { run } from "../effects.ts";
import { verificationCommand, VerificationSchema } from "../../src/config/contracts.ts";
import { decode } from "../../src/decode.ts";

test("Effect Runner preserves raw/trimmed output, environment, semantic exits and per-stream budgets", async () => {
  const runner = new ProcessRunner();
  assert.equal(
    await run(
      runner.run(
        Id.Executable.make(process.execPath),
        ["-e", "process.stdout.write('  raw \\n')"],
        Id.AbsolutePath.make("/tmp"),
        undefined,
        {
          trim: false,
        },
      ),
    ),
    "  raw \n",
  );
  assert.equal(
    await run(
      runner.run(
        Id.Executable.make(process.execPath),
        ["-e", "process.stdout.write(process.env.CREW_FIXTURE);process.exit(8)"],
        Id.AbsolutePath.make("/tmp"),
        { CREW_FIXTURE: "pending" },
        { allowed_exit_codes: [8] },
      ),
    ),
    "pending",
  );
  assert.equal(
    (
      await run(
        runner.run(
          Id.Executable.make(process.execPath),
          ["-e", "process.stdout.write('x'.repeat(1000));process.stderr.write('e'.repeat(1000))"],
          Id.AbsolutePath.make("/tmp"),
          undefined,
          { max_output_bytes: 1024 },
        ),
      )
    ).length,
    1000,
  );
  for (const stream of ["stdout", "stderr"])
    await assert.rejects(
      run(
        runner.run(
          Id.Executable.make(process.execPath),
          ["-e", `process.${stream}.write('x'.repeat(2048));setInterval(()=>{},1000)`],
          Id.AbsolutePath.make("/tmp"),
          undefined,
          { max_output_bytes: 1024 },
        ),
      ),
      new RegExp(`${stream} output exceeds`),
    );
  const progress: CommandProgress[] = [];
  await run(
    runner.run(
      Id.Executable.make(process.execPath),
      ["-e", "process.stdout.write('x'.repeat(20000))"],
      Id.AbsolutePath.make("/tmp"),
      undefined,
      {
        onProgress: (p) =>
          Effect.sync(() => {
            progress.push(p);
          }),
      },
    ),
  );
  assert.ok(progress.length > 0);
  assert.ok(progress.every((p) => p.tail.length <= 8192));
  await assert.rejects(
    run(
      runner.run(
        Id.Executable.make(process.execPath),
        ["-e", "process.exit(0)"],
        Id.AbsolutePath.make("/tmp"),
        undefined,
        {
          deadline_ms: -1,
        },
      ),
    ),
    /deadline/,
  );
  await assert.rejects(
    run(
      runner.run(
        Id.Executable.make(process.execPath),
        ["-e", "process.exit(0)"],
        Id.AbsolutePath.make("/tmp"),
        undefined,
        {
          allowed_exit_codes: [999],
        },
      ),
    ),
    /exit code/,
  );
});

test("deadline finalization stops the process before returning a timeout", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "abracode-command-deadline-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const ready = join(root, "ready");
  await assert.rejects(
    run(
      new ProcessRunner().run(
        Id.Executable.make(process.execPath),
        [
          "-e",
          "process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000)",
          ready,
        ],
        Id.AbsolutePath.make(root),
        undefined,
        { deadline_ms: 250 },
      ),
    ),
    /timed out/,
  );
  const pid = Number(await readFile(ready, "utf8"));
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
});

test("verification deadline can exceed the former blanket deadline using a controlled clock", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "abracode-long-check-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const ready = join(root, "ready"),
    done = join(root, "done");
  const clock = await run(TestClock.make());
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const completed = Deferred.makeUnsafe<void>();
        const command = new ProcessRunner()
          .run(
            Id.Executable.make(process.execPath),
            [
              "-e",
              "const fs=require('node:fs');fs.writeFileSync(process.argv[1],'ready');setInterval(()=>{if(fs.existsSync(process.argv[2]))process.exit(0)},10)",
              ready,
              done,
            ],
            Id.AbsolutePath.make(root),
            undefined,
            { deadline_ms: 300_000 },
          )
          .pipe(
            Effect.tap(() => Deferred.succeed(completed, undefined)),
            Effect.provideService(Clock.Clock, clock),
          );
        const fiber = yield* command.pipe(Effect.forkScoped);
        yield* exists(ready).pipe(
          Effect.repeat({ schedule: Schedule.spaced(10), until: Boolean }),
          Effect.timeout("5 seconds"),
        );
        yield* clock.adjust(121_000);
        assert.equal(yield* Deferred.isDone(completed), false);
        yield* Effect.promise(() => writeFile(done, "finish"));
        yield* Fiber.join(fiber);
      }),
    ),
  );
  const legacy = verificationCommand(["pnpm", "test"]);
  assert.equal(legacy.deadline_ms, 900_000);
  const structured = (
    await run(
      decode(VerificationSchema, [{ argv: ["pnpm", "test"], deadline_ms: 600_000 }], "checks"),
    )
  )[0];
  assert.equal(verificationCommand(structured).deadline_ms, 600_000);
  await assert.rejects(
    run(decode(VerificationSchema, [{ argv: ["test"], deadline_ms: 0 }], "checks")),
    /deadline_ms/,
  );
});

test("an externally signalled command retains its actual termination reason", async () => {
  await assert.rejects(
    run(
      new ProcessRunner().run(
        Id.Executable.make(process.execPath),
        ["-e", "process.kill(process.pid, 'SIGTERM')"],
        Id.AbsolutePath.make("/tmp"),
      ),
    ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /SIGTERM/);
      return true;
    },
  );
});
