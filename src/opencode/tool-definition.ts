import { Effect, Schema, SchemaIssue } from "effect";
import { Tool } from "@opencode/schema/tool";
import { type ToolEditor } from "@opencode/plugin/effect/tool";
import { type SessionId } from "../identities.ts";
import { CrewError } from "../domain.ts";
import { decodeJSON } from "../decode.ts";
import { ToolProgress } from "./progress.ts";
import { diagnosticText } from "./diagnostics.ts";

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
  run: (input: NoInfer<I>, session: SessionId) => Effect.Effect<NoInfer<O>, CrewError>;
  worker?: boolean;
}) {
  const output: Schema.Codec<{ readonly ok: true; readonly result?: O }, unknown> = Schema.Struct({
    ok: Schema.Literal(true),
    result: Schema.optional(d.output),
  });
  return {
    worker: d.worker,
    register(
      editor: ToolEditor,
      authorize: (
        name: string,
        worker: boolean,
        context: Tool.Context,
      ) => Effect.Effect<void, CrewError>,
      provide: <A, E>(effect: Effect.Effect<A, E>) => Effect.Effect<A, E>,
    ) {
      editor.add({
        name: d.name,
        description: d.description,
        input: strictInput(d.input),
        output,
        options: { namespace: "abra", codemode: false, permission: `abra_${d.name}` },
        execute: (input, context) =>
          authorize(d.name, !!d.worker, context).pipe(
            Effect.andThen(
              d
                .run(input, context.sessionID)
                .pipe(Effect.provideService(ToolProgress, context.progress)),
            ),
            Effect.flatMap((result) =>
              decodeJSON(output, JSON.stringify({ ok: true, result }), `abra_${d.name} output`),
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
                    action: d.name.startsWith("project")
                      ? "Inspect project_list and the onboarding/recovery runbook; preserve resources."
                      : d.name === "work_create"
                        ? "Inspect work_list; reuse the same request_id after repair."
                        : "Inspect work_status and the recovery runbook; preserve resources.",
                  },
                }),
            ),
            provide,
          ),
      });
    },
  };
}
