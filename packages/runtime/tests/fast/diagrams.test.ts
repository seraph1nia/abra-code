import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { Schema } from "effect";
import {
  DiagramCollectionSchema,
  DiagramSourceSchema,
  collectDiagrams,
  diagramBudget,
  diagramSourcePolicy,
} from "@abracode/contracts/presentation/diagrams";
import { catalogId, catalogV1Id } from "@abracode/contracts/web/catalog";
import { validateSurface } from "@abracode/contracts/web/surfaces";
import {
  validateReportDocument,
  readReportDocument,
} from "@abracode/contracts/presentation/report-document";
import { reportDocument } from "../helpers/report-document.ts";

const source = "flowchart LR\nA <--> B";
function board(count: number) {
  return {
    version: "1.0",
    createSurface: {
      surfaceId: "diagrams",
      catalogId,
      components: [
        {
          id: "root",
          component: "Column",
          children: Array.from({ length: count }, (_, i) => `d${i}`),
        },
        ...Array.from({ length: count }, (_, i) => ({
          id: `d${i}`,
          component: "Mermaid",
          title: `Diagram ${i}`,
          source,
        })),
      ],
    },
  };
}
test("diagram catalog accepts 32 literal placements and refuses unsafe or excessive revisions", () => {
  const view = validateSurface(board(32));
  assert.equal(collectDiagrams(view.createSurface.components).length, 32);
  assert.throws(() => validateSurface(board(33)));
  assert.throws(() =>
    validateSurface({
      ...board(1),
      createSurface: { ...board(1).createSurface, catalogId: catalogV1Id },
    }),
  );
  for (const extra of [
    { svg: "<svg/>" },
    { config: {} },
    { onClick: "run" },
    { source: { path: "/tmp/value" } },
  ]) {
    const input = board(1);
    Object.assign(input.createSurface.components[1]!, extra);
    assert.throws(() => validateSurface(input));
  }
});
test("diagram limits count UTF-8 bytes and combined source across placements", () => {
  const decode = Schema.decodeUnknownSync(DiagramSourceSchema);
  assert.equal(decode("é".repeat(16384)).length, 16384);
  assert.throws(() => decode("é".repeat(16385)));
  const collection = Schema.decodeUnknownSync(DiagramCollectionSchema);
  collection(Array.from({ length: 8 }, () => ({ title: "Bound", source: "x".repeat(32768) })));
  assert.throws(() =>
    collection(Array.from({ length: 9 }, () => ({ title: "Over", source: "x".repeat(32768) }))),
  );
  assert.match(
    diagramBudget(Array.from({ length: 33 }, (_, i) => ({ id: `d${i}`, source })))!,
    /32/,
  );
  const view = validateSurface(board(32));
  assert.doesNotThrow(() =>
    validateReportDocument({ ...reportDocument(), surface: view, data: { work: [] } }),
  );
  const base = board(32);
  const combined = {
    ...base,
    createSurface: {
      ...base.createSurface,
      components: [
        {
          id: "root",
          component: "Column",
          children: [...Array.from({ length: 32 }, (_, i) => `d${i}`), "evidence"],
        },
        ...base.createSurface.components.slice(1),
        { id: "evidence", component: "ReportEvidence", section: "diagrams" },
      ],
    },
  };
  assert.throws(() => validateReportDocument({ ...reportDocument(), surface: combined }));
});
test("diagram policy allows ordinary punctuation and labels while rejecting active syntax", () => {
  for (const text of [
    source,
    "sequenceDiagram\nA->>B: click to continue",
    'flowchart LR\nA["href click https://example.invalid"] --> B',
  ])
    assert.equal(diagramSourcePolicy(text), undefined);
  for (const text of [
    "%%{init: {}}%%\n" + source,
    "---\nconfig: {}\n---\n" + source,
    'flowchart LR\nclick A href "https://example.invalid"',
    "flowchart LR\nA[<img src=x>]",
  ])
    assert.ok(diagramSourcePolicy(text));
});
test("historical documents retain their original compatibility and eight-diagram contract", () => {
  const current = reportDocument();
  const legacy = {
    ...current,
    catalog_id: catalogV1Id,
    catalog_version: 1,
    renderer_compatibility: "abracode-react/v1",
    surface: {
      ...current.surface,
      createSurface: { ...current.surface.createSurface, catalogId: catalogV1Id },
    },
  };
  const json = JSON.stringify(legacy);
  const result = readReportDocument(json);
  assert.ok(result.supported);
  assert.equal(JSON.stringify(result.document), json);
  const oldConfiguredSource = {
    ...legacy,
    data: {
      ...legacy.data,
      evidence: {
        ...legacy.data.evidence,
        diagrams: [
          {
            title: "Historical source",
            source: "\n---\ntitle: Historical\n---\nflowchart LR\nA --> B",
          },
        ],
      },
    },
  };
  const oldJSON = JSON.stringify(oldConfiguredSource);
  const oldRead = readReportDocument(oldJSON);
  assert.ok(oldRead.supported);
  assert.equal(JSON.stringify(oldRead.document), oldJSON);
  assert.throws(() =>
    validateReportDocument({
      ...legacy,
      data: {
        ...legacy.data,
        evidence: {
          ...legacy.data.evidence,
          diagrams: Array.from({ length: 9 }, () => ({
            title: "Old",
            source: "flowchart LR\nA --> B",
          })),
        },
      },
    }),
  );
});
