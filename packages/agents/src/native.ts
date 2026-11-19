import { Context, Effect, Layer, Schema } from "effect";
import type { Context as PluginContext } from "@opencode/plugin/effect/plugin";
import { Agent as NativeAgent } from "@opencode/schema/agent";
import type { Model } from "@opencode/schema/model";
import { Agents, describeTool, type ToolAuthorization } from "./index.ts";
import { CapturedProfile, canonicalJson, type StaticProfile } from "./contracts.ts";
import { AgentRegistrationError } from "./errors.ts";
import { readSkill, skillNames } from "./skills.ts";

export class OpenCodeAgents extends Context.Service<
  OpenCodeAgents,
  {
    readonly register: (
      profiles: readonly StaticProfile[],
    ) => Effect.Effect<void, AgentRegistrationError>;
  }
>()("@abracode/agents/OpenCodeAgents") {}
export const registerSkills = Effect.fn("OpenCodeAgents.skills")(function* (
  ctx: PluginContext,
  root: string,
  central: boolean,
  additional: readonly string[] = [],
) {
  const skills = yield* Effect.forEach(
    [...new Set([...skillNames(central), ...additional])],
    (name) => readSkill(root, name),
  );
  yield* ctx.skill.transform((editor) => {
    for (const skill of skills) editor.add(skill);
  });
});

export const OpenCodeAgentsLive = (
  ctx: PluginContext,
  options: {
    readonly central: boolean;
    readonly skills: string;
    readonly profiles: readonly StaticProfile[];
    readonly supervisorModel?: Model.Ref;
    readonly authorize: ToolAuthorization;
  },
) =>
  Layer.effect(
    OpenCodeAgents,
    Effect.gen(function* () {
      const catalog = yield* Agents;
      const profiles = new Map<string, StaticProfile>();
      let active = false;
      const register = Effect.fn("OpenCodeAgents.register")(function* (
        values: readonly StaticProfile[],
      ) {
        const pending = new Map(profiles);
        for (const value of values) {
          if (!Schema.is(CapturedProfile)(value))
            return yield* new AgentRegistrationError({
              code: "PROFILE_INVALID",
              message: "Invalid captured native profile",
            });
          const implementation = yield* catalog.get(value.definition).pipe(
            Effect.mapError(
              () =>
                new AgentRegistrationError({
                  code: "IMPLEMENTATION_UNAVAILABLE",
                  message: `Definition ${value.definition} is unavailable`,
                }),
            ),
          );
          if (
            implementation.definition.revision !== value.implementation ||
            !implementation.definition.roles.includes(value.role) ||
            JSON.stringify(value.contributions) !==
              JSON.stringify((implementation.definition.customTools ?? []).map(describeTool))
          )
            return yield* new AgentRegistrationError({
              code: "IMPLEMENTATION_INCOMPATIBLE",
              message: `Captured implementation ${value.definition} is incompatible`,
            });
          const existing = pending.get(value.id);
          if (existing && canonicalJson(existing) !== canonicalJson(value))
            return yield* new AgentRegistrationError({
              code: "PROFILE_CONFLICT",
              message: `Conflicting profile ${value.id}`,
            });
          if (!options.central && (value.role === "supervisor" || value.role === "project-lead"))
            continue;
          const clone = yield* Effect.try({
            try: () => JSON.parse(canonicalJson(value)),
            catch: () =>
              new AgentRegistrationError({
                code: "PROFILE_INVALID",
                message: "Native profile is not serializable",
              }),
          }).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(CapturedProfile)),
            Effect.mapError(
              () =>
                new AgentRegistrationError({
                  code: "PROFILE_INVALID",
                  message: "Native profile is not serializable",
                }),
            ),
          );
          pending.set(value.id, clone);
        }
        for (const [id, profile] of pending) profiles.set(id, profile);
        if (active) yield* ctx.agent.reload();
      });
      yield* register(options.profiles);
      const definitions = yield* catalog.list;
      yield* registerSkills(
        ctx,
        options.skills,
        options.central,
        definitions.flatMap((d) => d.skills?.map((s) => s.name) ?? []),
      );
      yield* ctx.agent.transform((editor) => {
        if (options.central) {
          editor.default("abra");
          for (const item of editor.list())
            if (item.id !== "abra")
              editor.update(item.id, (agent) => {
                agent.hidden = true;
              });
        }
        for (const profile of profiles.values())
          editor.update(profile.id, (agent) => {
            agent.name = NativeAgent.Name.make(profile.definition);
            agent.system = profile.system;
            agent.description = profile.description;
            agent.mode = profile.mode;
            agent.hidden = profile.role !== "supervisor";
            const model =
              profile.role === "supervisor"
                ? (options.supervisorModel ?? profile.model)
                : profile.model;
            agent.model = model && {
              providerID: model.providerID,
              id: model.id,
              variant: model.variant,
            };
            agent.permissions = profile.permissions.map((rule) => ({ ...rule }));
          });
      });
      active = true;
      const tools = definitions.flatMap((d) => d.customTools ?? []);
      const existingTools = yield* ctx.tool.list();
      const seen = new Map<string, string>();
      for (const tool of tools) {
        if (seen.has(tool.id))
          return yield* new AgentRegistrationError({
            code: "TOOL_COLLISION",
            message: `Duplicate custom tool ${tool.id}`,
          });
        seen.set(tool.id, tool.revision);
        if (existingTools.some((t) => t.id === tool.id))
          return yield* new AgentRegistrationError({
            code: "TOOL_COLLISION",
            message: `Native tool ${tool.id} already exists`,
          });
      }
      // Runtime-owned tools remain referenced only; this transform adds authored contributions.
      yield* ctx.tool.transform((editor) => {
        for (const tool of tools) {
          if (editor.get(tool.id))
            throw new AgentRegistrationError({
              code: "TOOL_COLLISION",
              message: `Native tool ${tool.id} already exists`,
            });
          tool.register(editor, options.authorize);
        }
      });
      yield* ctx.tool.hook("execute.before", (call) => {
        const tool = tools.find((t) => t.id === call.tool);
        return tool
          ? options.authorize(tool, {
              sessionID: call.sessionID,
              agent: call.agent,
              messageID: call.messageID,
              id: call.id,
              // Authorization consumes identity only; the native handler receives the complete context.
            })
          : Effect.void;
      });
      return { register };
    }),
  );
