import { utf8Bytes } from "../utf8.ts";
import { validateChart, chartComponents } from "./charts.ts";
import { collectDiagrams, diagramBudget } from "../presentation/diagrams.ts";
import { Schema } from "effect";
import { exactParseOptions } from "../primitives.ts";
import { ResourceSelectionSchema } from "./resources.ts";
import {
  DataModel,
  getComponentReferences,
  MessageProcessor,
  STRICT_VALIDATION,
} from "@a2ui/web_core/v1_0";
import {
  catalogId,
  contentProps,
  isChartComponent,
  SurfaceId,
  ComponentSchema,
  validationCatalog,
} from "./catalog.ts";
export { catalogId, componentNames } from "./catalog.ts";

export const maxSurfaceBytes = 384 * 1024;

/** The owned publication interface is a bounded, complete A2UI surface revision. */
const PublicationSchema = Schema.Struct({
  version: Schema.Literal("1.0"),
  createSurface: Schema.Struct({
    surfaceId: SurfaceId,
    catalogId: Schema.Literal(catalogId),
    dataModel: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
    components: Schema.Array(ComponentSchema).check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  }),
}).annotate(exactParseOptions);
export const SurfaceSchema = PublicationSchema.check(
  Schema.makeFilter(
    (value) => {
      try {
        validateDecodedSurface(value);
        return true;
      } catch (error) {
        return error instanceof Error ? error.message.slice(0, 2048) : false;
      }
    },
    { expected: "A complete bounded work surface", toJsonSchema: () => ({}) },
  ),
);
export type WorkSurface = typeof SurfaceSchema.Type;
export type WorkComponent = WorkSurface["createSurface"]["components"][number];

export const surfaceValidation = {
  ...STRICT_VALIDATION,
  targetVersion: "1.0",
  maxDepth: 10,
  allowedMessages: ["createSurface"],
};

const decodeResource = Schema.decodeUnknownSync(ResourceSelectionSchema, {
  onExcessProperty: "error",
});

export function referencedWorkIds(surface: WorkSurface): string[] {
  return surface.createSurface.components.flatMap((component) => {
    const refs = component.issueIds;
    return [
      ...(Array.isArray(refs) ? refs.filter((id): id is string => typeof id === "string") : []),
      ...(typeof component.issueId === "string" ? [component.issueId] : []),
      ...(component.component === "ResourceLink"
        ? [decodeResource(component.target).issue_id]
        : []),
    ];
  });
}
export function surfaceResources(surface: WorkSurface) {
  return surface.createSurface.components.flatMap((component) =>
    component.component === "ResourceLink" ? [decodeResource(component.target)] : [],
  );
}

const validatedSurfaces = new WeakSet<WorkSurface>();

export function validateSurfaceWorkIds(surface: WorkSurface, workIds?: ReadonlySet<string>) {
  const refs = referencedWorkIds(surface);
  if (new Set(refs).size > 100) throw new Error("Select at most 100 distinct work items");
  const missing = workIds && refs.find((id) => !workIds.has(id));
  if (missing) throw new Error(`Work item ${missing} is unavailable. Select an existing issue ID`);
}

type SurfaceProcessor = Pick<MessageProcessor, "processMessagesWithErrors">;
function createSurface(processor: SurfaceProcessor, surface: WorkSurface) {
  const [failure] = processor.processMessagesWithErrors(surface, {
    validationConfig: surfaceValidation,
  });
  if (failure) throw new Error(failure.error.message);
}

function validateDecodedSurface(
  surface: WorkSurface,
  workIds?: ReadonlySet<string>,
  renderer?: SurfaceProcessor,
): WorkSurface {
  if (validatedSurfaces.has(surface)) {
    if (workIds) validateSurfaceWorkIds(surface, workIds);
    if (renderer) createSurface(renderer, surface);
    return surface;
  }
  if (utf8Bytes(JSON.stringify(surface)) > maxSurfaceBytes)
    throw new Error("Surface exceeds the 384 KiB limit");
  const budget = diagramBudget(collectDiagrams(surface.createSurface.components));
  if (budget) throw new Error(budget);
  const components = new Map<string, WorkComponent>();
  for (const c of surface.createSurface.components) {
    if (typeof c.id !== "string") throw new Error("Missing component identity");
    if (typeof c.component !== "string") throw new Error("Missing component type");
    if (c.component === "Table") {
      const { columns, rows } = Schema.decodeUnknownSync(contentProps.Table)(c);
      if (rows.some((row) => row.length !== columns.length))
        throw new Error("Each table row needs one cell per column");
    }
    if (isChartComponent(c.component)) {
      validateChart(chartComponents[c.component].decode(c));
    }
    if (c.component === "Text" && typeof c.text === "string" && c.text.length > 4096)
      throw new Error("Text requires bounded literal text");
    components.set(c.id, c);
  }
  validateSurfaceWorkIds(surface, workIds);
  if (renderer) createSurface(renderer, surface);
  else {
    const processor = new MessageProcessor([validationCatalog]);
    try {
      createSurface(processor, surface);
    } finally {
      processor.dispose();
    }
  }
  // The SDK accepts shared children; each declared work component occupies exactly one place.
  const referenced = new Set<string>();
  for (const component of components.values()) {
    for (const [child] of getComponentReferences(component, validationCatalog)) {
      if (referenced.has(child)) throw new Error("Repeated component reference");
      referenced.add(child);
    }
  }
  // Templates can expand one declared node into many rendered nodes. Count the
  // actual initial tree with the same relative paths as the SDK binder.
  if (surface.createSurface.components.some((c) => c.children && !Array.isArray(c.children))) {
    const data = new DataModel(surface.createSurface.dataModel ?? {});
    let instances = 0;
    function countInstances(id: string, base: string) {
      if (++instances > 100)
        throw new Error("A surface can render at most 100 component instances");
      const component = components.get(id)!;
      const template = component.children;
      if (
        template &&
        typeof template === "object" &&
        !Array.isArray(template) &&
        "componentId" in template &&
        "path" in template &&
        typeof template.componentId === "string" &&
        typeof template.path === "string"
      ) {
        const path = DataModel.resolvePath(template.path, base);
        const rows = data.get(path);
        if (Array.isArray(rows))
          for (let i = 0; i < rows.length; i++)
            countInstances(template.componentId, DataModel.resolvePath(String(i), path));
      } else
        for (const [child] of getComponentReferences(component, validationCatalog))
          countInstances(child, base);
    }
    try {
      countInstances("root", "/");
    } finally {
      data.dispose();
    }
  }
  validatedSurfaces.add(surface);
  return surface;
}

/** Validate the complete replacement before committing or changing a displayed revision. */
export function validateSurface(
  value: unknown,
  workIds?: ReadonlySet<string>,
  renderer?: SurfaceProcessor,
): WorkSurface {
  const surface =
    typeof value === "object" && value !== null && validatedSurfaces.has(value as WorkSurface)
      ? (value as WorkSurface)
      : Schema.decodeUnknownSync(PublicationSchema)(value, { onExcessProperty: "error" });
  return validateDecodedSurface(surface, workIds, renderer);
}
