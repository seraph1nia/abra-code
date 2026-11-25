import { contentDefinitions, contentNames } from "./content-components.ts";
export { contentNames, contentProps, type ContentName } from "./content-components.ts";
import { chartComponents } from "./charts.ts";
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

export const catalogId = "https://abracode.local/catalog/work/v1/catalog.json";
export const basicComponentNames = [...basicCatalog.components.keys()];
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
export const componentNames = [...basicComponentNames, ...contentNames, ...workComponentNames];
export type WorkProps<N extends WorkComponentName> = (typeof workComponents)[N]["props"]["Type"];

const upstream = basicCatalog.toJson();
const object = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Json));
const definitions = object(upstream.$defs);
function customDocument({ name, props, description }: (typeof workComponents)[WorkComponentName]) {
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

export const workCatalogDocument = {
  ...upstream,
  protocolVersion: "1.0",
  title: "AbraCode work views",
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
    ...Object.fromEntries(
      Object.entries({ ...contentDefinitions, ...customDefinitions }).map(([name, definition]) => [
        name,
        {
          ...definition,
          properties: {
            ...object(object(definition).properties),
            weight: { $ref: "#/$defs/Weight" },
            accessibility: { $ref: "common_types.json#/$defs/AccessibilityAttributes" },
          },
        },
      ]),
    ),
  },
  functions: object(upstream.functions),
  $defs: {
    ...sharedDefinitions,
    anyFunction: object(upstream.$defs).anyFunction,
    anyComponent: {
      discriminator: { propertyName: "component" },
      oneOf: componentNames.map((name) => ({ $ref: `#/components/${name}` })),
    },
  },
};
const workCatalogSchema = Catalog.fromJson(workCatalogDocument);

export function catalogHttpUrl(value: string) {
  if (!/^https?:\/\/[^/\\?#\s]/i.test(value) || /[\\\t\r\n]/.test(value)) return;
  const url = URL.parse(value);
  if (url && !url.username && !url.password) return url;
}

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
          const url = catalogHttpUrl(args.url);
          if (!url) throw new A2uiExpressionError("openUrl requires HTTP or HTTPS", "openUrl");
          window.open(url.href, "_blank", "noopener,noreferrer");
        },
      }
    : fn,
);

export function implementedCatalog<T extends ComponentApi>(entries: readonly T[]) {
  const derived = basicCatalog.derive({
    catalogId,
    functions: basicFunctions,
    instructions: workCatalogDocument.instructions,
  });
  // Retain the host rendering type and the custom JSON-schema definitions referenced by its widgets.
  return new Catalog(catalogId, derived.protocolVersion, entries, [...derived.functions.values()], {
    themeSchema: derived.themeSchema,
    defs: sharedDefinitions,
    instructions: derived.instructions,
    title: workCatalogDocument.title,
    schemaId: catalogId,
  });
}
export const catalog = implementedCatalog([...workCatalogSchema.components.values()]);
export const validationCatalog = catalog;
const validator = new PayloadValidator(validationCatalog, STRICT_VALIDATION);
const componentIdentifier = Schema.String.check(Schema.isPattern(/^[a-zA-Z][a-zA-Z0-9_]{0,100}$/u));
const componentIdentifierHelp =
  "Component IDs must start with a letter and contain only letters, digits or underscores (up to 101 characters); use projects_heading, not projects-heading.";

/** SDK validation remains authoritative for the upstream component definitions. */
export const ComponentSchema = Schema.Record(Schema.String, Schema.Json).check(
  Schema.makeFilter(
    (value) => {
      if (!Schema.is(componentIdentifier)(value.id))
        return { path: ["id"], issue: componentIdentifierHelp };
      try {
        validator.validateComponent(value);
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
