import { Effect, Schema, SchemaIssue } from "effect";
import { Tool } from "@opencode/schema/tool";
import { type ToolEditor } from "@opencode/plugin/effect/tool";
import { type SessionId } from "@abracode/contracts/identities";
import { CrewError } from "../domain.ts";
import { ToolProgress } from "./progress.ts";
import { diagnosticText } from "./diagnostics.ts";

export type ToolAccess = { worker: boolean; diagnostic: boolean; lead?: boolean };

const DEFAULT_RECOVERY_HINT = "Inspect work_status and the recovery runbook; preserve resources.";

/** Recursively omit keys whose value is undefined so in-memory outputs match JSON wire shape. */
export function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripUndefined) as T;
  if (
    value !== null &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value))
      if (entry !== undefined) out[key] = stripUndefined(entry);
    return out as T;
  }
  return value;
}

/** Keep strict decoding at the host boundary, including the pinned host's schema bridge. */
export function strictInput<S extends Schema.Codec<unknown, unknown>>(schema: S) {
  const standard = Schema.toStandardSchemaV1(schema);
  const document = Schema.toJsonSchemaDocument(schema, { onExcessProperty: "error" });
  const json = {
    ...document.schema,
    ...(Object.keys(document.definitions).length ? { $defs: document.definitions } : {}),
  };
  const format = SchemaIssue.makeFormatterStandardSchemaV1();
  return {
    "~standard": {
      ...standard["~standard"],
      // The built-in input-repair hook leaves composed objects intact. Otherwise it
      // silently drops excess properties before our strict validator can reject them.
      jsonSchema: {
        input: () => ({
          type: "object" as const,
          allOf: [document.schema],
          ...(Object.keys(document.definitions).length ? { $defs: document.definitions } : {}),
        }),
        output: () => json,
      },
      validate: (value: unknown) =>
        Effect.runSync(
          Schema.decodeUnknownEffect(schema)(value, {
            onExcessProperty: "error",
            errors: "all",
          }).pipe(
            Effect.match({
              onFailure: (error) => format(error.issue),
              onSuccess: (value) => ({ value }),
            }),
          ),
        ),
    },
  };
}

export function defineTool<I, O>(d: {
  name: string;
  description: string;
  input: Schema.Codec<I, unknown>;
  output: Schema.Codec<O, unknown>;
  run: (
    input: NoInfer<I>,
    session: SessionId,
    context: Tool.Context,
  ) => Effect.Effect<NoInfer<O>, CrewError>;
  worker?: boolean;
  lead?: boolean;
  diagnostic?: boolean | ((input: NoInfer<I>) => boolean);
  recoveryHint?: string;
}) {
  const output: Schema.Codec<{ readonly ok: true; readonly result?: O }, unknown> = Schema.Struct({
    ok: Schema.Literal(true),
    result: Schema.optional(d.output),
  });
  return {
    worker: d.worker,
    register(
      editor: ToolEditor,
      authorize: (access: ToolAccess, context: Tool.Context) => Effect.Effect<void, CrewError>,
      provide: <A, E>(effect: Effect.Effect<A, E>) => Effect.Effect<A, E>,
    ) {
      editor.add({
        name: d.name,
        description: d.description,
        input: strictInput(d.input),
        output,
        options: { namespace: "abra", codemode: false, permission: `abra_${d.name}` },
        execute: (input, context) =>
          authorize(
            {
              worker: !!d.worker,
              lead: d.lead,
              diagnostic:
                typeof d.diagnostic === "function" ? d.diagnostic(input) : d.diagnostic === true,
            },
            context,
          ).pipe(
            Effect.andThen(
              Effect.suspend(() => d.run(input, context.sessionID, context)).pipe(
                Effect.provideService(ToolProgress, context.progress),
              ),
            ),
            Effect.flatMap((result) =>
              Schema.decodeUnknownEffect(Schema.toType(output), { reportInput: false })(
                stripUndefined({
                  ok: true,
                  ...(result === undefined ? {} : { result }),
                }),
              ).pipe(
                Effect.mapError(
                  (error) =>
                    new CrewError(
                      "INVALID_DATA",
                      `abra_${d.name} output: ${error.message.slice(0, 2048)}`,
                    ),
                ),
              ),
            ),
            Effect.map((value) => ({
              output: value,
              content: JSON.stringify(value),
              metadata: { abracode: true },
            })),
            Effect.mapError(
              (error) =>
                new Tool.Error({
                  message: `${error.code}: ${diagnosticText(error.message)}`,
                  metadata: {
                    code: error.code,
                    action: d.recoveryHint ?? DEFAULT_RECOVERY_HINT,
                  },
                }),
            ),
            provide,
          ),
      });
    },
  };
}

export type DefinedTool = ReturnType<typeof defineTool>;
