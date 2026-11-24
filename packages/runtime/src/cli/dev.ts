/* oxlint-disable effecttsgo/unstable-api-usage -- Pinned Effect 4.1.4 child process lifecycle APIs. */
import { Console, Effect, Schedule } from "effect";
import { ChildProcess } from "effect/process";
import { CrewError } from "../domain.ts";
import { sourceInstallationRoot } from "../installation.ts";
import { makeWorkspaceClient } from "../web/client.ts";
import { connectDevNotebook } from "./dev-notebook.ts";

export interface DevOptions {
  readonly port: number;
  readonly backendPort: number;
  readonly open: boolean;
}

const browserOpener = (): string | undefined =>
  process.platform === "darwin" ? "open" : process.platform === "linux" ? "xdg-open" : undefined;

export const runDev = (options: DevOptions) =>
  Effect.scoped(
    Effect.gen(function* () {
      const { port, backendPort } = options;
      if (
        !Number.isInteger(port) ||
        port < 1 ||
        port > 65535 ||
        !Number.isInteger(backendPort) ||
        backendPort < 1 ||
        backendPort > 65535
      )
        return yield* new CrewError(
          "DEV_ARGUMENTS",
          "Usage: pnpm dev [--port 5173] [--backend-port 4098]",
        );
      if (port === backendPort)
        return yield* new CrewError("DEV_ARGUMENTS", "Frontend and backend ports must differ");
      const home = sourceInstallationRoot();
      const childOptions = {
        cwd: home,
        env: {
          ABRACODE_DEV_PORT: String(port),
          ABRACODE_DEV_BACKEND_PORT: String(backendPort),
          COPILOTKIT_TELEMETRY_DISABLED: "true",
        },
        extendEnv: true,
        detached: true,
        stdin: "ignore" as const,
        stdout: "inherit" as const,
        stderr: "inherit" as const,
        killSignal: "SIGTERM" as const,
        forceKillAfter: "3 seconds" as const,
      };
      const compose = yield* ChildProcess.make(
        "docker",
        [
          "compose",
          "-f",
          "compose.yaml",
          "up",
          "-d",
          "--force-recreate",
          "--wait",
          "--wait-timeout",
          "60",
        ],
        childOptions,
      );
      const composeCode = yield* compose.exitCode;
      if (Number(composeCode) !== 0)
        return yield* new CrewError(
          "DEV_COMPOSE",
          `Docker Compose startup failed (${composeCode})`,
        );
      yield* connectDevNotebook(home);
      const restart = yield* ChildProcess.make("pnpm", ["service:restart"], childOptions);
      const restartCode = yield* restart.exitCode;
      if (Number(restartCode) !== 0)
        return yield* new CrewError(
          "DEV_SERVICE_RESTART",
          `Native service restart failed (${restartCode})`,
        );
      const backend = yield* ChildProcess.make(
        "pnpm",
        [
          "exec",
          "tsx",
          "watch",
          "--clear-screen=false",
          "--exclude",
          ".abracode/**",
          "--exclude",
          "apps/**",
          "--include",
          "packages/runtime/src/**",
          "--include",
          "packages/contracts/src/**",
          "scripts/cli.ts",
          "web",
          "--port",
          String(backendPort),
          "--no-open",
        ],
        childOptions,
      );
      const ready = makeWorkspaceClient(`http://127.0.0.1:${backendPort}`).pipe(
        Effect.flatMap((client) => client.workspace.bootstrap()),
        Effect.asVoid,
        Effect.retry(Schedule.spaced("100 millis")),
        Effect.timeout("30 seconds"),
      );
      yield* Effect.raceFirst(
        ready,
        backend.exitCode.pipe(
          Effect.flatMap(
            (code) => new CrewError("DEV_BACKEND_EXIT", `Development backend exited (${code})`),
          ),
        ),
      );
      const frontend = yield* ChildProcess.make(
        "pnpm",
        ["--filter", "@abracode/web", "dev"],
        childOptions,
      );
      const url = `http://127.0.0.1:${port}`;
      yield* Console.log(
        `Abra development: ${url}\nReact edits use Vite HMR; backend edits restart the Effect HTTP adapter. Ctrl+C stops development servers and preserves native work.`,
      );
      if (options.open) {
        const opener = browserOpener();
        if (opener) {
          yield* Effect.scoped(
            Effect.gen(function* () {
              const child = yield* ChildProcess.make(opener, [url], {
                cwd: home,
                detached: false,
                stdin: "ignore",
                stdout: "ignore",
                stderr: "ignore",
              });
              yield* child.exitCode;
            }),
          ).pipe(Effect.timeout("5 seconds"), Effect.ignore);
        }
      }
      return yield* Effect.raceFirst(
        backend.exitCode.pipe(
          Effect.flatMap(
            (code) => new CrewError("DEV_BACKEND_EXIT", `Development backend exited (${code})`),
          ),
        ),
        frontend.exitCode.pipe(
          Effect.flatMap((code) => new CrewError("DEV_FRONTEND_EXIT", `Vite exited (${code})`)),
        ),
      );
    }),
  );
