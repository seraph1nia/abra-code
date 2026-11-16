import { Schema } from "effect";
import { ResourceSelectionSchema } from "./resources.ts";
import {
  CreateSurfaceMessageSchema,
  getComponentReferences,
  MessageProcessor,
  STRICT_VALIDATION,
} from "@a2ui/web_core/v1_0";
import {
  catalogId,
  ComponentId,
  ComponentSchema,
  legacyCatalogId,
  validationCatalog,
  workComponents,
} from "./catalog.ts";
export { catalogId, componentNames } from "./catalog.ts";

/** The owned publication interface is a bounded, complete A2UI surface revision. */
const PublicationSchema = Schema.Struct({
  version: Schema.Literal("1.0"),
  createSurface: Schema.Struct({
    surfaceId: ComponentId,
    catalogId: Schema.Literal(catalogId),
    components: Schema.Array(ComponentSchema).check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  }),
}).annotate({ parseOptions: { onExcessProperty: "error" }, reportInput: false });
export const SurfaceSchema = PublicationSchema.check(
  Schema.makeFilter(
    (value) => {
      try {
        validateSurface(value);
        return true;
      } catch {
        return false;
      }
    },
    { expected: "A complete bounded work surface", toJsonSchema: () => ({}) },
  ),
);
export type WorkSurface = typeof SurfaceSchema.Type;
export type WorkComponent = WorkSurface["createSurface"]["components"][number];
export const toSdkSurface = (surface: WorkSurface) => CreateSurfaceMessageSchema.parse(surface);

export const surfaceValidation = {
  ...STRICT_VALIDATION,
  targetVersion: "1.0",
  maxDepth: 10,
  allowedMessages: ["createSurface"],
};

export function referencedWorkIds(surface: WorkSurface): string[] {
  return surface.createSurface.components.flatMap((component) => {
    const refs = component.issueIds;
    return [
      ...(Array.isArray(refs) ? refs.filter((id): id is string => typeof id === "string") : []),
      ...(typeof component.issueId === "string" ? [component.issueId] : []),
      ...(component.component === "ResourceLink"
        ? [Schema.decodeUnknownSync(ResourceSelectionSchema)(component.target).issue_id]
        : []),
    ];
  });
}
export function surfaceResources(surface: WorkSurface) {
  return surface.createSurface.components.flatMap((component) =>
    component.component === "ResourceLink"
      ? [Schema.decodeUnknownSync(ResourceSelectionSchema)(component.target)]
      : [],
  );
}

/** Validate the complete replacement before committing or changing a displayed revision. */
export function validateSurface(value: unknown, workIds?: ReadonlySet<string>): WorkSurface {
  if (new TextEncoder().encode(JSON.stringify(value)).length > 65536)
    throw new Error("Surface exceeds the 64 KiB limit");
  CreateSurfaceMessageSchema.parse(value);
  const surface = Schema.decodeUnknownSync(PublicationSchema)(value, { onExcessProperty: "error" });
  const components = new Map<string, WorkComponent>();
  for (const c of surface.createSurface.components) {
    const id = Schema.decodeUnknownSync(ComponentId)(c.id);
    if (components.has(id)) throw new Error("Repeated component identity");
    if (c.component === "ResourceLink")
      Schema.decodeUnknownSync(ResourceSelectionSchema)(c.target, { onExcessProperty: "error" });
    // This publication interface intentionally retains the existing static layouts/text.
    if (c.component === "Text" && (typeof c.text !== "string" || c.text.length > 4096))
      throw new Error("Text requires bounded literal text");
    if (
      (c.component === "Column" || c.component === "Row") &&
      (!Array.isArray(c.children) ||
        c.children.length > 100 ||
        c.children.some((id) => typeof id !== "string"))
    )
      throw new Error("Layout requires bounded child IDs");
    components.set(id, c);
  }
  const refs = referencedWorkIds(surface);
  if (new Set(refs).size > 100 || (workIds && refs.some((id) => !workIds.has(id))))
    throw new Error("Unknown or excessive work references");
  const seen = new Set<string>();
  function visit(id: string, depth: number) {
    const c = components.get(id);
    if (!c || seen.has(id) || depth > 10) throw new Error("Missing, repeated or cyclic component");
    seen.add(id);
    for (const [child] of getComponentReferences(c, validationCatalog)) visit(child, depth + 1);
  }
  visit("root", 0);
  if (seen.size !== components.size) throw new Error("Unreachable component");
  const processor = new MessageProcessor([validationCatalog], undefined, {
    version: "1.0",
    validationConfig: surfaceValidation,
  });
  try {
    processor.processMessages(toSdkSurface(surface));
  } finally {
    processor.dispose();
  }
  return surface;
}

/** Normalize legacy rendering semantics on read, without rewriting native storage. */
export function normalizeSurface(value: unknown): WorkSurface {
  const json = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Json))(value);
  const create = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Json))(
    json.createSurface,
  );
  if (create.catalogId !== legacyCatalogId) return validateSurface(value);
  const components = Schema.decodeUnknownSync(
    Schema.Array(Schema.Record(Schema.String, Schema.Json)),
  )(create.components);
  return validateSurface({
    version: json.version,
    createSurface: {
      surfaceId: create.surfaceId,
      catalogId,
      components: components.map((c) => {
        const common = { id: c.id, component: c.component };
        if (c.component === "Column" || c.component === "Row")
          return { ...common, children: c.children ?? [] };
        if (c.component === "Text") return { ...common, text: c.text ?? "" };
        if (c.component === "ReportLink") return { ...common, issueId: c.issueId };
        if (typeof c.component !== "string" || !Object.hasOwn(workComponents, c.component))
          throw new Error("Unknown legacy component");
        return {
          ...common,
          ...(c.issueIds !== undefined
            ? { issueIds: c.issueIds }
            : c.issueId !== undefined
              ? { issueIds: [c.issueId] }
              : {}),
          ...(c.mode !== undefined ? { mode: c.mode } : {}),
        };
      }),
    },
  });
}
