import { stripUndefined } from "../json-wire.ts";
import { Effect, Schema } from "effect";
import { Tool } from "@opencode/schema/tool";
import { type ToolEditor } from "@opencode/plugin/effect/tool";
import { type SessionId } from "@abracode/contracts/identities";
import { CrewError } from "../domain.ts";
import { ToolProgress } from "./progress.ts";
import { strictInput, toToolError } from "@abracode/agents/tool-boundary";

export type ToolAudience = "supervisor" | "worker" | "supervisor_or_worker" | "lead";
export type ToolAccess = { audience: ToolAudience; diagnostic: boolean };

const DEFAULT_RECOVERY_HINT = "Inspect work_status and the recovery runbook; preserve resources.";

export { strictInput };
export function defineTool<I, O>(
  d: {
    name: string;
    description: string;
    input: Schema.Codec<I, unknown>;
    output: Schema.Codec<O, unknown>;
    access?: ToolAudience;
    diagnostic?: boolean | ((input: NoInfer<I>) => boolean);
    recoveryHint?: string;
  } & (
    | {
        run: (
          input: NoInfer<I>,
          session: SessionId,
          context: Tool.Context,
        ) => Effect.Effect<NoInfer<O>, CrewError>;
      }
    | {
        runJson: (
          input: NoInfer<I>,
          session: SessionId,
          context: Tool.Context,
        ) => Effect.Effect<Schema.Json, CrewError>;
      }
  ),
) {
  const output: Schema.Codec<{ readonly ok: true; readonly result?: O }, unknown> = Schema.Struct({
    ok: Schema.Literal(true),
    result: Schema.optional(d.output),
  });
  return {
    audience: d.access ?? "supervisor",
    register(
      editor: ToolEditor,
      authorize: (access: ToolAccess, context: Tool.Context) => Effect.Effect<void, CrewError>,
      provide: <A, E>(effect: Effect.Effect<A, E>) => Effect.Effect<A, E>,
    ) {
      editor.add({
        name: d.name,
        description: d.description,
        input: strictInput(d.input),
        output: Schema.toEncoded(output),
        options: { namespace: "abra", codemode: false, permission: `abra_${d.name}` },
        execute: (input, context) =>
          authorize(
            {
              audience: d.access ?? "supervisor",
              diagnostic:
                typeof d.diagnostic === "function" ? d.diagnostic(input) : d.diagnostic === true,
            },
            context,
          ).pipe(
            Effect.andThen(
              Effect.suspend<O | Schema.Json, CrewError, never>(() =>
                "run" in d
                  ? d.run(input, context.sessionID, context)
                  : d.runJson(input, context.sessionID, context),
              ).pipe(Effect.provideService(ToolProgress, context.progress)),
            ),
            Effect.flatMap((result) => {
              const value = stripUndefined({
                ok: true as const,
                ...(result === undefined ? {} : { result }),
              });
              return Schema.encodeUnknownEffect(output, { reportInput: false })(value).pipe(
                Effect.map((wire) => ({
                  output: wire,
                  content: JSON.stringify(wire),
                  metadata: { abracode: true },
                })),
                Effect.mapError(
                  (error) =>
                    new CrewError(
                      "INVALID_DATA",
                      `abra_${d.name} output: ${error.message.slice(0, 2048)}`,
                    ),
                ),
              );
            }),
            Effect.mapError((error) =>
              toToolError(
                error.code,
                `${error.code}: ${error.message}`,
                d.recoveryHint ?? DEFAULT_RECOVERY_HINT,
              ),
            ),
            provide,
          ),
      });
    },
  };
}

export type DefinedTool = ReturnType<typeof defineTool>;
