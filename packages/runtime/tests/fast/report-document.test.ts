import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { Schema } from "effect";
import { reportDocument, coveredReportDocument } from "../helpers/report-document.ts";
import {
  readReportDocument,
  validateReportDocument,
} from "@abracode/contracts/presentation/report-document";
import { ReportArtifactReceiptSchema } from "../../src/reporting/report-contracts.ts";

test("canonical JSON retains exact layout, captured values, source revision and pending evidence", () => {
  const document = reportDocument();
  const json = JSON.stringify(document);
  assert.deepEqual(readReportDocument(json), { supported: true, document });
  assert.equal(document.data.evidence?.checks[1].status, "pending");
  assert.equal(document.provenance.source_surface?.revision, 4);
  assert.equal(document.surface.createSurface.components[1].mode, "live");
  assert.equal(document.data.work[0].title, "Frozen task title");
  assert.equal(document.data.snapshot_work?.[0].title, "Older snapshot task title");
});

test("retired catalog and renderer identities are unsupported", () => {
  const current = reportDocument();
  for (const version of [2, 3, 4, 5]) {
    const id = `https://abracode.local/catalog/work/v${version}/catalog.json`;
    const document = {
      ...current,
      catalog_id: id,
      catalog_version: version,
      renderer_compatibility: `abracode-react/v${version}`,
      surface: {
        ...current.surface,
        createSurface: { ...current.surface.createSurface, catalogId: id },
      },
    };
    assert.equal(readReportDocument(JSON.stringify(document)).supported, false);
  }
});

test("document validation bounds UTF-8 bytes and refuses uncaptured resources or mismatched provenance", () => {
  const document = reportDocument();
  assert.throws(() =>
    validateReportDocument({
      ...document,
      provenance: { ...document.provenance, issue_id: "another-task" },
    }),
  );
  assert.throws(() =>
    validateReportDocument({
      ...document,
      data: { ...document.data, work: [], snapshot_work: [] },
    }),
  );
  assert.throws(() =>
    validateReportDocument({
      ...document,
      data: { work: Array.from({ length: 101 }, () => document.data.work[0]) },
    }),
  );
  assert.throws(() =>
    validateReportDocument({
      ...document,
      surface: {
        ...document.surface,
        createSurface: {
          ...document.surface.createSurface,
          components: [{ id: "root", component: "Text", text: "é".repeat(32769) }],
        },
      },
    }),
  );
  assert.throws(() =>
    validateReportDocument({
      ...document,
      data: { work: [{ ...document.data.work[0], title: "é".repeat(270000) }] },
    }),
  );
  assert.throws(() =>
    validateReportDocument({
      ...document,
      limitations: Array.from({ length: 64 }, () => "é".repeat(16384)),
    }),
  );
  const json = JSON.stringify(document);
  const atLimit = json + " ".repeat(1024 * 1024 - Buffer.byteLength(json));
  assert.deepEqual(readReportDocument(atLimit), { supported: true, document });
  assert.throws(() => readReportDocument(atLimit + " "));
  assert.throws(() => readReportDocument(" ".repeat(1024 * 1024 + 1)));
});

test("unknown format/catalog/renderer versions remain unmodified and individually unsupported", () => {
  const document = reportDocument();
  for (const update of [
    { format_version: 2 },
    { catalog_version: 99 },
    { catalog_id: "https://future.invalid/catalog" },
    { renderer_compatibility: "future-renderer" },
  ]) {
    const json = JSON.stringify({ ...document, ...update });
    const original = json;
    assert.equal(readReportDocument(json).supported, false);
    assert.equal(json, original);
  }
  assert.throws(() => readReportDocument("{malformed"));
});

test("report receipts require immutable JSON identity", () => {
  const document = reportDocument();
  const receipt = {
    schema_version: 1,
    request_id: document.document_id,
    issue_id: document.provenance.issue_id,
    execution_id: document.provenance.execution_id,
    generation: 2,
    input_hash: "a".repeat(64),
    template_hash: "b".repeat(64),
    hash: "c".repeat(64),
    bytes: 42,
    path: "/fixture/index.html",
    observed_at: document.captured_at,
  };
  assert.throws(() => Schema.decodeUnknownSync(ReportArtifactReceiptSchema)(receipt));
  const json = {
    ...receipt,
    schema_version: 2,
    format: "a2ui-snapshot",
    document_id: document.document_id,
    revision: 1,
    catalog_id: document.catalog_id,
    catalog_version: document.catalog_version,
    renderer_compatibility: document.renderer_compatibility,
    path: "/fixture/index.json",
  };
  assert.deepEqual(Schema.decodeUnknownSync(ReportArtifactReceiptSchema)(json), json);
  const future = { ...json, catalog_version: 99, renderer_compatibility: "future-renderer" };
  assert.deepEqual(Schema.decodeUnknownSync(ReportArtifactReceiptSchema)(future), future);
});

test("additive binding coverage round-trips while old documents keep original bytes and unknown coverage", () => {
  const original = JSON.stringify(reportDocument());
  const legacy = readReportDocument(original);
  assert.equal(legacy.supported, true);
  if (legacy.supported) {
    assert.equal(legacy.document.data.live_coverage, undefined);
    assert.equal(JSON.stringify(legacy.document), original);
  }
  const current = coveredReportDocument();
  const result = readReportDocument(JSON.stringify(current));
  assert.deepEqual(result, { supported: true, document: current });
  assert.equal(current.data.live_coverage?.total, 102);
  assert.equal(current.data.snapshot_coverage, undefined);
});
