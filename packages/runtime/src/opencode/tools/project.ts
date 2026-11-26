import { Effect, Schema } from "effect";
import { RepositoryId } from "@abracode/contracts/identities";
import { Count } from "@abracode/contracts/primitives";
import { CrewError } from "../../domain.ts";
import type { ConfigApplication } from "../../config/application.ts";
import { ProjectInputFields } from "../../config/contracts.ts";
import { ConfigurationReportSchema, configurationReport } from "../../config/declarations.ts";
import type { Onboarding } from "../../config/onboard.ts";
import type { ProjectSetup } from "../../config/setup.ts";
import type { Controller } from "../../workflow/controller.ts";
import { toolOutputs } from "../tool-contracts.ts";
import { defineTool as define, type DefinedTool } from "../tool-definition.ts";

const PROJECT_RECOVERY_HINT =
  "Inspect project_list and the onboarding/recovery runbook; preserve resources.";

export function projectTools(
  c: Controller,
  onboard: Onboarding,
  setup: ProjectSetup,
  configuration?: ConfigApplication,
): DefinedTool[] {
  return [
    define({
      name: "config",
      diagnostic: (a) => a.action === "status",
      description:
        "Inspect declaration outcomes or explicitly apply the current YAML repository settings. Does not change active execution settings or initialize projects.",
      input: Schema.Struct({
        action: Schema.Literals(["status", "apply"]),
        page: Schema.optional(Count),
      }),
      output: ConfigurationReportSchema,
      run: (a) =>
        configuration
          ? (a.action === "apply" ? configuration.apply() : configuration.status()).pipe(
              Effect.map((outcomes) =>
                configurationReport(outcomes, a.page, configuration.dispatch()),
              ),
            )
          : Effect.fail(
              new CrewError("CONFIG_UNAVAILABLE", "Configuration application is unavailable"),
            ),
    }),
    define({
      name: "project_onboard",
      output: toolOutputs.project_onboard,
      recoveryHint: PROJECT_RECOVERY_HINT,
      description:
        "Onboard a remote URL without a local checkout, or an existing checkout path. Inspect instructions and checks; register even if setup is pending. Never ask the user to clone a remote first.",
      input: Schema.Struct({
        ...ProjectInputFields,
        action: Schema.optional(Schema.Literals(["inspect", "register"])),
        initialize_openspec: Schema.optional(Schema.Boolean),
      }),
      run: (a, s) =>
        Effect.gen(function* () {
          if (a.action !== "register") return yield* onboard.inspect(a);
          const report = yield* onboard.register(a, a.initialize_openspec === true);
          if (report.project.managed && !report.project.openspec && a.initialize_openspec === true)
            return {
              ...report,
              setup: yield* setup.run(a.id, "prepare", s, true),
            };
          return report;
        }),
    }),
    define({
      name: "project_list",
      diagnostic: true,
      output: toolOutputs.project_list,
      recoveryHint: PROJECT_RECOVERY_HINT,
      description: "List explicitly registered repositories.",
      input: Schema.Struct({}),
      run: () =>
        Effect.gen(function* () {
          return yield* Effect.forEach(
            yield* c.queries.projects(),
            (p) =>
              Effect.gen(function* () {
                const currentSetup = yield* c.queries.setup(p.id);
                return {
                  ...p,
                  effective_capacity: {
                    active_workers: p.max_workers,
                    retained_executions: p.max_executions,
                  },
                  setup_blockers: [
                    ...(!p.openspec
                      ? [
                          currentSetup?.current_phase === "queued"
                            ? `Setup queued. ${currentSetup.error_or_recovery_reason ?? "Waiting for capacity"}.`
                            : "OpenSpec configuration is missing; use abra_project_setup",
                        ]
                      : []),
                    ...(!p.verification.length ? ["Verification commands are missing"] : []),
                  ],
                  setup: currentSetup,
                };
              }),
            { concurrency: "unbounded" },
          );
        }),
    }),
    define({
      name: "project_setup",
      output: toolOutputs.project_setup,
      recoveryHint: PROJECT_RECOVERY_HINT,
      description:
        "Prepare an explicitly authorized OpenSpec setup. A queued prepare waits for capacity and resumes automatically. Deliver its branch/PR, request merge approval or finish cleanup with separate actions.",
      input: Schema.Struct({
        id: RepositoryId,
        action: Schema.Literals(["prepare", "deliver", "approve", "finish"]),
        initialize_openspec: Schema.optional(Schema.Boolean),
      }),
      run: (a, s) => setup.run(a.id, a.action, s, a.initialize_openspec === true),
    }),
  ];
}
