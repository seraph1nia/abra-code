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
import { Effect } from "effect";
import { Agents } from "@abracode/agents";
import { Skill } from "@opencode/schema/skill";
import { workerRoles } from "../config/dispatch.ts";

type NewExecution = {
  quality_profile?: QualityProfile;
  dispatch?: Dispatch;
  privateReview?: boolean;
  openspec_schema?: SpecSchemaName;
  proposal_review?: Execution["proposal_review"];
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
    const configuration = yield* Effect.gen(function* () {
      const catalog = yield* Agents;
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
    });
    return {
      ...executionInput,
      configuration_snapshot: configuration,
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
