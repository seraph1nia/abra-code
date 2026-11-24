import { Effect } from "effect";
import { Agent, type Model, type OpenCodeClient } from "@opencode/client/effect";
import type { Context } from "@opencode/plugin/effect/plugin";
import type { MessageId } from "@abracode/contracts/identities";
import {
  CrewError,
  type Config,
  type ManagedExecution,
  type Role,
  type WorkerModel,
} from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { workerProfile } from "../config/snapshot.ts";
import { NativeStore } from "../storage/store.ts";
import { compatibleContext, readWorkerContext } from "../workflow/worker-context.ts";
import { legacyReviewProfile } from "./role-policy.ts";
import {
  awaitWorkerPlugin,
  resolveCapturedSkills,
  resolveSkills,
  type WorkerEnvironment,
} from "./worker-environment.ts";
import { nativeSession } from "./native-call.ts";

export type InventoryModel = Pick<
  Model.Info,
  "id" | "providerID" | "variants" | "capabilities" | "enabled"
>;

export interface ModelValidationMessages {
  readonly unavailable: string;
  readonly variantUnavailable: (variant: string, available: readonly string[]) => string;
  readonly capabilityCode?: string;
  readonly capabilityMessage?: string;
}

/** Validate that a selected model is enabled, supports tools, and exposes any requested variant. */
export const validateModelSelection = (
  selected: WorkerModel,
  models: readonly InventoryModel[],
  messages: ModelValidationMessages,
) =>
  Effect.gen(function* () {
    const model = models.find((m) => m.providerID === selected.providerID && m.id === selected.id);
    if (!model || !model.enabled)
      return yield* new CrewError("MODEL_UNAVAILABLE", messages.unavailable);
    if (!model.capabilities.tools)
      return yield* new CrewError(
        messages.capabilityCode ?? "MODEL_CAPABILITY",
        messages.capabilityMessage ?? messages.unavailable,
      );
    if (
      selected.variant &&
      selected.variant !== "default" &&
      !model.variants.some((v) => v.id === selected.variant)
    )
      return yield* new CrewError(
        "MODEL_VARIANT_UNAVAILABLE",
        messages.variantUnavailable(
          selected.variant,
          model.variants.map((v) => v.id),
        ),
      );
    return model;
  });

/** Validate only the native inventory fields needed for admission. */
export const checkWorkerInventory = (
  profile: Config["workers"][Role],
  inherited: WorkerModel | undefined,
  role: Role,
  agents: readonly Pick<Agent.Info, "id" | "model">[],
  models: readonly InventoryModel[],
) =>
  Effect.gen(function* () {
    const agentID = profile?.agent ?? Agent.ID.make("build");
    const agent: Pick<Agent.Info, "id" | "model"> | undefined =
      agents.find((a) => a.id === agentID) ??
      (profile?.agent === undefined ? Agent.Info.default(agentID) : undefined);
    if (!agent)
      return yield* new CrewError(
        "AGENT_UNAVAILABLE",
        `Configured ${role} agent ${agentID} is absent from the worker location (available: ${agents
          .map((a) => a.id)
          .join(",")
          .slice(0, 512)})`,
      );
    const selected = profile?.model ?? inherited ?? agent.model;
    if (!selected)
      return yield* new CrewError(
        "MODEL_UNAVAILABLE",
        "No effective worker model is selected; preserve the admission intent",
      );
    yield* validateModelSelection(selected, models, {
      unavailable: `Selected ${role} model is absent from the worker location`,
      variantUnavailable: (variant, available) =>
        `Selected model variant ${variant} is absent from the worker location (${available.join(",")})`,
      capabilityCode: "MODEL_CAPABILITY",
      capabilityMessage: "The selected worker model does not support tools",
    });
    return { agent: agentID, model: selected };
  });

export const preflightWorker = (
  ctx: Context,
  client: OpenCodeClient,
  config: Config,
  e: ManagedExecution,
  role: Role,
  promptID?: MessageId,
): Effect.Effect<WorkerEnvironment | void, CrewError> =>
  domainEffect(
    Effect.gen(function* () {
      if (!e.worktree_directory)
        return yield* new CrewError("WORKTREE", "Worker inventory requires the owned worktree");
      const sessionID = e[`${role}_session_id`];
      if (promptID && sessionID) {
        const [inbox, context] = yield* Effect.all(
          [client.session.inbox.list({ sessionID }), client.session.context({ sessionID })],
          { concurrency: "unbounded" },
        );
        if (
          inbox.some((item) => item.id === promptID) ||
          context.some((message) => message.id === promptID)
        )
          return;
      }
      const captured =
        promptID && e.worker_context_id
          ? yield* readWorkerContext(new NativeStore(ctx.storage), e.worker_context_id)
          : undefined;
      if (captured) {
        if (!sessionID || !promptID)
          return yield* new CrewError(
            "CONTEXT_ASSIGNMENT",
            "Captured context lacks a retained native admission identity",
          );
        compatibleContext(captured, {
          execution_id: e.execution_id,
          generation: e.control_generation,
          role,
          session_id: sessionID,
          prompt_id: promptID,
        });
      }
      let profile = captured
        ? {
            agent: captured.environment.agent,
            model: captured.environment.model,
          }
        : workerProfile(e, role, config);
      if (!captured && !e.configuration_snapshot && sessionID) {
        // Missing historical snapshots cannot adopt current worker configuration.
        const historical = yield* nativeSession(ctx).get({ sessionID });
        profile = {
          agent: historical.agent ?? Agent.ID.make("build"),
          model: e.worker_model ?? historical.model,
        };
      }
      const requirements =
        captured?.schema_version === 2
          ? captured.prepared.profile.requirements
          : e.configuration_snapshot?.definitions?.[role]?.requirements;
      const effectiveProfile = {
        ...profile,
        required_skills: [
          ...(requirements?.required_skills ?? []),
          ...(profile?.required_skills ?? []),
        ],
        required_tools: [
          ...(requirements?.required_tools ?? []),
          ...(profile?.required_tools ?? []),
        ],
      };
      const location = { directory: e.worktree_directory };
      yield* awaitWorkerPlugin(
        client.plugin.list({ location }).pipe(
          Effect.map((inventory) => inventory.data),
          Effect.mapError(
            () =>
              new CrewError(
                "INVENTORY_UNAVAILABLE",
                "Worker-location plugin inventory unavailable; retry after native activation",
              ),
          ),
        ),
      );
      const [agents, models, skills] = yield* Effect.all(
        [
          client.agent.list({ location }),
          client.model.list({ location }),
          client.skill.list({ location }),
        ],
        { concurrency: "unbounded" },
      ).pipe(
        Effect.mapError(
          () =>
            new CrewError(
              "INVENTORY_UNAVAILABLE",
              "Worker-location inventory unavailable; preserve the admission intent and retry after repair",
            ),
        ),
      );
      const selected = yield* checkWorkerInventory(
        profile,
        e.worker_model,
        role,
        agents.data,
        models.data,
      );
      return {
        ...selected,
        ...(yield* captured
          ? resolveCapturedSkills(role, captured.environment, skills.data, e.worktree_directory)
          : resolveSkills(
              role,
              e.workflow_policy,
              effectiveProfile,
              skills.data,
              e.worktree_directory,
              !legacyReviewProfile(e.configuration_snapshot?.definitions?.[role]),
            )),
      };
    }),
  );
