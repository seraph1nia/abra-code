import { type Dispatch } from "../config/dispatch.ts";
import { captureConfiguration } from "../config/snapshot.ts";
import { type Config } from "../domain.ts";
import {
  type Execution,
  type ManagedExecution,
  type Project,
  type SetupExecution,
} from "../domain.ts";
import { automation, codingPolicy, type QualityProfile } from "../config/policy.ts";
import { timestamp, type ChangeName } from "../identities.ts";
import { verificationCommand } from "../config/contracts.ts";
import { Effect } from "effect";

type NewExecution = { quality_profile?: QualityProfile; dispatch?: Dispatch } & Pick<
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

/** Admission is the only place that resolves current project policy into durable authority. */
export function createExecution(
  project: Project,
  input: NewExecution & { setup: true; openspec_change: ChangeName | "" },
  config?: Config,
): Effect.Effect<SetupExecution>;
export function createExecution(
  project: Project,
  input: NewExecution & { setup?: false; openspec_change: ChangeName },
  config?: Config,
): Effect.Effect<Execution>;
export function createExecution(
  project: Project,
  input: NewExecution &
    (
      | { setup: true; openspec_change: ChangeName | "" }
      | { setup?: false; openspec_change: ChangeName }
    ),
  config?: Config,
): Effect.Effect<ManagedExecution> {
  const policy = {
    verification: project.verification.map(verificationCommand),
    delivery: project.delivery,
    ...(!input.setup ? codingPolicy(project, input.workflow_policy, input.quality_profile) : {}),
    ...(!input.setup && input.workflow_policy !== "research-only" ? automation(project) : {}),
    plan_approval: input.setup
      ? false
      : codingPolicy(project, input.workflow_policy, input.quality_profile).plan_approval,
    merge_approval: project.merge_approval,
    merge_method: project.merge_method,
    ci_policy: input.setup
      ? project.ci_policy
      : codingPolicy(project, input.workflow_policy, input.quality_profile).ci_policy,
    allow_no_checks: project.allow_no_checks,
    generated_paths: project.generated_paths,
    diagnostic_turns: project.diagnostic_turns,
    repair_rounds: project.repair_rounds,
  } as const;
  const { dispatch, ...executionInput } = input;
  return timestamp.pipe(
    Effect.map((at) => ({
      ...executionInput,
      ...(config
        ? { configuration_snapshot: captureConfiguration(config, project.dispatch, dispatch) }
        : {}),
      schema_version: 1,
      revision: 1,
      control_generation: 0,
      effective_policy: policy,
      approval_receipts: [],
      updated_at: at,
      plan_approval_required: policy.plan_approval,
      merge_approval_required: policy.merge_approval,
      delivery_policy: policy.delivery,
    })),
  );
}
