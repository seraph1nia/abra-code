import { Schema } from "effect";
import type { basicCatalog } from "@a2ui/web_core/v1_0";

export const catalogObject = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Json));

/** The SDK uses the document union to discover custom components and their child references. */
export function createCatalogDocument(
  base: ReturnType<typeof basicCatalog.toJson>,
  options: {
    catalogId: string;
    title: string;
    instructions: string;
    components: Record<string, unknown>;
    definitions: Record<string, unknown>;
  },
) {
  const { catalogId, title, instructions, components, definitions } = options;
  return {
    ...base,
    protocolVersion: "1.0",
    $id: catalogId,
    catalogId,
    title,
    instructions,
    components,
    functions: catalogObject(base.functions),
    $defs: {
      ...catalogObject(base.$defs),
      ...definitions,
      anyComponent: {
        discriminator: { propertyName: "component" },
        oneOf: Object.keys(components).map((name) => ({ $ref: `#/components/${name}` })),
      },
    },
  };
}
