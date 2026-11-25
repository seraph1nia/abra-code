import { type AbsolutePath, type Executable } from "@abracode/contracts/identities";
import { Clock, Effect, Semaphore, Stream, type Schema } from "effect";
import { ChildProcess } from "effect/process";
import { provideProcess } from "./platform.ts";
import { CrewError } from "./domain.ts";
import { domainEffect } from "./effect.ts";
import { decodeJSON } from "./decode.ts";

export interface CommandProgress {
  at: number;
  stdout_bytes: number;
  stderr_bytes: number;
  tail: string;
}
export interface RunOptions {
  trim?: boolean;
  deadline_ms?: number;
  max_output_bytes?: number;
  allowed_exit_codes?: readonly number[];
  onProgress?: (progress: CommandProgress) => Effect.Effect<void, CrewError>;
}
export interface Runner {
  run(
    file: Executable,
    args: string[],
    cwd: AbsolutePath,
    env?: NodeJS.ProcessEnv,
    options?: RunOptions,
  ): Effect.Effect<string, CrewError>;
}
export class ProcessRunner implements Runner {
  run(
    file: Executable,
    args: string[],
    cwd: AbsolutePath,
    env?: NodeJS.ProcessEnv,
    options?: RunOptions,
  ) {
    return domainEffect(
      Effect.suspend(() => {
        const deadline = options?.deadline_ms ?? 120_000;
        const limit = options?.max_output_bytes ?? 8 * 1024 * 1024;
        if (!Number.isSafeInteger(deadline) || deadline <= 0)
          return Effect.fail(
            new CrewError("COMMAND_OPTIONS", "Command deadline must be positive milliseconds"),
          );
        if (!Number.isSafeInteger(limit) || limit <= 0)
          return Effect.fail(
            new CrewError("COMMAND_OPTIONS", "Command output budget must be positive bytes"),
          );
        if (
          options?.allowed_exit_codes?.some(
            (code) => !Number.isInteger(code) || code < 0 || code > 255,
          )
        )
          return Effect.fail(new CrewError("COMMAND_OPTIONS", "Invalid semantic exit code"));
        return Effect.scoped(
          Effect.gen(function* () {
            const child = yield* ChildProcess.make(file, args, {
              cwd,
              env,
              extendEnv: true,
              detached: true,
              stdin: "ignore",
              stdout: "pipe",
              stderr: "pipe",
              killSignal: "SIGTERM",
              forceKillAfter: "1 second",
            });
            const PROGRESS_INTERVAL_NANOS = 1_000_000_000n;
            const TAIL_LIMIT = 8192;
            const progressLock = Semaphore.makeUnsafe(1);
            let stdoutSize = 0,
              stderrSize = 0;
            let lastProgressNanos: bigint | undefined;
            const tailChunks: Buffer[] = [];
            let tailBytes = 0;
            const pushTail = (buf: Buffer) => {
              if (buf.byteLength === 0) return;
              if (buf.byteLength >= TAIL_LIMIT) {
                tailChunks.length = 0;
                tailChunks.push(buf.subarray(-TAIL_LIMIT));
                tailBytes = TAIL_LIMIT;
                return;
              }
              tailChunks.push(buf);
              tailBytes += buf.byteLength;
              while (tailChunks.length > 1 && tailBytes - tailChunks[0]!.byteLength >= TAIL_LIMIT) {
                tailBytes -= tailChunks.shift()!.byteLength;
              }
            };
            const renderTail = () => {
              if (tailChunks.length === 0) return "";
              const combined =
                tailChunks.length === 1 ? tailChunks[0]! : Buffer.concat(tailChunks, tailBytes);
              const sliced =
                combined.byteLength > TAIL_LIMIT ? combined.subarray(-TAIL_LIMIT) : combined;
              tailChunks.length = 0;
              tailChunks.push(sliced);
              tailBytes = sliced.byteLength;
              return sliced.toString("utf8");
            };
            const collect = (stream: typeof child.stdout, kind: "stdout" | "stderr") =>
              Effect.gen(function* () {
                const chunks: Buffer[] = [];
                yield* Stream.runForEach(stream, (chunk) =>
                  Effect.gen(function* () {
                    const copied = Buffer.from(chunk);
                    chunks.push(copied);
                    yield* progressLock.withPermits(1)(
                      Effect.gen(function* () {
                        if (kind === "stdout") stdoutSize += copied.byteLength;
                        else stderrSize += copied.byteLength;
                        if ((kind === "stdout" ? stdoutSize : stderrSize) > limit)
                          return yield* new CrewError(
                            "COMMAND_OUTPUT_LIMIT",
                            `${file} ${args[0] ?? ""}: ${kind} output exceeds ${limit} bytes`,
                          );
                        if (!options?.onProgress) return;
                        pushTail(copied);
                        const nowNanos = yield* Clock.monotonicTimeNanos;
                        if (
                          lastProgressNanos === undefined ||
                          nowNanos - lastProgressNanos >= PROGRESS_INTERVAL_NANOS
                        ) {
                          lastProgressNanos = nowNanos;
                          const at = yield* Clock.currentTimeMillis;
                          yield* options.onProgress({
                            at,
                            stdout_bytes: stdoutSize,
                            stderr_bytes: stderrSize,
                            tail: renderTail(),
                          });
                        }
                      }),
                    );
                  }),
                );
                return Buffer.concat(chunks).toString("utf8");
              });
            const [out, err, code] = yield* Effect.all(
              [collect(child.stdout, "stdout"), collect(child.stderr, "stderr"), child.exitCode],
              { concurrency: "unbounded" },
            );
            if (code !== 0 && !options?.allowed_exit_codes?.includes(code))
              return yield* new CrewError(
                "COMMAND_FAILED",
                `${file} ${args[0] ?? ""}: exit ${code}: ${(err || out).slice(-8192)}`,
              );
            return options?.trim === false ? out : out.trim();
          }),
        ).pipe(
          provideProcess,
          Effect.mapError((cause) =>
            cause instanceof CrewError
              ? cause
              : new CrewError(
                  "COMMAND_FAILED",
                  `${file} ${args[0] ?? ""}: ${cause.reason._tag === "NotFound" ? "ENOENT" : cause.reason._tag}: ${cause.message}${cause.reason.cause instanceof Error ? `: ${cause.reason.cause.message}` : ""}`,
                ),
          ),
          Effect.timeoutOrElse({
            duration: deadline,
            orElse: () =>
              Effect.fail(
                new CrewError(
                  "COMMAND_TIMEOUT",
                  `${file} ${args[0] ?? ""}: timed out after ${deadline} ms`,
                ),
              ),
          }),
        );
      }),
    );
  }
}
export function json<S extends Schema.Constraint>(
  runner: Runner,
  schema: S,
  file: Executable,
  args: string[],
  cwd: AbsolutePath,
  env?: NodeJS.ProcessEnv,
) {
  return runner
    .run(file, args, cwd, env)
    .pipe(
      Effect.flatMap((output) =>
        decodeJSON(schema, output, `${file} ${args.slice(0, 2).join(" ")}`),
      ),
    );
}
