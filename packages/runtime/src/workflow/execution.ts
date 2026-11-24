import { type Dispatch } from "../config/dispatch.ts";
import { captureConfiguration } from "../config/snapshot.ts";
import { type Config, CrewError } from "../domain.ts";
import {
  type Execution,
  type ManagedExecution,
  type Project,
  type SetupExecution,
} from "../domain.ts";
import { automation, planPolicy, type QualityProfile } from "../config/policy.ts";
import { timestamp, type ChangeName, type SpecSchemaName } from "@abracode/contracts/identities";
import { verificationCommand } from "../config/contracts.ts";
import { Context, Effect } from "effect";
import { Agents } from "@abracode/agents";
import { Skill } from "@opencode/schema/skill";
import { workerRoles } from "../config/dispatch.ts";

type NewExecution = {
  quality_profile?: QualityProfile;
  dispatch?: Dispatch;
  privateReview?: boolean;
  openspec_schema?: SpecSchemaName;
  require_plan_approval?: true;
} & Pick<
  ManagedExecution,
  | "issue_id"
  | "repository_id"
  | "execution_id"
  | "workflow_policy"
  | "current_phase"
  | "branch"
  | "supervisor_session_id"
  | "intent"
>;

function buildExecution<R>(
  project: Project,
  input: NewExecution &
    (
      | { setup: true; openspec_change: ChangeName | "" }
      | { setup?: false; openspec_change: ChangeName }
    ),
  config: Config | undefined,
  resolveCatalog: () => Effect.Effect<Effect.Success<typeof Agents>, CrewError, R>,
): Effect.Effect<ManagedExecution, CrewError, R> {
  const { dispatch, privateReview, require_plan_approval: _required, ...executionInput } = input;
  return Effect.gen(function* () {
    const coding = input.setup
      ? undefined
      : yield* Effect.try({
          try: () =>
            planPolicy(
              project,
              input.workflow_policy,
              input.quality_profile,
              input.require_plan_approval,
            ),
          catch: CrewError.from,
        });
    const policy = {
      verification: project.verification.map(verificationCommand),
      delivery: project.delivery,
      ...coding,
      ...(!input.setup && input.workflow_policy !== "research-only" ? automation(project) : {}),
      plan_approval: coding?.plan_approval ?? false,
      merge_approval: project.merge_approval,
      merge_method: project.merge_method,
      ci_policy: coding?.ci_policy ?? project.ci_policy,
      allow_no_checks: project.allow_no_checks,
      generated_paths: project.generated_paths,
      diagnostic_turns: project.diagnostic_turns,
      repair_rounds: project.repair_rounds,
    } as const;
    const at = yield* timestamp;
    const configuration =
      config &&
      (yield* Effect.gen(function* () {
        const catalog = yield* resolveCatalog();
        const snapshot = captureConfiguration(config, project.dispatch, dispatch);
        if (privateReview) {
          const research = snapshot.workers.research;
          snapshot.workers.research = {
            ...research,
            required_skills: [
              ...new Set([
                ...(research.required_skills ?? []),
                Skill.ID.make("abra-open-code-review-delegate"),
              ]),
            ],
          };
        }
        const definitions = yield* Effect.forEach(workerRoles, (role) =>
          catalog.get(config.workers[role]?.definition ?? role).pipe(
            Effect.flatMap((agent) => agent.resolve(role)),
            Effect.map((profile) => [role, profile] as const),
            Effect.mapError(
              (error) => new CrewError(error.code, `workers.${role}.definition: ${error.message}`),
            ),
          ),
        );
        return {
          ...snapshot,
          agent_selection_version: 1 as const,
          definitions: Object.fromEntries(definitions),
        };
      }));
    return {
      ...executionInput,
      ...(configuration && { configuration_snapshot: configuration }),
      ...(input.setup || input.workflow_policy !== "full-openspec"
        ? {}
        : {
            openspec_schema_binding: {
              schema_version: 1 as const,
              state: "pending" as const,
              selection_source: input.openspec_schema
                ? ("task" as const)
                : ("repository_default" as const),
            },
          }),
      schema_version: 1,
      revision: 1,
      control_generation: 0,
      effective_policy: policy,
      approval_receipts: [],
      updated_at: at,
      plan_approval_required: policy.plan_approval,
      merge_approval_required: policy.merge_approval,
      delivery_policy: policy.delivery,
    };
  });
}

/** Configured admission helper whose environment statically requires the application catalog. */
export function createConfiguredExecution(
  project: Project,
  input: NewExecution & { setup: true; openspec_change: ChangeName | "" },
  config: Config,
): Effect.Effect<SetupExecution, CrewError, Agents>;
export function createConfiguredExecution(
  project: Project,
  input: NewExecution & { setup?: false; openspec_change: ChangeName },
  config: Config,
): Effect.Effect<Execution, CrewError, Agents>;
export function createConfiguredExecution(
  project: Project,
  input: NewExecution &
    (
      | { setup: true; openspec_change: ChangeName | "" }
      | { setup?: false; openspec_change: ChangeName }
    ),
  config: Config,
): Effect.Effect<ManagedExecution, CrewError, Agents> {
  return buildExecution(project, input, config, () =>
    Effect.map(Effect.context<Agents>(), (ctx) => Context.get(ctx, Agents)),
  );
}

/** Admission is the only place that resolves current project policy into durable authority. */
export function createExecution(
  project: Project,
  input: NewExecution & { setup: true; openspec_change: ChangeName | "" },
  config?: Config,
): Effect.Effect<SetupExecution, CrewError>;
export function createExecution(
  project: Project,
  input: NewExecution & { setup?: false; openspec_change: ChangeName },
  config?: Config,
): Effect.Effect<Execution, CrewError>;
export function createExecution(
  project: Project,
  input: NewExecution &
    (
      | { setup: true; openspec_change: ChangeName | "" }
      | { setup?: false; openspec_change: ChangeName }
    ),
  config?: Config,
): Effect.Effect<ManagedExecution, CrewError> {
  return buildExecution<never>(project, input, config, () =>
    Effect.serviceOption(Agents).pipe(
      Effect.flatMap((catalog) =>
        Effect.fromOption(catalog).pipe(
          Effect.mapError(
            () =>
              new CrewError(
                "AGENTS_UNAVAILABLE",
                "Configured worker selection requires the application catalog",
              ),
          ),
        ),
      ),
    ),
  );
}
