import { contentDefinitions, contentNames } from "./content-components.ts";
export { contentNames, contentProps, type ContentName } from "./content-components.ts";
import { chartComponents, isChartComponent, v3BarChart } from "./charts.ts";
export {
  chartComponents,
  isChartComponent,
  type ChartInput,
  type ChartComponentName,
} from "./charts.ts";
import { DiagramSchema } from "../presentation/diagrams.ts";
import { Schema } from "effect";
import { IssueId } from "../identities.ts";
import { ResourceSelectionSchema } from "./resources.ts";
import {
  A2uiExpressionError,
  basicCatalog,
  Catalog,
  type ComponentApi,
  type DataContext,
  PayloadValidator,
  STRICT_VALIDATION,
} from "@a2ui/web_core/v1_0";

export const catalogV1Id = "https://abracode.local/catalog/work/v1/catalog.json";
export const catalogV2Id = "https://abracode.local/catalog/work/v2/catalog.json";
export const catalogV3Id = "https://abracode.local/catalog/work/v3/catalog.json";
export const catalogV4Id = "https://abracode.local/catalog/work/v4/catalog.json";
export const catalogId = "https://abracode.local/catalog/work/v5/catalog.json";
export const catalogIds = [catalogV1Id, catalogV2Id, catalogV3Id, catalogV4Id, catalogId] as const;
export const legacyCatalogId = "https://abracode.local/catalog/v1";
export const basicComponentNames = [...basicCatalog.components.keys()];
const historicalBasicNames = ["Column", "Row", "Text"] as const;
export { ComponentId } from "./surface-destination.ts";
const issueIds = Schema.Array(IssueId).check(Schema.isMaxLength(100));
const workFields = {
  issueIds: Schema.optionalKey(issueIds),
  mode: Schema.optionalKey(Schema.Literals(["live", "snapshot"])),
};
const workProps = Schema.Struct(workFields);
function component<const N extends string, S extends Schema.Struct<Schema.Struct.Fields>>(
  name: N,
  props: S,
  description: string,
) {
  return { name, props, description };
}

/** Owned props are defined once; the SDK's Zod models are derived from the exported JSON. */
export const workComponents = {
  ...chartComponents,
  Mermaid: component(
    "Mermaid",
    DiagramSchema,
    "A titled literal Mermaid diagram, optionally with description. Up to 32 instances, 32 KiB each and 256 KiB total source. Use abra_mermaid_verify before publishing diagrams; no configuration, HTML, callbacks, links or images.",
  ),
  WorkTable: component("WorkTable", workProps, "Work items in a selectable table."),
  StatusSummary: component("StatusSummary", workProps, "Work item counts grouped by status."),
  Kanban: component("Kanban", workProps, "Work items grouped into status columns."),
  DependencyGraph: component(
    "DependencyGraph",
    workProps,
    "Declared directed dependency references with separately labeled observed blockers; unavailable references stay unavailable.",
  ),
  Timeline: component(
    "Timeline",
    workProps,
    "Captured timestamped progress, decision, wait and closure observations in chronological order; not a complete activity log.",
  ),
  DecisionSummary: component(
    "DecisionSummary",
    workProps,
    "Retained decisions; opens the inspector.",
  ),
  ReportLink: component(
    "ReportLink",
    Schema.Struct({ issueId: IssueId }),
    "Opens the retained reports for an existing work item.",
  ),
  ResourceLink: component(
    "ResourceLink",
    Schema.Struct({
      label: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(256)),
      target: ResourceSelectionSchema,
    }),
    "Read-only navigation to a retained task, session, exact decision, changes or exact artifact. Ownership is checked before publication and again when opened.",
  ),
  ReportEvidence: component(
    "ReportEvidence",
    Schema.Struct({
      section: Schema.Literals([
        "summary",
        "findings",
        "checks",
        "events",
        "excerpts",
        "limitations",
        "diagrams",
      ]),
    }),
    "Frozen captured report evidence by section. Without captured report data it explicitly reports unavailable; literal generated prose cannot supply check results.",
  ),
} as const;
export type WorkComponentName = keyof typeof workComponents;
export const workComponentNames = Object.values(workComponents).map((c) => c.name);
const historicalNames = [...historicalBasicNames, ...workComponentNames];
export const componentNames = [...basicComponentNames, ...contentNames, ...workComponentNames];
export type WorkProps<N extends WorkComponentName> = (typeof workComponents)[N]["props"]["Type"];

const basic = basicCatalog
  .derive({
    catalogId,
    components: historicalBasicNames,
    functions: [],
  })
  .toJson();
const object = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Json));
const basicDefinitions = object(basic.components);
const definitions = object(basic.$defs);
function customDocument({
  name,
  props,
  description,
}: (typeof workComponents)[WorkComponentName] | typeof v3BarChart) {
  const document = Schema.toJsonSchemaDocument(
    Schema.Struct({ component: Schema.Literal(name), ...props.fields }),
    { onExcessProperty: "error" },
  );
  return { name, schema: { ...document.schema, description }, definitions: document.definitions };
}
const customDocuments = Object.values(workComponents).map(customDocument);
const customDefinitions = Object.fromEntries(customDocuments.map((doc) => [doc.name, doc.schema]));
const sharedDefinitions = {
  ...definitions,
  ...Object.assign({}, ...customDocuments.map((doc) => doc.definitions)),
};

/** Deterministic generated artifact shared by the native tool, server and browser. */
const previousDocument = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: catalogV4Id,
  catalogId: catalogV4Id,
  protocolVersion: "1.0",
  title: "AbraCode work views",
  instructions:
    "Read-only work views. Use root as the root component ID. Work widgets default to live data; " +
    "mode snapshot uses retained work. Omit issueIds to select all work. ReportLink requires issueId. " +
    "ResourceLink requires a label and a typed target. No HTML, URLs, arbitrary functions/actions, permission or approval components.",
  components: {
    ...Object.fromEntries(
      Object.entries(basicDefinitions).map(([name, definition]) => [
        name,
        { ...object(definition), additionalProperties: false },
      ]),
    ),
    ...customDefinitions,
  },
  $defs: {
    ...sharedDefinitions,
    anyComponent: {
      oneOf: historicalNames.map((name) => ({ $ref: `#/components/${name}` })),
      discriminator: { propertyName: "component" },
    },
    anyFunction: { not: {} },
  },
};
function historicalCatalog(id: Exclude<(typeof catalogIds)[number], typeof catalogId>) {
  const names = historicalNames.filter((name) =>
    isChartComponent(name)
      ? id === catalogV3Id && ["LineChart", "BarChart", "PieChart"].includes(name)
      : id !== catalogV1Id || name !== "Mermaid",
  );
  return {
    ...previousDocument,
    $id: id,
    catalogId: id,
    components: Object.fromEntries(
      names.map((name) => [
        name,
        name === "BarChart" ? customDocument(v3BarChart).schema : previousDocument.components[name],
      ]),
    ),
    $defs: {
      ...previousDocument.$defs,
      anyComponent: {
        ...previousDocument.$defs.anyComponent,
        oneOf: names.map((name) => ({ $ref: `#/components/${name}` })),
      },
    },
  };
}
const upstream = basicCatalog.toJson();
export const workCatalogDocument = {
  ...previousDocument,
  $id: catalogId,
  catalogId,
  instructions:
    "Use root as the root component ID. Basic controls bind to the surface data model. " +
    "Button events prepare a message for the user. openUrl requires a user gesture and an HTTP(S) destination. " +
    "Use embedded media for offline reports. Work widgets default to live data; mode snapshot uses retained work. " +
    "Omit issueIds to select all work. Use ResourceLink for owned workspace navigation.",
  components: {
    ...Object.fromEntries(
      Object.entries(object(upstream.components)).map(([name, schema]) => {
        const definition = object(schema);
        return [
          name,
          {
            ...definition,
            ...(definition.allOf
              ? { unevaluatedProperties: false }
              : { additionalProperties: false }),
          },
        ];
      }),
    ),
    ...contentDefinitions,
    ...customDefinitions,
  },
  functions: object(upstream.functions),
  $defs: {
    ...sharedDefinitions,
    anyFunction: object(upstream.$defs).anyFunction,
    anyComponent: {
      ...previousDocument.$defs.anyComponent,
      oneOf: componentNames.map((name) => ({ $ref: `#/components/${name}` })),
    },
  },
};
export const workCatalogs = {
  [catalogV1Id]: historicalCatalog(catalogV1Id),
  [catalogV2Id]: historicalCatalog(catalogV2Id),
  [catalogV3Id]: historicalCatalog(catalogV3Id),
  [catalogV4Id]: previousDocument,
  [catalogId]: workCatalogDocument,
};
export const catalog = Catalog.fromJson(workCatalogDocument);

// The pinned SDK also opens mailto and tel. The v1 guide requires HTTP(S).
const basicFunctions = [...basicCatalog.functions.values()].map((fn) =>
  fn.name === "openUrl"
    ? {
        ...fn,
        execute(args: Record<string, unknown>, context: DataContext) {
          if (typeof window === "undefined" || typeof args.url !== "string")
            throw new A2uiExpressionError("openUrl requires a browser URL", "openUrl");
          if (!context.isUserActivated || window.navigator.userActivation?.isActive === false)
            throw new A2uiExpressionError("openUrl requires a user gesture", "openUrl");
          const url = new URL(args.url, window.location.href);
          if (url.protocol !== "https:" && url.protocol !== "http:")
            throw new A2uiExpressionError("openUrl requires HTTP or HTTPS", "openUrl");
          window.open(url.href, "_blank", "noopener,noreferrer");
        },
      }
    : fn,
);

export function implementedCatalog<T extends ComponentApi>(entries: readonly T[]) {
  return new Catalog(catalogId, "1.0", entries, basicFunctions, {
    schemaUri: workCatalogDocument.$schema,
    schemaId: catalogId,
    title: workCatalogDocument.title,
    instructions: workCatalogDocument.instructions,
    defs: sharedDefinitions,
  });
}
export const validationCatalog = implementedCatalog([...catalog.components.values()]);
const validator = new PayloadValidator(validationCatalog, STRICT_VALIDATION);
const componentIdentifier = Schema.String.check(Schema.isPattern(/^[a-zA-Z][a-zA-Z0-9_]{0,100}$/u));
const componentIdentifierHelp =
  "Component IDs must start with a letter and contain only letters, digits or underscores (up to 101 characters); use projects_heading, not projects-heading.";

// web_core 0.15 uses bare envelope names. Keep canonical v1 names on the wire.
export function sdkComponent(value: Record<string, Schema.Json>) {
  let component = value;
  for (const name of ["checks", "accessibility", "metadata", "catalogId"]) {
    const canonical = `@${name}`;
    if (!Object.hasOwn(value, canonical)) continue;
    if (Object.hasOwn(value, name))
      throw new Error(`Conflicting component keys: ${name} and ${canonical}`);
    if (component === value) component = { ...value };
    component[name] = value[canonical]!;
    delete component[canonical];
  }
  return component;
}

/** SDK validation remains authoritative for the upstream component definitions. */
export const ComponentSchema = Schema.Record(Schema.String, Schema.Json).check(
  Schema.makeFilter(
    (value) => {
      if (!Schema.is(componentIdentifier)(value.id))
        return { path: ["id"], issue: componentIdentifierHelp };
      try {
        validator.validateComponent(sdkComponent(value));
        return true;
      } catch (error) {
        return error instanceof Error ? error.message.slice(0, 2048) : false;
      }
    },
    {
      expected: "A component from the AbraCode work catalog",
      toJsonSchema: () => ({
        ...validationCatalog.validationSchema,
        $defs: {
          ...object(validationCatalog.validationSchema.$defs),
          ComponentId: Schema.toJsonSchemaDocument(componentIdentifier).schema,
        },
        $id: `${catalogId}/component`,
        $ref: "#/$defs/anyComponent",
      }),
    },
  ),
);
