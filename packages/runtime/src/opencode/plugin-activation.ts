import { AbsolutePath, type OpenCodeClient } from "@opencode/client/effect";
import { Plugin } from "@opencode/schema/plugin";
import { Effect, Schedule } from "effect";
import { join, resolve } from "node:path";
import { CrewError } from "../domain.ts";

/** Import failures have no plugin ID yet; identify those by the configured source. */
const abraCodePlugin = (plugins: readonly Plugin.Info[], home: string) =>
  plugins.find(
    (plugin) =>
      plugin.id === "abracode" ||
      (plugin.source.type === "local" &&
        resolve(plugin.source.path) === join(home, ".opencode/plugins/abracode")),
  );

export const awaitPluginState = (
  client: { plugin: Pick<OpenCodeClient["plugin"], "list"> },
  home: string,
) =>
  client.plugin.list({ location: { directory: AbsolutePath.make(home) } }).pipe(
    Effect.map((plugins) => {
      const plugin = abraCodePlugin(plugins.data, home);
      if (plugin?.state.status === "failed" || plugin?.id === "abracode") return plugin.state;
      return undefined;
    }),
    Effect.repeat({ schedule: Schedule.spaced(100), until: (state) => state !== undefined }),
    Effect.timeoutOrElse({ duration: "15 seconds", orElse: () => Effect.undefined }),
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
