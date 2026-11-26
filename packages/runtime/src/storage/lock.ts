import { tryDomainValue } from "../effect.ts";
import { StorageError } from "../errors.ts";
import { LockKey, AbsolutePath } from "@abracode/contracts/identities";
import { ChildProcess } from "effect/process";
import { processDriver } from "../platform.ts";
import { mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Config, Schedule, Effect, Fiber, Stream } from "effect";
import { CrewError, identifier } from "../domain.ts";
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
    private nodeBinary?: string,
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
    return Effect.gen({ self: this }, function* () {
      yield* tryDomainValue(identifier, key);
      if (!(Number.isFinite(waitSeconds) && waitSeconds >= 0))
        return yield* new StorageError(
          "LOCK_ERROR",
          "Lock wait must be a finite nonnegative number of seconds",
        );
      yield* Effect.tryPromise({
        try: () => mkdir(this.root, { recursive: true, mode: 0o700 }),
        catch: CrewError.from,
      });
      if (this.nodeBinary !== undefined || process.versions.bun) {
        const node =
          this.nodeBinary ??
          (yield* Config.String("ABRACODE_NODE_BINARY").pipe(
            Config.withDefault("node"),
            Effect.mapError(
              (cause) =>
                new StorageError("LOCK_ERROR", "Cannot read lock holder executable", cause),
            ),
          ));
        return yield* this.acquireInNode(node, key, waitSeconds, shared);
      }
      const { default: fsExt } = yield* Effect.tryPromise({
        try: () => import("fs-ext"),
        catch: (cause) => new StorageError("LOCK_ERROR", "Native lock binding unavailable", cause),
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
      const attempt = Effect.try({
        try: () => fsExt.flockSync(file.fd, shared ? "shnb" : "exnb"),
        catch: (cause) => {
          const error = CrewError.from(cause);
          return ["EAGAIN", "EWOULDBLOCK"].includes(error.code)
            ? new StorageError("LOCKED", `${key} is busy; observe current progress`)
            : new StorageError("LOCK_ERROR", `Lock acquisition failed for ${key}`, cause);
        },
      });
      if (waitSeconds === 0) return yield* attempt;
      return yield* attempt.pipe(
        Effect.retry({
          while: (error) => error.code === "LOCKED",
          schedule: Schedule.spaced("25 millis"),
        }),
        Effect.timeoutOrElse({
          duration: waitSeconds * 1000,
          orElse: () =>
            Effect.fail(new StorageError("LOCKED", `${key} is busy; observe current progress`)),
        }),
      );
    });
  }
  private acquireInNode(node: string, key: LockKey, waitSeconds: number, shared: boolean) {
    return Effect.gen({ self: this }, function* () {
      const spawner = yield* processDriver;
      const child = yield* spawner
        .spawn(
          ChildProcess.make(
            node,
            [
              fileURLToPath(new URL("./lock-holder.cjs", import.meta.url)),
              join(this.root, `${key}.lock`),
              shared ? "shared" : "exclusive",
              String(waitSeconds),
            ],
            { stdin: "pipe", stdout: "pipe", stderr: "pipe", forceKillAfter: "1 second" },
          ),
        )
        .pipe(
          Effect.mapError(
            (cause) =>
              new CrewError(
                cause.reason._tag === "NotFound" ? "ENOENT" : "LOCK_ERROR",
                `Cannot start lock holder for ${key}`,
                cause,
              ),
          ),
        );
      let diagnostic = "";
      const stderr = yield* child.stderr.pipe(
        Stream.runForEach((chunk) =>
          Effect.sync(() => {
            diagnostic = (diagnostic + Buffer.from(chunk.subarray(-8192)).toString()).slice(-8192);
          }),
        ),
        Effect.forkScoped,
      );
      let frame = "";
      yield* child.stdout.pipe(
        Stream.runForEach((chunk) =>
          Effect.gen(function* () {
            if (frame.length + chunk.length > 7)
              return yield* new StorageError(
                "LOCK_ERROR",
                `Invalid lock acknowledgement for ${key}`,
              );
            frame += Buffer.from(chunk).toString("latin1");
            if (!"locked\n".startsWith(frame))
              return yield* new StorageError(
                "LOCK_ERROR",
                `Invalid lock acknowledgement for ${key}`,
              );
          }),
        ),
        Effect.timeoutOrElse({
          duration: (waitSeconds + 5) * 1000,
          orElse: () =>
            Effect.fail(new StorageError("LOCK_ERROR", `Lock holder startup timed out for ${key}`)),
        }),
      );
      if (frame === "locked\n" && (yield* child.isRunning)) return;
      const code = yield* child.exitCode.pipe(
        Effect.timeoutOrElse({
          duration: "1 second",
          orElse: () =>
            Effect.fail(
              new StorageError("LOCK_ERROR", `Incomplete lock acknowledgement for ${key}`),
            ),
        }),
      );
      yield* Fiber.join(stderr);
      return yield* code === 75
        ? new StorageError("LOCKED", `${key} is busy; observe current progress`)
        : new StorageError("LOCK_ERROR", `Node lock holder failed for ${key}`, diagnostic);
    }).pipe(Effect.mapError(CrewError.from));
  }
}
