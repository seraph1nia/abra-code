import { validateChart, chartComponents } from "./charts.ts";
import { collectDiagrams, diagramBudget } from "../presentation/diagrams.ts";
import { Schema } from "effect";
import { ResourceSelectionSchema } from "./resources.ts";
import {
  CreateSurfaceMessageSchema,
  Catalog,
  PayloadValidator,
  DataModel,
  getComponentReferences,
  MessageProcessor,
  STRICT_VALIDATION,
} from "@a2ui/web_core/v1_0";
import {
  catalogId,
  catalogV1Id,
  catalogIds,
  workCatalogs,
  contentProps,
  sdkComponent,
  isChartComponent,
  ComponentId,
  ComponentSchema,
  legacyCatalogId,
  validationCatalog,
  workComponents,
} from "./catalog.ts";
export { catalogId, componentNames } from "./catalog.ts";

export const maxSurfaceBytes = 384 * 1024;

/** The owned publication interface is a bounded, complete A2UI surface revision. */
const PublicationSchema = Schema.Struct({
  version: Schema.Literal("1.0"),
  createSurface: Schema.Struct({
    surfaceId: ComponentId,
    catalogId: Schema.Literals(catalogIds),
    dataModel: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
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
export const toSdkSurface = (surface: WorkSurface) =>
  CreateSurfaceMessageSchema.parse({
    ...surface,
    createSurface: {
      ...surface.createSurface,
      catalogId,
      ...(surface.createSurface.dataModel && {
        dataModel: structuredClone(surface.createSurface.dataModel),
      }),
      components: surface.createSurface.components.map(sdkComponent),
    },
  });

export const surfaceValidation = {
  ...STRICT_VALIDATION,
  targetVersion: "1.0",
  maxDepth: 10,
  allowedMessages: ["createSurface"],
};

const historicalValidators = new Map<string, PayloadValidator>();
function historicalValidator(version: Exclude<(typeof catalogIds)[number], typeof catalogId>) {
  let validator = historicalValidators.get(version);
  if (!validator) {
    validator = new PayloadValidator(Catalog.fromJson(workCatalogs[version]), STRICT_VALIDATION);
    historicalValidators.set(version, validator);
  }
  return validator;
}

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
  CreateSurfaceMessageSchema.parse(value);
  const surface = Schema.decodeUnknownSync(PublicationSchema)(value, { onExcessProperty: "error" });
  const old = surface.createSurface.catalogId === catalogV1Id;
  if (new TextEncoder().encode(JSON.stringify(value)).length > (old ? 65536 : maxSurfaceBytes))
    throw new Error(old ? "Surface exceeds the 64 KiB limit" : "Surface exceeds the 384 KiB limit");
  if (old && surface.createSurface.components.some((c) => c.component === "Mermaid"))
    throw new Error("Mermaid requires the v2 catalog");
  const budget = diagramBudget(collectDiagrams(surface.createSurface.components));
  if (budget) throw new Error(budget);
  const version = surface.createSurface.catalogId;
  if (version !== catalogId && surface.createSurface.dataModel !== undefined)
    throw new Error("Surface data requires the v5 catalog");
  const components = new Map<string, WorkComponent>();
  for (const c of surface.createSurface.components) {
    const id = Schema.decodeUnknownSync(ComponentId)(c.id);
    if (components.has(id)) throw new Error("Repeated component identity");
    if (typeof c.component !== "string") throw new Error("Missing component type");
    if (!Object.hasOwn(workCatalogs[version].components, c.component))
      throw new Error(`${c.component} is unavailable in this catalog version`);
    if (version !== catalogId) historicalValidator(version).validateComponent(c);
    if (c.component === "Table") {
      const { columns, rows } = Schema.decodeUnknownSync(contentProps.Table)(c);
      if (rows.some((row) => row.length !== columns.length))
        throw new Error("Each table row needs one cell per column");
    }
    if (isChartComponent(c.component)) {
      validateChart(chartComponents[c.component].decode(c));
    }
    if (c.component === "ResourceLink")
      Schema.decodeUnknownSync(ResourceSelectionSchema)(c.target, { onExcessProperty: "error" });
    if (
      c.component === "Text" &&
      (typeof c.text === "string" ? c.text.length > 4096 : version !== catalogId)
    )
      throw new Error("Text requires bounded literal text");
    if (
      version !== catalogId &&
      (c.component === "Column" || c.component === "Row") &&
      (!Array.isArray(c.children) ||
        c.children.length > 100 ||
        c.children.some((id) => typeof id !== "string"))
    )
      throw new Error("Layout requires bounded child IDs");
    components.set(id, c);
  }
  const refs = referencedWorkIds(surface);
  if (new Set(refs).size > 100) throw new Error("Select at most 100 distinct work items");
  const missing = workIds && refs.find((id) => !workIds.has(id));
  if (missing) throw new Error(`Work item ${missing} is unavailable. Select an existing issue ID`);
  const seen = new Set<string>();
  function visit(id: string, depth: number) {
    const c = components.get(id);
    if (!c || seen.has(id) || depth > 10) throw new Error("Missing, repeated or cyclic component");
    seen.add(id);
    for (const [child] of getComponentReferences(c, validationCatalog)) visit(child, depth + 1);
  }
  visit("root", 0);
  if (seen.size !== components.size) throw new Error("Unreachable component");
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
  if (new TextEncoder().encode(JSON.stringify(value)).length > 65536)
    throw new Error("Legacy surface exceeds 64 KiB");
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
