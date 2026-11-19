/* oxlint-disable effecttsgo/unstable-api-usage -- Injected pinned Effect 4.1.4 filesystem/path services. */
import { Context, Effect, FileSystem, Layer, Path, Schema, Scope } from "effect";
import type { Agent as NativeAgent } from "@opencode/schema/agent";
import { Tool } from "@opencode/schema/tool";
import type { ToolEditor } from "@opencode/plugin/effect/tool";
import {
  AssignmentRole,
  type PrepareAgentInput,
  type StaticProfile,
  PreparedAgent,
  CapturedProfile,
  PrepareFacts,
  Fragment,
  Identity,
  profileRevision,
  digest,
  preparedDigest,
  canonicalJson,
} from "./contracts.ts";
import { AgentDefinitionError } from "./errors.ts";
import {
  capabilityRequirements,
  leadPermissions,
  leadAllows,
  nativePermissions,
  policyAllows,
  validDenial,
} from "./policy.ts";
import { readSkill } from "./skills.ts";
import type { CapabilityRequirements } from "./capabilities.ts";
export * from "./contracts.ts";
export * from "./errors.ts";

export class AgentSources extends Context.Service<
  AgentSources,
  {
    readonly assets: string;
    readonly skills: string;
  }
>()("@abracode/agents/Sources") {}
export type ToolAuthorization = (
  descriptor: {
    readonly id: string;
    readonly revision: string;
    readonly action: "read";
    readonly schema_digest: string;
  },
  context: Pick<Tool.Context, "sessionID" | "agent" | "messageID" | "id">,
) => Effect.Effect<void, Tool.Error>;
export interface CustomTool {
  readonly id: string;
  readonly revision: string;
  readonly action: "read";
  readonly schema_digest: string;
  readonly input: Schema.Constraint;
  readonly output: Schema.Constraint;
  readonly register: (editor: ToolEditor, authorize: ToolAuthorization) => void;
}
/** Type parameters remain inside this closure, rather than casting handlers at registration. */
export const customTool = <I, O, E>(options: {
  readonly id: string;
  readonly revision: string;
  readonly description: string;
  readonly action: "read";
  readonly input: Schema.Codec<I, unknown>;
  readonly output: Schema.Codec<O, unknown>;
  readonly run: (input: NoInfer<I>, context: Tool.Context) => Effect.Effect<NoInfer<O>, E>;
}): CustomTool => {
  const schema_digest =
    Schema.isSchema(options.input) && Schema.isSchema(options.output)
      ? digest(
          canonicalJson({
            input: Schema.toJsonSchemaDocument(options.input),
            output: Schema.toJsonSchemaDocument(Schema.toType(options.output)),
            encoded_output: Schema.toJsonSchemaDocument(options.output),
          }),
        )
      : "";
  return {
    id: options.id,
    revision: options.revision,
    action: options.action,
    schema_digest,
    input: options.input,
    output: options.output,
    register: (editor, authorize) =>
      editor.add({
        name: options.id,
        description: options.description,
        input: options.input,
        output: options.output,
        options: { permission: "read", codemode: false },
        execute: (input, context) =>
          authorize({ ...options, schema_digest }, context).pipe(
            Effect.andThen(Effect.suspend(() => options.run(input, context))),
            Effect.flatMap((value) =>
              Schema.decodeUnknownEffect(Schema.toType(options.output))(value),
            ),
            Effect.map((output) => ({ output, content: JSON.stringify(output) })),
            Effect.mapError(
              () =>
                new Tool.Error({
                  message: `Custom tool ${options.id} failed`,
                  metadata: { code: "AGENT_TOOL" },
                }),
            ),
          ),
      }),
  };
};
export const describeTool = ({ id, revision, action, schema_digest }: CustomTool) => ({
  id,
  revision,
  action,
  schema_digest,
});
export interface AgentDefinition<R = never> {
  readonly id: string;
  readonly revision: string;
  readonly description: string;
  readonly mode: NativeAgent.Info["mode"];
  readonly roles: readonly AssignmentRole[];
  readonly model?: NativeAgent.Info["model"];
  readonly instructions: readonly ({ readonly file: string } | { readonly inline: string })[];
  readonly tools?: readonly string[];
  readonly customTools?: readonly CustomTool[];
  readonly skills?: readonly { readonly name: string; readonly preload?: boolean }[];
  readonly requirements?: CapabilityRequirements;
  /** Additional denials only. Requirements and declarations never grant native authority. */
  readonly deny?: readonly string[];
  readonly context?: (
    input: Readonly<Omit<PrepareAgentInput, "captured">>,
  ) => Effect.Effect<readonly Fragment[], AgentDefinitionError, R>;
}
export type AgentInstruction =
  | { readonly kind: "inline"; readonly content: string }
  | {
      readonly kind: "file";
      readonly path: string;
      readonly content?: string;
      readonly error?: string;
    };
export interface AgentService {
  readonly definition: AgentDefinition;
  /** Authored sources only; does not prepare context, skills or tools. */
  readonly readInstructions: Effect.Effect<readonly AgentInstruction[]>;
  readonly resolve: (role: AssignmentRole) => Effect.Effect<StaticProfile, AgentDefinitionError>;
  readonly prepare: (
    input: PrepareAgentInput,
  ) => Effect.Effect<PreparedAgent, AgentDefinitionError>;
}
export class Agent extends Context.Service<Agent, AgentService>()("@abracode/agents/Agent") {}

const frozenInput = (input: PrepareAgentInput) =>
  Object.freeze({
    role: input.role,
    workflow: input.workflow,
    task: Object.freeze({
      id: input.task.id,
      title: input.task.title,
      description: input.task.description,
    }),
    repository: Object.freeze({
      id: input.repository.id,
      directory: input.repository.directory,
      base: input.repository.base,
    }),
    configuredModel:
      input.configuredModel &&
      Object.freeze({
        providerID: input.configuredModel.providerID,
        id: input.configuredModel.id,
        variant: input.configuredModel.variant,
      }),
    nativeOverride: input.nativeOverride,
  });
export const makeAgent = <R>(definition: AgentDefinition<R>) =>
  Effect.gen(function* () {
    const environment = yield* Effect.context<
      R | FileSystem.FileSystem | Path.Path | AgentSources
    >();
    const fs = Context.get(environment, FileSystem.FileSystem);
    const path = Context.get(environment, Path.Path);
    const sources = Context.get(environment, AgentSources);
    const fail = (code: string, message: string, source?: string) =>
      new AgentDefinitionError({ code, definition: definition.id, message, source });
    const readInstruction = (source: AgentDefinition["instructions"][number]) => {
      if ("inline" in source) return Effect.succeed(source.inline);
      const file = path.resolve(sources.assets, source.file);
      const relative = path.relative(sources.assets, file);
      if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`))
        return Effect.fail(
          fail("INVALID_SOURCE", "Instruction source escapes package assets", source.file),
        );
      return fs
        .readFileString(file)
        .pipe(Effect.mapError(() => fail("SOURCE", "Cannot read instruction source", source.file)));
    };
    const readInstructions = Effect.forEach(
      definition.instructions,
      (source): Effect.Effect<AgentInstruction> => {
        if ("inline" in source)
          return Effect.succeed({ kind: "inline" as const, content: source.inline });
        return readInstruction(source).pipe(
          Effect.map((content) => ({ kind: "file" as const, path: source.file, content })),
          Effect.catch((error) =>
            Effect.succeed({ kind: "file" as const, path: source.file, error: error.message }),
          ),
        );
      },
    );
    if (
      !Schema.is(Identity)(definition.id) ||
      !definition.revision ||
      !definition.description ||
      !Array.isArray(definition.roles) ||
      !definition.roles.length ||
      !definition.roles.every((role) => Schema.is(AssignmentRole)(role)) ||
      !Array.isArray(definition.instructions) ||
      !definition.instructions.every(
        (source) =>
          source !== null &&
          typeof source === "object" &&
          ("inline" in source
            ? typeof source.inline === "string"
            : "file" in source && typeof source.file === "string"),
      ) ||
      !["subagent", "primary", "all"].includes(definition.mode) ||
      (definition.context !== undefined && typeof definition.context !== "function") ||
      new Set(definition.skills?.map((skill) => skill.name)).size !==
        (definition.skills?.length ?? 0) ||
      definition.deny?.some((action) => !validDenial(action))
    )
      return yield* fail(
        "INVALID_DEFINITION",
        "Definition requires a stable identity, revision, description and compatible roles",
      );
    const custom = definition.customTools ?? [];
    if (new Set(custom.map((t) => t.id)).size !== custom.length)
      return yield* fail("TOOL_COLLISION", "Duplicate custom tool identity");
    for (const tool of custom)
      if (
        !Schema.is(Identity)(tool.id) ||
        !tool.revision ||
        tool.id.startsWith("abra-") ||
        [
          "read",
          "glob",
          "grep",
          "list",
          "skill",
          "task",
          "shell",
          "bash",
          "edit",
          "write",
          "patch",
        ].includes(tool.id) ||
        tool.action !== "read" ||
        !tool.schema_digest ||
        !Schema.isSchema(tool.input) ||
        !Schema.isSchema(tool.output)
      )
        return yield* fail(
          "INVALID_TOOL",
          "Custom tool must declare a nonreserved identity, revision and supported read capability",
          tool.id,
        );
    const resolve = Effect.fn("Agent.resolve")(function* (role: AssignmentRole) {
      if (!definition.roles.includes(role))
        return yield* fail("INCOMPATIBLE_ROLE", `Definition is incompatible with ${role}`);
      for (const tool of definition.tools ?? [])
        if (role === "project-lead" ? !leadAllows(tool) : !policyAllows(role, tool))
          return yield* fail("CAPABILITY_POLICY", `Native tool ${tool} exceeds ${role} authority`);
      if (role !== "supervisor" && role !== "project-lead")
        yield* Effect.try({
          try: () => capabilityRequirements(role, "lightweight-fix", definition.requirements),
          catch: () =>
            fail("CAPABILITY_POLICY", `Definition requirements exceed ${role} authority`),
        });
      for (const tool of custom)
        if (role === "project-lead" || !policyAllows(role, tool.action))
          return yield* fail(
            "CAPABILITY_POLICY",
            `Custom tool ${tool.id} exceeds ${role} authority`,
          );
      const instructions = yield* Effect.forEach(definition.instructions, readInstruction);
      const skills = yield* Effect.forEach(definition.skills ?? [], (ref) =>
        readSkill(sources.skills, ref.name).pipe(
          Effect.provide(environment),
          Effect.map((skill) => ({
            id: skill.id,
            preload: !!ref.preload,
            digest: digest(skill.content),
            ...(ref.preload ? { content: skill.content } : {}),
          })),
        ),
      );
      const system = [
        ...instructions.map((s) => s.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim()),
        ...skills.filter((s) => s.preload).map((s) => s.content!),
      ]
        .filter(Boolean)
        .join("\n\n");
      if (!system) return yield* fail("INVALID_SOURCE", "Resolved instructions are empty");
      const material: Omit<StaticProfile, "revision" | "id"> = {
        version: 1,
        definition: definition.id,
        implementation: definition.revision,
        role,
        description: definition.description,
        system,
        instruction_sources: definition.instructions.map((source, index) => ({
          kind: "file" in source ? ("file" as const) : ("inline" as const),
          source: "file" in source ? source.file : `inline:${index}`,
          digest: digest(instructions[index]),
        })),
        mode: definition.mode,
        ...(definition.model ? { model: definition.model } : {}),
        permissions: [
          ...(role === "project-lead" ? leadPermissions() : nativePermissions(role)),
          ...(definition.deny ?? []).map((action) => ({
            action,
            resource: "*",
            effect: "deny" as const,
          })),
        ],
        skills,
        tools: [...(definition.tools ?? [])],
        requirements: definition.requirements ?? {},
        contributions: custom.map(describeTool),
      };
      const revision = profileRevision(material);
      return yield* Schema.decodeEffect(CapturedProfile)({
        ...material,
        revision,
        id: NativeID(role, definition.id, revision),
      }).pipe(
        Effect.mapError(() => fail("INVALID_DEFINITION", "Resolved static definition is invalid")),
      );
    });
    const prepare = Effect.fn("Agent.prepare")(function* (input: PrepareAgentInput) {
      const facts = yield* Schema.decodeEffect(PrepareFacts)({
        task: input.task,
        repository: input.repository,
      }).pipe(
        Effect.mapError(() =>
          fail("INVALID_CONTEXT", "Preparation facts exceed the bounded input contract"),
        ),
      );
      const profile = input.captured ?? (yield* resolve(input.role));
      if (
        !Schema.is(CapturedProfile)(profile) ||
        profile.role !== input.role ||
        profile.definition !== definition.id ||
        profile.implementation !== definition.revision ||
        !definition.roles.includes(input.role) ||
        JSON.stringify(profile.contributions) !== JSON.stringify(custom.map(describeTool))
      )
        return yield* fail(
          "INCOMPATIBLE_CAPTURE",
          "Captured definition implementation is unavailable or incompatible",
        );
      const fragments = definition.context
        ? yield* Effect.scoped(
            Effect.gen(function* () {
              const scope = yield* Scope.Scope;
              return yield* Effect.suspend(() =>
                definition.context!(frozenInput({ ...input, ...facts })),
              ).pipe(
                Effect.mapError(() => fail("PROVIDER", "Context provider failed")),
                Effect.provide(Context.add(environment, Scope.Scope, scope)),
              );
            }),
          )
        : [];
      const material = {
        version: 1,
        profile,
        fragments,
        model: input.configuredModel ?? profile.model,
        delivery: input.nativeOverride ? "external" : "native",
        native_agent: input.nativeOverride ?? profile.id,
      } as const;
      return yield* Schema.decodeEffect(PreparedAgent)({
        ...material,
        digest: preparedDigest(material),
      }).pipe(
        Effect.mapError(() =>
          fail("INVALID_CONTEXT", "Prepared context contains invalid or duplicate fragments"),
        ),
      );
    });
    // The public view does not expose an unbound provider environment.
    return {
      definition: { ...definition, context: undefined },
      readInstructions,
      resolve,
      prepare,
    } satisfies AgentService;
  });
import { Agent as Native } from "@opencode/schema/agent";
const NativeID = (role: AssignmentRole, id: string, revision: string) =>
  Native.ID.make(
    role === "supervisor"
      ? "abra"
      : role === "project-lead"
        ? "project-lead"
        : `abra-${id}-${revision}`,
  );
export const agentLayer = <R>(definition: AgentDefinition<R>) =>
  Layer.effect(Agent, makeAgent(definition));
export interface AgentsService {
  readonly list: Effect.Effect<readonly AgentDefinition[]>;
  readonly get: (id: string) => Effect.Effect<AgentService, AgentDefinitionError>;
  readonly prepare: (
    id: string,
    input: PrepareAgentInput,
  ) => Effect.Effect<PreparedAgent, AgentDefinitionError>;
}
export class Agents extends Context.Service<Agents, AgentsService>()("@abracode/agents/Agents") {}
export const makeCatalog = (agents: readonly AgentService[]) =>
  Effect.gen(function* () {
    const byId = new Map<string, AgentService>();
    for (const agent of agents) {
      const id = agent.definition.id;
      if (byId.has(id))
        return yield* new AgentDefinitionError({
          code: "DUPLICATE_DEFINITION",
          definition: id,
          message: `Duplicate definition ${id}`,
        });
      byId.set(id, agent);
    }
    const get = Effect.fn("Agents.get")((
      id: string,
    ): Effect.Effect<AgentService, AgentDefinitionError> => {
      const agent = byId.get(id);
      return agent
        ? Effect.succeed(agent)
        : Effect.fail(
            new AgentDefinitionError({
              code: "UNKNOWN_DEFINITION",
              definition: id,
              message: `Unknown definition ${id}`,
            }),
          );
    });
    return {
      list: Effect.sync(() => agents.map((a) => a.definition)).pipe(Effect.withSpan("Agents.list")),
      get,
      prepare: Effect.fn("Agents.prepare")((id: string, input: PrepareAgentInput) =>
        get(id).pipe(Effect.flatMap((a) => a.prepare(input))),
      ),
    } satisfies AgentsService;
  });
