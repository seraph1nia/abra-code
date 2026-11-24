/* oxlint-disable effecttsgo/unstable-api-usage -- Pinned Effect 4.1.4 CLI and Node platform runtime APIs. */
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Cause, Effect } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { runClient } from "./client.ts";
import { runConfigApply, runConfigSchema, runConfigShow, runConfigValidate } from "./config.ts";
import { runDev } from "./dev.ts";
import { runDoctor } from "./doctor.ts";
import { runLaunch } from "./launch.ts";
import { runReportExport, runReportPrepare, runReportPreview } from "./report.ts";
import { runServe } from "./start.ts";
import { runStop } from "./stop.ts";
import { runWeb } from "./web.ts";

const serveCommand = Command.make("serve", {}, () => runServe).pipe(
  Command.withDescription("Bootstrap and start the AbraCode native service in the background"),
);

const startCommand = Command.make("start", {}, () => runLaunch).pipe(
  Command.withDescription("Bootstrap the native service and open Abra interactively"),
);

const stopCommand = Command.make("stop", {}, () => runStop).pipe(
  Command.withDescription("Stop the AbraCode native service while preserving records"),
);

const attachCommand = Command.make(
  "attach",
  {
    pair: Flag.Boolean("pair").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Pair a client device"),
    ),
    auth: Flag.Boolean("auth").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Run provider login authentication"),
    ),
    url: Flag.optional(Flag.String("url").pipe(Flag.withDescription("Override server URL"))),
    extra: Argument.String("args").pipe(
      Argument.variadic(),
      Argument.withDescription("Additional arguments passed to opencode"),
    ),
  },
  (options) => runClient(options),
).pipe(
  Command.withAlias("client"),
  Command.withDescription("Attach to the running AbraCode Supervisor session"),
);

const webCommand = Command.make(
  "web",
  {
    port: Flag.Int("port").pipe(
      Flag.withDefault(4097),
      Flag.withDescription("Loopback HTTP port (1-65535)"),
    ),
    open: Flag.Boolean("open").pipe(
      Flag.withDefault(true),
      Flag.withDescription("Open the Abra web URL in the default browser"),
    ),
  },
  (options) => runWeb(options),
).pipe(
  Command.withDescription("Open the single-session AbraCode CopilotKit workspace on localhost"),
);

const devCommand = Command.make(
  "dev",
  {
    port: Flag.Int("port").pipe(
      Flag.withDefault(5173),
      Flag.withDescription("Frontend Vite dev port (1-65535)"),
    ),
    backendPort: Flag.Int("backend-port").pipe(
      Flag.withDefault(4098),
      Flag.withDescription("Backend Effect HTTP dev port (1-65535)"),
    ),
    open: Flag.Boolean("open").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Open the development URL in the default browser"),
    ),
  },
  (options) => runDev(options),
).pipe(
  Command.withDescription(
    "Start Docker Compose, restart the native service, and run Vite HMR + Effect HTTP backend reloads",
  ),
);

const doctorCommand = Command.make("doctor", {}, () => runDoctor).pipe(
  Command.withDescription("Inspect installation readiness, locking, and required CLI binaries"),
);

const configValidateCommand = Command.make(
  "validate",
  {
    json: Flag.Boolean("json").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Emit compact JSON output"),
    ),
  },
  ({ json }) => runConfigValidate(json),
).pipe(Command.withDescription("Validate the AbraCode configuration file"));

const configShowCommand = Command.make(
  "show",
  {
    json: Flag.Boolean("json").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Emit compact JSON output"),
    ),
  },
  ({ json }) => runConfigShow(json),
).pipe(Command.withDescription("Display the redacted resolved AbraCode configuration"));

const configApplyCommand = Command.make(
  "apply",
  {
    status: Flag.Boolean("status").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Inspect configuration reconciliation status without applying"),
    ),
    page: Flag.Int("page").pipe(Flag.withDefault(0), Flag.withDescription("Pagination page index")),
    json: Flag.Boolean("json").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Emit compact JSON output"),
    ),
  },
  (options) => runConfigApply(options),
).pipe(Command.withDescription("Reconcile declared repositories and settings with the service"));

const configStatusCommand = Command.make(
  "status",
  {
    page: Flag.Int("page").pipe(Flag.withDefault(0), Flag.withDescription("Pagination page index")),
    json: Flag.Boolean("json").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Emit compact JSON output"),
    ),
  },
  ({ page, json }) => runConfigApply({ status: true, page, json }),
).pipe(Command.withDescription("Show configuration reconciliation status against the service"));

const configSchemaCommand = Command.make(
  "schema",
  {
    write: Flag.Boolean("write").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Write the generated JSON Schema to abracode.schema.json"),
    ),
    check: Flag.Boolean("check").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Verify abracode.schema.json matches the current schema"),
    ),
  },
  ({ write }) => runConfigSchema({ write }),
).pipe(Command.withDescription("Verify or regenerate abracode.schema.json"));

const configCommand = Command.make(
  "config",
  {
    show: Flag.Boolean("show").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Display the redacted resolved AbraCode configuration"),
    ),
    json: Flag.Boolean("json").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Emit compact JSON output"),
    ),
  },
  ({ show, json }) => (show ? runConfigShow(json) : runConfigValidate(json)),
).pipe(
  Command.withDescription("Validate, inspect, reconcile, or generate AbraCode configuration"),
  Command.withSubcommands([
    configValidateCommand,
    configShowCommand,
    configApplyCommand,
    configStatusCommand,
    configSchemaCommand,
  ]),
);

const reportPrepareCommand = Command.make("prepare", {}, () => runReportPrepare).pipe(
  Command.withDescription("Prepare or reuse this installation's portable renderer shell"),
);

const reportExportCommand = Command.make(
  "export",
  {
    input: Argument.String("input").pipe(
      Argument.withDescription("Path to saved report JSON document"),
    ),
    output: Argument.String("output").pipe(
      Argument.withDescription("Destination path for the exported HTML file"),
    ),
  },
  ({ input, output }) => runReportExport(input, output),
).pipe(Command.withDescription("Export a saved report JSON document to portable HTML"));

const reportPreviewCommand = Command.make(
  "preview",
  {
    input: Argument.String("input").pipe(
      Argument.withDescription("Path to exported portable HTML report"),
    ),
    port: Argument.Int("port").pipe(
      Argument.withDefault(4174),
      Argument.withDescription("Loopback HTTP port (0-65535)"),
    ),
  },
  ({ input, port }) => runReportPreview(input, port),
).pipe(Command.withDescription("Serve an exported portable HTML report on localhost"));

const reportCommand = Command.make("report").pipe(
  Command.withDescription("Prepare, export, and preview portable AbraCode reports"),
  Command.withSubcommands([reportPrepareCommand, reportExportCommand, reportPreviewCommand]),
);

export const abracodeCommand = Command.make("abracode").pipe(
  Command.withDescription("AbraCode CLI"),
  Command.withSubcommands([
    serveCommand,
    startCommand,
    stopCommand,
    attachCommand,
    webCommand,
    devCommand,
    doctorCommand,
    configCommand,
    reportCommand,
  ]),
);

export const runCli = (args?: ReadonlyArray<string>) =>
  args === undefined
    ? Command.run(abracodeCommand, { version: "0.1.0" })
    : Command.runWith(abracodeCommand, { version: "0.1.0" })(args);

export const runMain = (prefix?: ReadonlyArray<string>) => {
  const effect = (
    prefix === undefined ? runCli() : runCli([...prefix, ...process.argv.slice(2)])
  ).pipe(
    Effect.tapCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.void
        : Effect.sync(() => {
            process.stderr.write(`${Cause.pretty(cause)}\n`);
          }),
    ),
    Effect.provide(NodeServices.layer),
  );
  NodeRuntime.runMain(effect, { disableErrorReporting: true });
};
