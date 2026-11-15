/* oxlint-disable effecttsgo/unstable-api-usage -- Pinned Effect process lifecycle; the native service remains independently owned. */
import { NodeRuntime } from "@effect/platform-node";
import { Console, Effect, Schedule } from "effect";
import { ChildProcess } from "effect/process";
import { fileURLToPath } from "node:url";
import { CrewError } from "../src/domain.ts";
import { provideProcess } from "../src/platform.ts";
import { makeWorkspaceClient } from "../src/web/client.ts";

const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log(
    "Usage: pnpm dev [--port 5173] [--backend-port 4098]\nVite React HMR and automatic Effect HTTP backend reloads.",
  );
} else {
  const program = Effect.scoped(
    Effect.gen(function* () {
      let port = 5173,
        backendPort = 4098;
      for (let index = 0; index < args.length; index++) {
        const flag = args[index];
        const value = args[++index];
        if (
          !["--port", "--backend-port"].includes(flag) ||
          !/^\d+$/.test(value ?? "") ||
          Number(value) < 1 ||
          Number(value) > 65535
        )
          return yield* new CrewError(
            "DEV_ARGUMENTS",
            "Usage: pnpm dev [--port 5173] [--backend-port 4098]",
          );
        if (flag === "--port") port = Number(value);
        else backendPort = Number(value);
      }
      if (port === backendPort)
        return yield* new CrewError("DEV_ARGUMENTS", "Frontend and backend ports must differ");
      const home = fileURLToPath(new URL("../", import.meta.url));
      const options = {
        cwd: home,
        env: { ABRACODE_DEV_PORT: String(port), ABRACODE_DEV_BACKEND_PORT: String(backendPort) },
        extendEnv: true,
        detached: true,
        stdin: "ignore" as const,
        stdout: "inherit" as const,
        stderr: "inherit" as const,
        killSignal: "SIGTERM" as const,
        forceKillAfter: "3 seconds" as const,
      };
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
          "src/**",
          "scripts/web.ts",
          "--port",
          String(backendPort),
          "--no-open",
        ],
        options,
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
        options,
      );
      yield* Console.log(
        `Abra development: http://127.0.0.1:${port}\nReact edits use Vite HMR; backend edits restart the Effect HTTP adapter. Ctrl+C stops development servers and preserves native work.`,
      );
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
  ).pipe(provideProcess);
  NodeRuntime.runMain(program);
}
