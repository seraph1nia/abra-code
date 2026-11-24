import { AbsolutePath, type OpenCodeClient } from "@opencode/client/effect";
import { Plugin } from "@opencode/schema/plugin";
import { Duration, Effect, Schedule } from "effect";
import { join, resolve } from "node:path";
import { CrewError } from "../domain.ts";

type PluginEntry = Pick<Plugin.Info, "id" | "state"> & Partial<Pick<Plugin.Info, "source">>;

/** Import failures have no plugin ID yet; identify those by the configured source. */
const abraCodePlugin = (plugins: readonly PluginEntry[], home?: string) =>
  plugins.find(
    (plugin) =>
      plugin.id === "abracode" ||
      (home !== undefined &&
        plugin.source?.type === "local" &&
        resolve(plugin.source.path) === join(home, ".opencode/plugins/abracode")),
  );

export const pollPluginState = <E>(
  inventory: Effect.Effect<readonly PluginEntry[], E>,
  options: {
    readonly home?: string;
    readonly delayMs?: number;
    readonly attempts?: number;
    readonly timeout?: Duration.Input;
  } = {},
) => {
  const schedule = Schedule.spaced(options.delayMs ?? 100);
  const read = inventory.pipe(
    Effect.map((plugins) => {
      const plugin = abraCodePlugin(plugins, options.home);
      if (plugin?.state.status === "failed" || plugin?.id === "abracode") return plugin.state;
      return undefined;
    }),
  );
  const polled =
    options.attempts !== undefined
      ? read.pipe(
          Effect.repeat({
            schedule,
            times: Math.max(0, options.attempts - 1),
            until: (state) => state !== undefined,
          }),
        )
      : read.pipe(
          Effect.repeat({
            schedule,
            until: (state) => state !== undefined,
          }),
        );
  return options.timeout !== undefined
    ? polled.pipe(
        Effect.timeoutOrElse({ duration: options.timeout, orElse: () => Effect.undefined }),
      )
    : polled;
};

export const awaitPluginState = (
  client: { plugin: Pick<OpenCodeClient["plugin"], "list"> },
  home: string,
) =>
  pollPluginState(
    client.plugin
      .list({ location: { directory: AbsolutePath.make(home) } })
      .pipe(Effect.map((plugins) => plugins.data)),
    { home, delayMs: 100, timeout: "15 seconds" },
  );

export const awaitPluginActivation = (
  client: { plugin: Pick<OpenCodeClient["plugin"], "list"> },
  home: string,
) =>
  awaitPluginState(client, home).pipe(
    Effect.flatMap((state) => {
      if (state?.status === "active") return Effect.void;
      const reason = state
        ? `AbraCode plugin failed to activate: ${state.error.slice(0, 2048)}${state.ref ? ` (native diagnostic: ${state.ref})` : ""}`
        : "AbraCode plugin did not activate within 15 seconds";
      return Effect.fail(
        new CrewError(
          "PLUGIN_ACTIVATION",
          `${reason}. Inspect native plugin diagnostics, correct the load error, then run pnpm service:restart or relaunch pnpm dev.`,
        ),
      );
    }),
  );

/** Registry reads do not await cold-location activation in the pinned native server. */
export const awaitWorkerPluginActivation = (
  inventory: Effect.Effect<readonly Pick<Plugin.Info, "id" | "state">[], CrewError>,
  attempts = 50,
  delay = 100,
): Effect.Effect<void, CrewError> =>
  pollPluginState(inventory, { delayMs: delay, attempts }).pipe(
    Effect.flatMap((state) => {
      if (state?.status === "active") return Effect.void;
      if (state?.status === "failed")
        return Effect.fail(
          new CrewError(
            "WORKER_PLUGIN_FAILED",
            "AbraCode activation failed at the worker location; repair its native plugin configuration before retrying",
          ),
        );
      return Effect.fail(
        new CrewError(
          "INVENTORY_UNAVAILABLE",
          "Worker-location AbraCode activation has not settled; retain admission intent and retry after initialization",
        ),
      );
    }),
  );
