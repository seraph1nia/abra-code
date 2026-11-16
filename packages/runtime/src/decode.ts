import { Effect, Schema } from "effect";
import { CrewError } from "./domain.ts";

/** Diagnostics intentionally exclude supplied payloads, environments and native error causes. */
export function decode<S extends Schema.Constraint>(schema: S, input: unknown, source: string) {
  return Schema.decodeUnknownEffect(schema, { reportInput: false })(input).pipe(
    Effect.mapError(
      (error) => new CrewError("INVALID_DATA", `${source}: ${error.message.slice(0, 2048)}`),
    ),
  );
}
export function decodeJSON<S extends Schema.Constraint>(schema: S, output: string, source: string) {
  return decode(Schema.fromJsonString(schema), output, source);
}
/** Synchronous transactions keep parsing inside their atomic action. */
export function decodeSync<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  input: unknown,
  source: string,
): S["Type"] {
  try {
    return Schema.decodeUnknownSync(schema, { reportInput: false })(input);
  } catch (error) {
    throw new CrewError(
      "INVALID_DATA",
      `${source}: ${error instanceof Error ? error.message.slice(0, 2048) : "Invalid data"}`,
    );
  }
}
