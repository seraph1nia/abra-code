import { Schema, SchemaIssue } from "effect";
import { Tool } from "@opencode/schema/tool";
export function diagnosticText(text: string, limit = 1500): string {
  let result = text;
  for (const [name, value] of Object.entries(process.env))
    if (/key|token|password|secret/i.test(name) && value && value.length >= 4)
      result = result.replaceAll(value, "[redacted]");
  return result
    .replace(/Bearer\s+[\w.~+/=-]+/gi, "Bearer [redacted]")
    .replace(
      /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*["']?\s*[:=]\s*["']?)[^\s"',}]+/gi,
      "$1[redacted]",
    )
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[redacted]@")
    .slice(0, limit);
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
      validate: (value: unknown) => {
        const decoded = Schema.decodeUnknownResult(schema, {
          onExcessProperty: "error",
          errors: "all",
        })(value);
        return decoded._tag === "Failure"
          ? format(decoded.failure.issue)
          : { value: decoded.success };
      },
    },
  };
}

export const toToolError = (code: string, message: string, action?: string, reason?: string) =>
  new Tool.Error({
    message: diagnosticText(message),
    metadata: {
      code,
      ...(reason ? { reason: diagnosticText(reason) } : {}),
      ...(action ? { action } : {}),
    },
  });
