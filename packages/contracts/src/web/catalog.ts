import { DiagramSchema } from "../presentation/diagrams.ts";
import { Schema } from "effect";
import { IssueId } from "../identities.ts";
import { ResourceSelectionSchema } from "./resources.ts";
import {
  basicCatalog,
  Catalog,
  type ComponentApi,
  PayloadValidator,
  STRICT_VALIDATION,
} from "@a2ui/web_core/v1_0";

export const previousCatalogId = "https://abracode.local/catalog/work/v1/catalog.json";
export const catalogId = "https://abracode.local/catalog/work/v2/catalog.json";
export const legacyCatalogId = "https://abracode.local/catalog/v1";
export const basicComponentNames = ["Column", "Row", "Text"] as const;
export const ComponentId = Schema.String.check(
  Schema.isPattern(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/),
);
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
export const componentNames = [...basicComponentNames, ...workComponentNames];
export type WorkProps<N extends WorkComponentName> = (typeof workComponents)[N]["props"]["Type"];

const basic = basicCatalog
  .derive({
    catalogId,
    components: basicComponentNames,
    functions: [],
  })
  .toJson();
const object = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Json));
const basicDefinitions = object(basic.components);
const definitions = object(basic.$defs);
const customDocuments = Object.values(workComponents).map(({ name, props, description }) => {
  const document = Schema.toJsonSchemaDocument(
    Schema.Struct({ component: Schema.Literal(name), ...props.fields }),
    { onExcessProperty: "error" },
  );
  return { name, schema: { ...document.schema, description }, definitions: document.definitions };
});
const customDefinitions = Object.fromEntries(customDocuments.map((doc) => [doc.name, doc.schema]));
const sharedDefinitions = {
  ...definitions,
  ...Object.assign({}, ...customDocuments.map((doc) => doc.definitions)),
};

/** Deterministic generated artifact shared by the native tool, server and browser. */
export const workCatalogDocument = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: catalogId,
  catalogId,
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
      oneOf: componentNames.map((name) => ({ $ref: `#/components/${name}` })),
      discriminator: { propertyName: "component" },
    },
    anyFunction: { not: {} },
  },
};
/** Retained v1 discovery document excludes the new component. */
export const previousCatalogDocument = {
  ...workCatalogDocument,
  $id: previousCatalogId,
  catalogId: previousCatalogId,
  components: Object.fromEntries(
    Object.entries(workCatalogDocument.components).filter(([name]) => name !== "Mermaid"),
  ),
  $defs: {
    ...workCatalogDocument.$defs,
    anyComponent: {
      ...workCatalogDocument.$defs.anyComponent,
      oneOf: componentNames
        .filter((name) => name !== "Mermaid")
        .map((name) => ({ $ref: `#/components/${name}` })),
    },
  },
};
export const catalog = Catalog.fromJson(workCatalogDocument);

/** Attach implementations without changing the shared catalog or adding functions. */
export function implementedCatalog<T extends ComponentApi>(entries: readonly T[]) {
  return new Catalog(catalogId, "1.0", entries, [], {
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

export const renderInstructions =
  `Render a complete A2UI 1.0 createSurface revision using catalogId ${catalogId}. ` +
  workCatalogDocument.instructions +
  ` ${componentIdentifierHelp} Surface IDs may contain hyphens. ` +
  " Column/Row require children (component IDs); Text requires text. " +
  Object.values(workComponents)
    .map(({ name, description }) => `${name}: ${description}`)
    .join(" ");
