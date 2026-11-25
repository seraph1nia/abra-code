import { Schema } from "effect";

type Codecs = Readonly<Record<string, Schema.Codec<unknown, unknown>>>;
type Method = {
  input: Schema.Codec<unknown, unknown>;
  output: Schema.Codec<unknown, unknown>;
  errors: Codecs;
};
type Definition = {
  id: string;
  methods: Record<string, Method>;
  events: Record<string, { schema: Schema.Codec<unknown, unknown> }>;
};
type Portable<S extends Schema.Codec<unknown, unknown>> = ReturnType<
  typeof Schema.toStandardSchemaV1<S>
>;
type Methods<D extends Definition> = {
  [K in keyof D["methods"]]: {
    input: Portable<D["methods"][K]["input"]>;
    output: Portable<D["methods"][K]["output"]>;
    errors: { [N in keyof D["methods"][K]["errors"]]: Portable<D["methods"][K]["errors"][N]> };
  };
};

/** The Promise SDK used by the external journey accepts portable definitions only. */
export function portableRpc<D extends Definition>(definition: D) {
  const methods = Object.fromEntries(
    Object.entries(definition.methods).map(([key, method]) => [
      key,
      {
        input: Schema.toStandardSchemaV1(method.input),
        output: Schema.toStandardSchemaV1(method.output),
        errors: Object.fromEntries(
          Object.entries(method.errors).map(([key, value]) => [
            key,
            Schema.toStandardSchemaV1(value),
          ]),
        ),
      },
    ]),
  ) as Methods<D>;
  const events = Object.fromEntries(
    Object.entries(definition.events).map(([key, value]) => [
      key,
      { schema: Schema.toStandardSchemaV1(value.schema) },
    ]),
  ) as {
    [K in keyof D["events"]]: { schema: Portable<D["events"][K]["schema"]> };
  };
  return { id: definition.id, methods, events };
}
