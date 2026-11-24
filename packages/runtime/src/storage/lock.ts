import { LockKey, AbsolutePath } from "@abracode/contracts/identities";
import { spawn } from "node:child_process";
import { mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Clock, Effect } from "effect";
import { CrewError, ensure, identifier } from "../domain.ts";
import { domainEffect } from "../effect.ts";
export interface Locks {
  with<A, E, R>(
    key: LockKey,
    action: () => Effect.Effect<A, E, R>,
    options?: { waitSeconds?: number; shared?: boolean },
  ): Effect.Effect<A, E | CrewError, R>;
}
// Kernel advisory locks coordinate independent controllers and release on crash.
export class FileLocks implements Locks {
  constructor(
    private root: AbsolutePath,
    // OpenCode's Bun host cannot execute fs-ext's NAN error path. Keep that
    // binding in the Node runtime it was compiled for; Node callers use it directly.
    private nodeBinary = process.versions.bun
      ? (process.env.ABRACODE_NODE_BINARY ?? "node")
      : undefined,
  ) {}
  with<A, E, R>(
    key: LockKey,
    action: () => Effect.Effect<A, E, R>,
    options?: { waitSeconds?: number; shared?: boolean },
  ) {
    return Effect.scoped(
      Effect.gen({ self: this }, function* () {
        yield* this.acquire(key, options?.waitSeconds ?? 30, options?.shared ?? false);
        return yield* action();
      }),
    );
  }
  acquire(key: LockKey, waitSeconds = 0, shared = false) {
    return domainEffect(
      Effect.gen({ self: this }, function* () {
        identifier(key);
        ensure(
          Number.isFinite(waitSeconds) && waitSeconds >= 0,
          "LOCK_ERROR",
          "Lock wait must be a finite nonnegative number of seconds",
        );
        yield* Effect.tryPromise({
          try: () => mkdir(this.root, { recursive: true, mode: 0o700 }),
          catch: CrewError.from,
        });
        if (this.nodeBinary !== undefined)
          return yield* this.acquireInNode(this.nodeBinary, key, waitSeconds, shared);
        const { default: fsExt } = yield* Effect.tryPromise({
          try: () => import("fs-ext"),
          catch: (cause) => new CrewError("LOCK_ERROR", "Native lock binding unavailable", cause),
        });
        const file = yield* Effect.acquireRelease(
          Effect.tryPromise({
            try: () => open(join(this.root, `${key}.lock`), "a", 0o600),
            catch: CrewError.from,
          }),
          // Closing the owning descriptor releases the lock. Never unlink the
          // path: another process may already have opened the same inode.
          (file) => Effect.tryPromise(() => file.close()).pipe(Effect.ignore),
        );
        const started = yield* Clock.monotonicTimeNanos;
        while (true) {
          // Only nonblocking syscalls run synchronously. Blocking flock work in
          // libuv cannot be cancelled safely and could outlive this descriptor.
          const acquired = yield* Effect.try({
            try: () => {
              try {
                fsExt.flockSync(file.fd, shared ? "shnb" : "exnb");
                return true;
              } catch (cause) {
                const error = CrewError.from(cause);
                if (error.code === "EAGAIN" || error.code === "EWOULDBLOCK") return false;
                throw cause;
              }
            },
            catch: (cause) =>
              new CrewError("LOCK_ERROR", `Lock acquisition failed for ${key}`, cause),
          });
          if (acquired) return;
          const elapsed = Number((yield* Clock.monotonicTimeNanos) - started) / 1_000_000;
          const remaining = waitSeconds * 1000 - elapsed;
          if (remaining <= 0)
            return yield* new CrewError("LOCKED", `${key} is busy; observe current progress`);
          yield* Effect.sleep(Math.min(25, remaining));
        }
      }),
    );
  }
  private acquireInNode(node: string, key: LockKey, waitSeconds: number, shared: boolean) {
    return Effect.gen({ self: this }, function* () {
      const child = yield* Effect.acquireRelease(
        Effect.sync(() =>
          spawn(
            node,
            [
              fileURLToPath(new URL("./lock-holder.cjs", import.meta.url)),
              join(this.root, `${key}.lock`),
              shared ? "shared" : "exclusive",
              String(waitSeconds),
            ],
            { stdio: ["pipe", "pipe", "pipe"] },
          ),
        ),
        (child) =>
          Effect.callback<void>((resume) => {
            if (child.exitCode !== null || child.signalCode !== null || !child.pid)
              return resume(Effect.void);
            let done = false;
            const finish = () => {
              if (done) return;
              done = true;
              clearTimeout(forceKill);
              child.off("close", finish);
              child.off("exit", finish);
              child.off("error", finish);
              resume(Effect.void);
            };
            const forceKill = setTimeout(() => {
              if (child.exitCode === null && child.signalCode === null) {
                try {
                  child.kill("SIGKILL");
                } catch {
                  // Process already exited between check and SIGKILL.
                }
              }
            }, 1000);
            forceKill.unref?.();
            child.once("close", finish);
            child.once("exit", finish);
            child.once("error", finish);
            child.stdin.end();
            try {
              child.kill("SIGTERM");
            } catch {
              finish();
            }
          }),
      );
      yield* Effect.callback<void, CrewError>((resume) => {
        let stderr = "";
        const diagnostic = (data: Buffer) => {
          stderr = (stderr + data.toString()).slice(-8192);
        };
        const ready = () => resume(Effect.void);
        const failed = (code: number | null) =>
          resume(
            Effect.fail(
              code === 75
                ? new CrewError("LOCKED", `${key} is busy; observe current progress`)
                : new CrewError("LOCK_ERROR", `Node lock holder failed for ${key}`, stderr),
            ),
          );
        const error = (cause: Error) => resume(Effect.fail(CrewError.from(cause)));
        child.stderr.on("data", diagnostic);
        child.stdout.once("data", ready);
        child.once("error", error);
        child.once("exit", failed);
        return Effect.sync(() => {
          child.stderr.off("data", diagnostic);
          child.stdout.off("data", ready);
          child.off("error", error);
          child.off("exit", failed);
        });
      });
    });
  }
}
