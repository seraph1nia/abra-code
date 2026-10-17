import { LockKey, AbsolutePath } from "../identities.ts";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { CrewError, identifier } from "../domain.ts";
import { domainEffect } from "../effect.ts";
export interface Locks {
  with<A, E, R>(
    key: LockKey,
    action: () => Effect.Effect<A, E, R>,
    options?: { waitSeconds?: number },
  ): Effect.Effect<A, E | CrewError, R>;
}
// Kernel advisory locks coordinate independent controllers and release on crash.
export class FileLocks implements Locks {
  constructor(private root: AbsolutePath) {}
  with<A, E, R>(
    key: LockKey,
    action: () => Effect.Effect<A, E, R>,
    options?: { waitSeconds?: number },
  ) {
    return Effect.scoped(
      Effect.gen({ self: this }, function* () {
        yield* this.acquire(key, options?.waitSeconds ?? 30);
        return yield* action();
      }),
    );
  }
  acquire(key: LockKey, waitSeconds = 0) {
    return domainEffect(
      Effect.gen({ self: this }, function* () {
        identifier(key);
        yield* Effect.tryPromise({
          try: () => mkdir(this.root, { recursive: true, mode: 0o700 }),
          catch: CrewError.from,
        });
        const child = yield* Effect.acquireRelease(
          Effect.sync(() =>
            spawn(
              "flock",
              [
                "--no-fork",
                ...(waitSeconds ? ["-w", String(waitSeconds)] : ["-n"]),
                join(this.root, `${key}.lock`),
                process.env.ABRACODE_NODE_BINARY ?? "node",
                "-e",
                'process.stdout.write("locked\\n");process.stdin.resume();process.stdin.on("end",()=>process.exit(0))',
              ],
              { stdio: ["pipe", "pipe", "pipe"] },
            ),
          ),
          (child) =>
            Effect.callback<void>((resume) => {
              if (child.exitCode !== null || child.signalCode !== null || !child.pid)
                return resume(Effect.void);
              child.once("close", () => resume(Effect.void));
              child.stdin.end();
              // Also stop a flock still waiting for ownership; EOF alone cannot stop it.
              child.kill("SIGTERM");
            }),
        );
        yield* Effect.callback<void, CrewError>((resume) => {
          const ready = () => resume(Effect.void);
          const failed = () =>
            resume(
              Effect.fail(
                new CrewError("LOCKED", `${key} is owned by another controller; retry later`),
              ),
            );
          const error = (cause: Error) => resume(Effect.fail(CrewError.from(cause)));
          child.stdout.once("data", ready);
          child.once("error", error);
          child.once("exit", failed);
          return Effect.sync(() => {
            child.stdout.off("data", ready);
            child.off("error", error);
            child.off("exit", failed);
          });
        });
      }),
    );
  }
}
