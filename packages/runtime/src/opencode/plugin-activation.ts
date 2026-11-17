import { AbsolutePath, type OpenCodeClient } from "@opencode/client/effect";
import { Plugin } from "@opencode/schema/plugin";
import { Effect, Schedule } from "effect";
import { join, resolve } from "node:path";
import { CrewError } from "../domain.ts";

/** Import failures have no plugin ID yet; identify those by the configured source. */
export const abraCodePlugin = (plugins: readonly Plugin.Info[], home: string) =>
  plugins.find(
    (plugin) =>
      plugin.id === "abracode" ||
      (plugin.source.type === "local" &&
        resolve(plugin.source.path) === join(home, ".opencode/plugins/abracode")),
  );

export const awaitPluginActivation = (
  client: { plugin: Pick<OpenCodeClient["plugin"], "list"> },
  home: string,
) =>
  client.plugin.list({ location: { directory: AbsolutePath.make(home) } }).pipe(
    Effect.flatMap((plugins) => {
      const plugin = abraCodePlugin(plugins.data, home);
      if (plugin?.state.status === "failed")
        return Effect.fail(
          new CrewError(
            "PLUGIN_ACTIVATION",
            `AbraCode plugin failed to activate: ${plugin.state.error.slice(0, 2048)}${plugin.state.ref ? ` (native diagnostic: ${plugin.state.ref})` : ""}. Inspect native plugin diagnostics, correct the load error, then run pnpm service:restart. Restarting pnpm dev reuses the native service.`,
          ),
        );
      return Effect.succeed(plugin?.id === "abracode" && plugin.state.status === "active");
    }),
    Effect.repeat({ schedule: Schedule.spaced(100), until: Boolean }),
    Effect.timeoutOrElse({
      duration: "15 seconds",
      orElse: () =>
        Effect.fail(
          new CrewError(
            "PLUGIN_ACTIVATION",
            "AbraCode plugin did not activate within 15 seconds; inspect native plugin diagnostics. After correcting the load error, run pnpm service:restart. Restarting pnpm dev reuses the native service.",
          ),
        ),
    }),
    Effect.asVoid,
  );
