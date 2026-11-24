/* oxlint-disable effecttsgo/unstable-api-usage -- Pinned Effect 4.1.4 FileSystem and ChildProcess APIs; verified by integration tests. */
import { basename, dirname, join, resolve, sep } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Config, Effect, Exit, FileSystem, Ref, Scope, Semaphore, Stream } from "effect";
import { ChildProcess } from "effect/process";
import type { PlatformError } from "effect/PlatformError";
import { CrewError, type Config as AppConfig } from "../domain.ts";
import { provideFileSystem, provideProcess } from "../platform.ts";

export const memoryVersion = "1.0.0";
const unavailable = () =>
  new CrewError(
    "MEMORY_UNAVAILABLE",
    "Check the local Basic Memory 1.0.0 executable and installation directory, then retry.",
  );
export const memoryError = (cause: unknown) => (cause instanceof CrewError ? cause : unavailable());
const contains = (parent: string, child: string) =>
  parent === child || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);

function isNotFound(error: PlatformError) {
  return error.reason._tag === "NotFound";
}

function physicalPath(path: string): Effect.Effect<string, PlatformError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.realPath(path).pipe(
      Effect.catchIf(
        (error) => isNotFound(error) && dirname(path) !== path,
        () =>
          physicalPath(dirname(path)).pipe(Effect.map((parent) => join(parent, basename(path)))),
      ),
    );
  });
}

export function memoryDirectoryEffect(
  config: AppConfig,
  projects: readonly string[],
): Effect.Effect<string, CrewError> {
  return Effect.gen(function* () {
    const settings = config.memory;
    if (!settings?.enabled)
      return yield* new CrewError("MEMORY_DISABLED", "Enable memory in personal settings.");
    const fs = yield* FileSystem.FileSystem;
    const root = yield* physicalPath(resolve(settings.directory)).pipe(
      Effect.mapError(memoryError),
    );
    for (const path of [
      config.home,
      config.repository_root,
      config.worktree_root,
      ...projects,
      ...config.repositories.flatMap((r) => (r.path ? [r.path] : [])),
    ]) {
      const other = yield* physicalPath(path).pipe(Effect.mapError(memoryError));
      if (contains(root, other) || contains(other, root))
        return yield* new CrewError(
          "MEMORY_LOCATION",
          "Choose a dedicated memory directory outside all managed checkouts and worktrees.",
        );
    }
    for (const folder of [
      root,
      ...["home", "config", "vault", "receipts"].map((name) => join(root, name)),
    ]) {
      const resolved = yield* physicalPath(folder).pipe(Effect.mapError(memoryError));
      if (resolved !== folder)
        return yield* new CrewError(
          "MEMORY_LOCATION",
          "Memory directories must stay inside the configured installation.",
        );
      yield* fs
        .makeDirectory(folder, { recursive: true, mode: 0o700 })
        .pipe(Effect.mapError(memoryError));
    }
    return root;
  }).pipe(provideFileSystem);
}

export const memoryDirectory = (config: AppConfig, projects: readonly string[]): Promise<string> =>
  Effect.runPromise(memoryDirectoryEffect(config, projects));

const pathConfig = Config.String("PATH").pipe(Config.withDefault("/usr/bin:/bin"));

function environment(root: string): Effect.Effect<Record<string, string>> {
  return Effect.gen(function* () {
    const path = yield* pathConfig;
    return {
      HOME: join(root, "home"),
      BASIC_MEMORY_CONFIG_DIR: join(root, "config"),
      BASIC_MEMORY_PROJECT_ROOT: join(root, "vault"),
      BASIC_MEMORY_FORCE_LOCAL: "true",
      BASIC_MEMORY_DATABASE_BACKEND: "sqlite",
      BASIC_MEMORY_SEMANTIC_EMBEDDING_PROVIDER: "fastembed",
      BASIC_MEMORY_SEMANTIC_EMBEDDING_MODEL: "bge-small-en-v1.5",
      BASIC_MEMORY_LOGFIRE_SEND_TO_LOGFIRE: "false",
      BASIC_MEMORY_LOGFIRE_ENABLED: "false",
      BASIC_MEMORY_RERANKER_ENABLED: "false",
      BASIC_MEMORY_WATCH_PROJECT_RELOAD_INTERVAL: "2",
      HF_HUB_OFFLINE: "1",
      HF_HOME: join(root, "home", ".cache", "huggingface"),
      FASTEMBED_CACHE_PATH: join(root, "config", "fastembed_cache"),
      PATH: path,
    };
  }).pipe(
    Effect.orElseSucceed(() => ({
      HOME: join(root, "home"),
      BASIC_MEMORY_CONFIG_DIR: join(root, "config"),
      BASIC_MEMORY_PROJECT_ROOT: join(root, "vault"),
      BASIC_MEMORY_FORCE_LOCAL: "true",
      BASIC_MEMORY_DATABASE_BACKEND: "sqlite",
      BASIC_MEMORY_SEMANTIC_EMBEDDING_PROVIDER: "fastembed",
      BASIC_MEMORY_SEMANTIC_EMBEDDING_MODEL: "bge-small-en-v1.5",
      BASIC_MEMORY_LOGFIRE_SEND_TO_LOGFIRE: "false",
      BASIC_MEMORY_LOGFIRE_ENABLED: "false",
      BASIC_MEMORY_RERANKER_ENABLED: "false",
      BASIC_MEMORY_WATCH_PROJECT_RELOAD_INTERVAL: "2",
      HF_HUB_OFFLINE: "1",
      HF_HOME: join(root, "home", ".cache", "huggingface"),
      FASTEMBED_CACHE_PATH: join(root, "config", "fastembed_cache"),
      PATH: "/usr/bin:/bin",
    })),
  );
}

function collectBounded(
  stream: Stream.Stream<Uint8Array, PlatformError>,
  limit: number,
): Effect.Effect<string, CrewError> {
  return Effect.gen(function* () {
    const chunks: Buffer[] = [];
    let total = 0;
    yield* Stream.runForEach(stream, (chunk) =>
      Effect.suspend(() => {
        total += chunk.byteLength;
        if (total > limit) return Effect.fail(unavailable());
        chunks.push(Buffer.from(chunk));
        return Effect.void;
      }),
    ).pipe(Effect.mapError(memoryError));
    return Buffer.concat(chunks, total).toString("utf8");
  });
}

export function checkMemoryVersionEffect(
  executable: string,
  root: string,
): Effect.Effect<void, CrewError> {
  return Effect.scoped(
    Effect.gen(function* () {
      const env = yield* environment(root);
      const child = yield* ChildProcess.make(executable, ["--version"], {
        cwd: root,
        env,
        extendEnv: false,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        killSignal: "SIGTERM",
        forceKillAfter: "1 second",
      }).pipe(Effect.mapError(memoryError));
      const [stdout, , code] = yield* Effect.all(
        [
          collectBounded(child.stdout, 8192),
          collectBounded(child.stderr, 8192),
          child.exitCode.pipe(Effect.mapError(memoryError)),
        ],
        { concurrency: "unbounded" },
      );
      if (code !== 0 || stdout.trim() !== "Basic Memory version: " + memoryVersion)
        return yield* unavailable();
    }),
  ).pipe(
    provideProcess,
    Effect.timeoutOrElse({
      duration: "8 seconds",
      orElse: () => Effect.fail(unavailable()),
    }),
  );
}

export const checkMemoryVersion = (
  executable: string,
  root: string,
  signal?: AbortSignal,
): Promise<void> => Effect.runPromise(checkMemoryVersionEffect(executable, root), { signal });

type ProviderState =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Connected"; readonly client: Client; readonly scope: Scope.Closeable }
  | { readonly _tag: "Closed" };

/** One lazily connected stdio client per runtime scope. A dead child is discarded on close. */
export class MemoryProvider {
  private readonly scope = Scope.makeUnsafe();
  private readonly state = Ref.makeUnsafe<ProviderState>({ _tag: "Idle" });
  private readonly connectLock = Semaphore.makeUnsafe(1);
  constructor(private executable: string) {}

  private connect(root: string): Effect.Effect<Client, CrewError> {
    return this.connectLock.withPermits(1)(
      Effect.gen({ self: this }, function* () {
        const current = yield* Ref.get(this.state);
        if (current._tag === "Closed") return yield* unavailable();
        if (current._tag === "Connected") return current.client;
        const connScope = yield* Scope.fork(this.scope);
        const client = yield* Effect.gen({ self: this }, function* () {
          yield* checkMemoryVersionEffect(this.executable, root);
          const env = yield* environment(root);
          const resource = yield* Effect.acquireRelease(
            Effect.sync(() => {
              const transport = new StdioClientTransport({
                command: this.executable,
                args: ["mcp", "--transport", "stdio"],
                env,
                cwd: root,
                stderr: "ignore",
              });
              const mcpClient = new Client({ name: "abracode-memory", version: "1" });
              return { transport, client: mcpClient };
            }),
            ({ transport, client: mcpClient }) =>
              Effect.promise(() =>
                mcpClient
                  .close()
                  .catch(() => undefined)
                  .then(() => transport.close().catch(() => undefined)),
              ),
          );
          yield* Effect.tryPromise({
            try: (signal) =>
              resource.client.connect(resource.transport, { signal, timeout: 15_000 }),
            catch: memoryError,
          });
          const { tools } = yield* Effect.tryPromise({
            try: (signal) => resource.client.listTools(undefined, { signal, timeout: 5000 }),
            catch: memoryError,
          });
          if (
            !["bm_project", "bm_read", "bm_search", "bm_write"].every((name) =>
              tools.some((t) => t.name === name),
            )
          )
            return yield* unavailable();
          return resource.client;
        }).pipe(
          Scope.provide(connScope),
          Effect.timeoutOrElse({
            duration: "20 seconds",
            orElse: () => Effect.fail(unavailable()),
          }),
          Effect.onError(() => Scope.close(connScope, Exit.void)),
          Effect.onInterrupt(() => Scope.close(connScope, Exit.void)),
        );
        const after = yield* Ref.get(this.state);
        if (after._tag === "Closed") {
          yield* Scope.close(connScope, Exit.void);
          return yield* unavailable();
        }
        const services = yield* Effect.context<never>();
        const runSync = Effect.runSyncWith(services);
        client.onclose = () => {
          runSync(
            Ref.update(this.state, (s): ProviderState =>
              s._tag === "Connected" && s.client === client ? { _tag: "Idle" } : s,
            ),
          );
        };
        yield* Ref.set(this.state, { _tag: "Connected", client, scope: connScope });
        return client;
      }),
    );
  }

  callEffect(
    root: string,
    name: string,
    args: Record<string, unknown>,
  ): Effect.Effect<unknown, CrewError> {
    return Effect.gen({ self: this }, function* () {
      const client = yield* this.connect(root);
      const result = yield* Effect.tryPromise({
        try: (signal) =>
          client.callTool({ name, arguments: { ...args, output_format: "json" } }, undefined, {
            signal,
            timeout: 15_000,
          }),
        catch: memoryError,
      });
      if (result.isError) {
        const block = Array.isArray(result.content) ? result.content[0] : undefined;
        const code = yield* Effect.try(() => JSON.parse(block?.text).error as unknown).pipe(
          Effect.orElseSucceed(() => undefined),
        );
        if (code === "ALREADY_EXISTS" || code === "REVISION_CONFLICT")
          return yield* new CrewError(
            "MEMORY_CONFLICT",
            "The destination has changed. Select the current note.",
          );
        if (code === "NOT_FOUND")
          return yield* new CrewError("MEMORY_MISSING", "The selected note is unavailable.");
        return yield* unavailable();
      }
      const value = result.structuredContent;
      if (!value) return yield* unavailable();
      return typeof value === "object" && "result" in value ? value.result : value;
    });
  }

  call(
    root: string,
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    return Effect.runPromise(this.callEffect(root, name, args), { signal });
  }

  closeEffect(): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      yield* Ref.set(this.state, { _tag: "Closed" });
      yield* Scope.close(this.scope, Exit.void);
    });
  }

  close(): Promise<void> {
    return Effect.runPromise(this.closeEffect());
  }
}
