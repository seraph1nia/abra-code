import { analysisCharts } from "../helpers/chart-fixtures.ts";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { Schema } from "effect";
import { basicCatalog, Catalog, PayloadValidator, STRICT_VALIDATION } from "@a2ui/web_core/v1_0";
import {
  catalogId,
  catalogV1Id,
  catalogV2Id,
  catalogV3Id,
  catalogV4Id,
  legacyCatalogId,
  componentNames,
  workCatalogDocument,
  workComponents,
  validationCatalog,
} from "@abracode/contracts/web/catalog";
import {
  SurfaceSchema,
  normalizeSurface,
  validateSurface,
  surfaceResources,
  referencedWorkIds,
} from "@abracode/contracts/web/surfaces";
import { loadSurfaceRecord, compactSurface } from "../../src/web/surface-records.ts";
import { WorkspaceStateJson, WorkspaceStateSchema } from "@abracode/contracts/web/workspace-wire";
import { webGateway } from "../../src/web/protocol.ts";
import { WorkspaceFixture } from "../helpers/web.ts";

const surface = () => ({
  version: "1.0",
  createSurface: {
    surfaceId: "board",
    catalogId,
    components: [
      { id: "root", component: "Column", children: ["title", "work"] },
      { id: "title", component: "Text", text: "Work" },
      { id: "work", component: "Kanban", issueIds: ["abra-web"], mode: "snapshot" },
    ],
  },
});

test("generated Effect catalog round-trips through the official loader with the full basic catalog", () => {
  const loaded = Catalog.fromJson(workCatalogDocument);
  assert.deepEqual(loaded.toJson(), workCatalogDocument);
  assert.deepEqual([...loaded.components.keys()], componentNames);
  assert.equal(loaded.protocolVersion, "1.0");
  assert.deepEqual(
    Object.keys(workCatalogDocument.functions),
    Object.keys(basicCatalog.toJson().functions as object),
  );
  assert.deepEqual([...validationCatalog.functions.keys()], [...basicCatalog.functions.keys()]);
  for (const name of basicCatalog.components.keys()) assert.ok(loaded.components.has(name));
  assert.match(JSON.stringify(Schema.toJsonSchemaDocument(SurfaceSchema)), /Kanban/);
});

test("Effect custom props and SDK catalog validation enforce the same owned contract", () => {
  const sdk = new PayloadValidator(validationCatalog, STRICT_VALIDATION);
  for (const [props, valid] of [
    [{ issueIds: ["abra-web"], mode: "snapshot" }, true],
    [{}, true],
    [{ issueIds: "abra-web" }, false],
    [{ mode: "executable" }, false],
    [{ issueId: "abra-web" }, false],
  ] as const) {
    const effect = Schema.decodeUnknownResult(workComponents.Kanban.props)(props, {
      onExcessProperty: "error",
    });
    assert.equal(effect._tag === "Success", valid);
    const validate = () => sdk.validateComponent({ id: "root", component: "Kanban", ...props });
    if (valid) assert.doesNotThrow(validate);
    else assert.throws(validate);
  }
  assert.throws(() => sdk.validateComponent({ id: "root", component: "ReportLink" }));
});

test("chart publication enforces bounded literal data and catalog compatibility", () => {
  const chart = {
    id: "root",
    component: "PieChart",
    title: "Tickets",
    data: [{ label: "Open", value: 1 }],
  };
  const publish = (props: object, id: string = catalogId) =>
    validateSurface({
      version: "1.0",
      createSurface: { surfaceId: "chart", catalogId: id, components: [{ ...chart, ...props }] },
    });
  for (const component of ["PieChart", "BarChart", "LineChart"]) {
    publish({ component });
    for (const id of [catalogV1Id, catalogV2Id]) assert.throws(() => publish({ component }, id));
  }
  publish({
    component: "BarChart",
    data: [{ label: "Change", value: -3.5 }],
    orientation: "horizontal",
  });
  for (const invalid of [
    { data: [] },
    { data: Array.from({ length: 101 }, (_, i) => ({ label: String(i), value: i })) },
    { data: [...chart.data, ...chart.data] },
    { data: [{ label: "Open", value: -1 }] },
    { data: [{ label: "Open", value: "1" }] },
    { data: [{ label: "Open", value: 1, url: "https://example.com" }] },
    { orientation: "diagonal" },
    { component: "LineChart", orientation: "horizontal" },
  ])
    assert.throws(() => publish(invalid));
});

test("analytical charts validate coordinates, stacked categories and UTC intervals by catalog version", () => {
  const publish = (component: object, version: string = catalogId) =>
    validateSurface({
      version: "1.0",
      createSurface: {
        surfaceId: "chart",
        catalogId: version,
        components: [{ ...component, id: "root" }],
      },
    });
  for (const chart of Object.values(analysisCharts)) {
    publish(chart);
    assert.throws(() => publish(chart, catalogV3Id));
  }
  const { BarChart, Histogram, ScatterPlot, Heatmap, GanttChart } = analysisCharts;
  publish(
    { component: "BarChart", title: "Balance", data: [{ label: "A", value: -1 }] },
    catalogV3Id,
  );
  publish({ ...Histogram, data: [0, 0] });
  publish({
    ...ScatterPlot,
    data: [
      { x: 1, y: 1 },
      { x: 1, y: 1 },
    ],
  });
  for (const invalid of [
    { ...BarChart, stacked: false },
    { ...BarChart, data: [{ label: "A", value: 1 }] },
    { ...BarChart, data: [BarChart.data[0], BarChart.data[0]] },
    { ...Histogram, data: ["4"] },
    { ...ScatterPlot, data: [{ x: "10", y: 2 }] },
    { ...Heatmap, data: [Heatmap.data[0], Heatmap.data[0]] },
    { ...GanttChart, data: [{ ...GanttChart.data[0], end: GanttChart.data[0].start }] },
    { ...GanttChart, data: [{ ...GanttChart.data[0], end: "2026-02-30T12:00:00Z" }] },
  ])
    assert.throws(() => publish(invalid));
});

test("publication rejects invalid component-specific props", () => {
  for (const component of [
    { id: "root", component: "Text" },
    { id: "root", component: "Text", text: "text", issueIds: ["abra-web"] },
    { id: "root", component: "Column", text: "text" },
    { id: "root", component: "WorkTable", mode: "script" },
  ]) {
    const value = {
      version: "1.0",
      createSurface: { surfaceId: "bad", catalogId, components: [component] },
    };
    assert.throws(() => validateSurface(value));
    assert.equal(Schema.decodeUnknownResult(SurfaceSchema)(value)._tag, "Failure");
  }
});

test("compiled dashboard component IDs have actionable validation and matching JSON Schema guidance", () => {
  const ids = ["projects-heading", "abra-project", "common-project", "tickets-heading"];
  const dashboard = (names: string[]) => ({
    version: "1.0",
    createSurface: {
      surfaceId: "projects-and-tasks-dashboard",
      catalogId,
      components: [
        { id: "root", component: "Column", children: names },
        ...names.map((id) => ({ id, component: "Text", text: "Dashboard text" })),
      ],
    },
  });
  const standard = Schema.toStandardSchemaV1(SurfaceSchema);
  const result = standard["~standard"].validate(dashboard(ids));
  assert.ok("issues" in result && result.issues);
  for (const index of [1, 2, 3, 4])
    assert.ok(
      result.issues.some(
        (issue) =>
          JSON.stringify(issue.path) ===
            JSON.stringify(["createSurface", "components", index, "id"]) &&
          /underscores/.test(issue.message),
      ),
    );
  const fixed = dashboard(ids.map((id) => id.replaceAll("-", "_")));
  assert.doesNotThrow(() => validateSurface(fixed));
  const json = JSON.stringify(Schema.toJsonSchemaDocument(SurfaceSchema));
  assert.match(json, /\^\[a-zA-Z\]\[a-zA-Z0-9_\]/);
});

test("saved legacy surfaces retain their revision and captured work without storage writes", () => {
  const fixture = new WorkspaceFixture();
  const legacy = surface();
  const raw = {
    session_id: fixture.sessionID,
    tool_call_id: "native-tool",
    revision: 7,
    at: fixture.value.at,
    snapshot: fixture.value.work.work,
    surface: { ...legacy, createSurface: { ...legacy.createSurface, catalogId: legacyCatalogId } },
  };
  const before = structuredClone(raw);
  const loaded = loadSurfaceRecord(raw, "web/surface/session/board");
  assert.ok("surface" in loaded);
  assert.equal(loaded.surface.createSurface.catalogId, catalogId);
  assert.equal(loaded.revision, 7);
  assert.deepEqual(loaded.snapshot, raw.snapshot);
  assert.deepEqual(raw, before);
  const reference = compactSurface(loaded);
  assert.equal("surface" in reference, false);
  assert.equal("snapshot" in reference, false);
  const state = Schema.decodeUnknownSync(WorkspaceStateJson)({
    workspace: { ...fixture.value, surfaces: [reference] },
  });
  assert.deepEqual(state.workspace.surfaces, [reference]);
  const broken = loadSurfaceRecord({ ...raw, surface: {} }, "web/surface/session/broken");
  assert.ok("unavailable" in broken);
  assert.equal(broken.surface_id, "broken");
});

test("legacy normalization preserves blank text and ignores previously unused properties", () => {
  const normalized = normalizeSurface({
    version: "1.0",
    createSurface: {
      surfaceId: "old",
      catalogId: legacyCatalogId,
      components: [{ id: "root", component: "Text", issueIds: ["ignored"] }],
    },
  });
  assert.deepEqual(normalized.createSurface.components, [
    { id: "root", component: "Text", text: "" },
  ]);
});

test("workspace state validates nested surfaces across AG-UI JSON serialization", () => {
  const fixture = new WorkspaceFixture();
  const state = {
    workspace: {
      ...fixture.value,
      surfaces: [
        {
          session_id: fixture.sessionID,
          tool_call_id: "native-tool",
          revision: 1,
          at: fixture.value.at,
          surface: validateSurface(surface()),
          snapshot: fixture.value.work.work,
        },
      ],
    },
  };
  const encoded = Schema.encodeSync(WorkspaceStateJson)(state);
  const decoded = Schema.decodeUnknownSync(WorkspaceStateJson)(JSON.parse(JSON.stringify(encoded)));
  assert.deepEqual(decoded, Schema.decodeSync(WorkspaceStateSchema)(state));
  assert.equal(
    Schema.decodeUnknownResult(WorkspaceStateJson)({ workspace: { ...fixture.value, busy: "yes" } })
      ._tag,
    "Failure",
  );
  assert.equal(
    Schema.decodeUnknownResult(WorkspaceStateJson)({
      workspace: { ...fixture.value, surfaces: [{ ...state.workspace.surfaces[0], surface: {} }] },
    })._tag,
    "Failure",
  );
});

test("native RPC outputs validate receipts, projects and checkpoints before clients consume them", async () => {
  for (const [schema, invalid] of [
    [webGateway.methods.submit.output, { message_id: 42 }],
    [webGateway.methods.projects.output, [{ id: "p", name: 42 }]],
    [webGateway.methods.checkpoint.output, { active: "yes" }],
  ] as const) {
    const result = await schema["~standard"].validate(invalid);
    assert.ok(result.issues);
  }
});

test("trusted generated links share the closed resource capabilities and reject executable or unsafe inputs", () => {
  const link = (target: unknown, extra = {}) => ({
    version: "1.0",
    createSurface: {
      surfaceId: "links",
      catalogId,
      components: [
        { id: "root", component: "ResourceLink", label: "Inspect evidence", target, ...extra },
      ],
    },
  });
  const targets = [
    { action: "open_task", issue_id: "abra-web", section: "plan" },
    { action: "open_session", issue_id: "abra-web", session_id: "ses_owned" },
    { action: "open_decision", issue_id: "abra-web", key: "scope", generation: 2 },
    { action: "open_changes", issue_id: "abra-web", file: "src/value.ts" },
    {
      action: "open_artifact",
      issue_id: "abra-web",
      request_id: "report-one",
      hash: "a".repeat(64),
    },
  ];
  for (const target of targets) {
    const parsed = validateSurface(link(target), new Set(["abra-web"]));
    assert.deepEqual(surfaceResources(parsed), [target]);
    assert.deepEqual(referencedWorkIds(parsed), ["abra-web"]);
  }
  for (const target of [
    { action: "approve", issue_id: "abra-web" },
    { action: "open_task", issue_id: "abra-web", callback: "execute" },
    { action: "open_changes", issue_id: "abra-web", file: "../secret" },
    { action: "open_task", issue_id: "abra-web", section: "plan", activity: "sessions" },
  ])
    assert.throws(() => validateSurface(link(target)));
  assert.throws(() => validateSurface(link(targets[0], { onClick: "run_tool" })));
  assert.throws(() => validateSurface(link(targets[0], { url: "javascript:alert(1)" })));
  assert.throws(() => validateSurface(link(targets[0]), new Set(["abra-other"])));
});

test("v5 content components and expanded templates preserve the bounded layout contract", () => {
  const publish = (components: object[], id: string = catalogId, dataModel?: object) =>
    validateSurface({
      version: "1.0",
      createSurface: {
        surfaceId: "content",
        catalogId: id,
        components,
        ...(dataModel && { dataModel }),
      },
    });
  const table = {
    id: "body",
    component: "Table",
    caption: "Comparison",
    columns: ["Name"],
    rows: [["Local"]],
  };
  const disclosure = { id: "root", component: "Disclosure", label: "Details", child: "body" };
  publish([disclosure, table]);
  assert.throws(
    () => publish([disclosure, { ...table, rows: [["a", "b"]] }]),
    /one cell per column/,
  );
  assert.throws(() => publish([disclosure]));
  for (const id of [catalogV1Id, catalogV2Id, catalogV3Id, catalogV4Id]) {
    assert.throws(() => publish([disclosure, table], id));
    assert.throws(() => publish([{ id: "root", component: "Card", child: "body" }, table], id));
    assert.throws(() =>
      publish([{ id: "root", component: "Text", text: { "@path": "/name" } }], id),
    );
  }
  const template = [
    { id: "root", component: "List", children: { componentId: "item", path: "/rows" } },
    { id: "item", component: "Text", text: { "@path": "label" } },
  ];
  publish(template, catalogId, { rows: [{ label: "A" }] });
  assert.throws(
    () => publish(template, catalogId, { rows: Array(100).fill("row") }),
    /100 component instances/,
  );
  publish([
    {
      id: "root",
      component: "TextField",
      label: "Name",
      "@checks": [
        {
          condition: { "@call": "required", args: { value: { "@path": "/name" } } },
          message: "Enter a name",
        },
      ],
    },
  ]);
});
