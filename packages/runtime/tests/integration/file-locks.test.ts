import fsExt from "fs-ext";
import { test, vi } from "vite-plus/test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Deferred, Effect, Exit, Fiber, Scope } from "effect";
import { AbsolutePath, LockKey } from "@abracode/contracts/identities";
import { FileLocks } from "../../src/storage/lock.ts";
import { run } from "../effects.ts";

async function holder(
  t: { onTestFinished: (cleanup: () => Promise<void>) => void },
  root: string,
  shared = false,
  nodeBinary?: string,
) {
  const owner = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      resolve("packages/runtime/tests/helpers/lock-owner.ts"),
      root,
      shared ? "shared" : "exclusive",
      nodeBinary ?? "",
    ],
    {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const exited = new Promise<void>((done) => owner.once("exit", () => done()));
  t.onTestFinished(async () => {
    if (owner.exitCode === null && owner.signalCode === null) {
      owner.kill("SIGKILL");
      await exited;
    }
  });
  await new Promise<void>((done, reject) => {
    let output = "";
    owner.stdout!.on("data", (chunk) => {
      output += chunk.toString();
      if (output.split("\n").includes("owned")) done();
    });
    owner.once("error", reject);
    owner.once("exit", (code) => reject(new Error(`Owner exited before readiness: ${code}`)));
  });
  return { owner, exited };
}

const hosts = [
  { name: "in-process", nodeBinary: undefined },
  { name: "Node helper", nodeBinary: process.execPath },
];

test.for(hosts)(
  "$name owner excludes another process and releases after owner SIGKILL",
  async ({ nodeBinary }, t) => {
    const root = await mkdtemp(join(tmpdir(), "abra-lock-owner-"));
    t.onTestFinished(() => rm(root, { recursive: true, force: true }));
    const { owner, exited } = await holder(t, root, false, nodeBinary);
    const other = new FileLocks(AbsolutePath.make(root), nodeBinary);
    await assert.rejects(
      run(other.with(LockKey.make("independent-owner"), () => Effect.void, { waitSeconds: 0 })),
      { code: "LOCKED" },
    );
    owner.kill("SIGKILL");
    await exited;
    // A helper observes stdin EOF after parent death; neither host needs stale-lock recovery.
    await run(other.with(LockKey.make("independent-owner"), () => Effect.void, { waitSeconds: 2 }));
  },
);

test.for(hosts)(
  "$name shared owners coexist and exclude writers until both exit",
  async ({ nodeBinary }, t) => {
    const root = await mkdtemp(join(tmpdir(), "abra-lock-shared-"));
    t.onTestFinished(() => rm(root, { recursive: true, force: true }));
    const first = await holder(t, root, true, nodeBinary);
    const second = await holder(t, root, true, nodeBinary);
    const locks = new FileLocks(AbsolutePath.make(root), nodeBinary);
    const key = LockKey.make("independent-owner");
    await assert.rejects(run(locks.with(key, () => Effect.void, { waitSeconds: 0 })), {
      code: "LOCKED",
    });
    first.owner.kill("SIGKILL");
    await first.exited;
    await run(locks.with(key, () => Effect.void, { waitSeconds: 0, shared: true }));
    await assert.rejects(run(locks.with(key, () => Effect.void, { waitSeconds: 0 })), {
      code: "LOCKED",
    });
    second.owner.kill("SIGKILL");
    await second.exited;
    await run(locks.with(key, () => Effect.void, { waitSeconds: 2 }));
  },
);

test("exclusive ownership excludes shared readers, bounds waits and cancels pending acquisition", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "abra-lock-wait-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const scope = Scope.makeUnsafe();
  t.onTestFinished(() => run(Scope.close(scope, Exit.void)));
  const locks = new FileLocks(AbsolutePath.make(root));
  const key = LockKey.make("controller");
  await run(locks.acquire(key).pipe(Effect.provideService(Scope.Scope, scope)));
  await assert.rejects(run(locks.with(key, () => Effect.void, { waitSeconds: 0, shared: true })), {
    code: "LOCKED",
  });
  await assert.rejects(
    run(
      locks.with(key, () => Effect.void, { waitSeconds: 0.05 }).pipe(Effect.timeout("2 seconds")),
    ),
    { code: "LOCKED" },
  );

  let entered = false;
  const attempted = Deferred.makeUnsafe<void>();
  const native = fsExt.flockSync;
  const attempt = vi.spyOn(fsExt, "flockSync").mockImplementation((fd, flags) => {
    Effect.runSync(Deferred.succeed(attempted, undefined));
    native(fd, flags);
  });
  t.onTestFinished(() => attempt.mockRestore());
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const waiter = yield* locks
          .with(key, () =>
            Effect.sync(() => {
              entered = true;
            }),
          )
          .pipe(Effect.forkScoped);
        yield* Deferred.await(attempted);
        yield* Fiber.interrupt(waiter).pipe(Effect.timeout("2 seconds"));
        yield* Scope.close(scope, Exit.void);
        const enteredOwner = yield* Deferred.make<void>();
        const owner = yield* locks
          .with(key, () =>
            Deferred.succeed(enteredOwner, undefined).pipe(Effect.andThen(Effect.never)),
          )
          .pipe(Effect.forkScoped);
        yield* Deferred.await(enteredOwner);
        yield* Fiber.interrupt(owner);
        yield* locks.with(key, () => Effect.void, { waitSeconds: 0 });
      }),
    ),
  );
  assert.equal(entered, false);
});

test("a waiting acquisition succeeds after release and native failures retain LOCK_ERROR", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "abra-lock-retry-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const { owner, exited } = await holder(t, root);
  const locks = new FileLocks(AbsolutePath.make(root));
  const key = LockKey.make("independent-owner");
  const attempted = Deferred.makeUnsafe<void>();
  const native = fsExt.flockSync;
  const attempt = vi.spyOn(fsExt, "flockSync").mockImplementation((fd, flags) => {
    Effect.runSync(Deferred.succeed(attempted, undefined));
    native(fd, flags);
  });
  t.onTestFinished(() => attempt.mockRestore());
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const waiter = yield* locks
          .with(key, () => Effect.succeed("acquired"), { waitSeconds: 2 })
          .pipe(Effect.forkScoped);
        yield* Deferred.await(attempted);
        owner.kill("SIGKILL");
        yield* Effect.promise(() => exited);
        assert.equal(yield* Fiber.join(waiter), "acquired");
      }),
    ),
  );
  attempt.mockImplementationOnce(() => {
    throw Object.assign(new Error("native failure"), { code: "EIO" });
  });
  await assert.rejects(run(locks.with(key, () => Effect.void)), { code: "LOCK_ERROR" });
  await run(locks.with(key, () => Effect.void, { waitSeconds: 0 }));
});

test("the Node helper bounds contention, cancels waiters and reports startup failures", async (t) => {
  const root = AbsolutePath.make(await mkdtemp(join(tmpdir(), "abra-lock-node-")));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const scope = Scope.makeUnsafe();
  t.onTestFinished(() => run(Scope.close(scope, Exit.void)));
  const locks = new FileLocks(root, process.execPath);
  const key = LockKey.make("controller");
  await run(new FileLocks(root).acquire(key).pipe(Effect.provideService(Scope.Scope, scope)));
  await assert.rejects(run(locks.with(key, () => Effect.void, { waitSeconds: 0.05 })), {
    code: "LOCKED",
  });
  let entered = false;
  await run(
    Effect.scoped(
      Effect.gen(function* () {
        const waiter = yield* locks
          .with(key, () =>
            Effect.sync(() => {
              entered = true;
            }),
          )
          .pipe(Effect.forkScoped);
        yield* Effect.sleep(100);
        yield* Fiber.interrupt(waiter).pipe(Effect.timeout("2 seconds"));
        yield* Scope.close(scope, Exit.void);
        yield* locks.with(key, () => Effect.void, { waitSeconds: 0 });
      }),
    ),
  );
  assert.equal(entered, false);
  await mkdir(join(root, "failed.lock"));
  await assert.rejects(
    run(locks.with(LockKey.make("failed"), () => Effect.void)),
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "LOCK_ERROR" &&
      "details" in error &&
      String(error.details).includes("EISDIR"),
  );
  await assert.rejects(
    run(new FileLocks(root, join(root, "missing-node")).with(key, () => Effect.void)),
    { code: "ENOENT" },
  );
});
