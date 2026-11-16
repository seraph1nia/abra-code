import { bindWork } from "@abracode/presentation/work-bindings";
import { WorkspaceFixture } from "../helpers/web.ts";
import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { bindingRequirements, selectBindingRows } from "@abracode/contracts/web/bindings";
import { validateSurface, catalogId } from "../../src/web/surfaces.ts";
const surface = () =>
  validateSurface({
    version: "1.0",
    createSurface: {
      surfaceId: "mixed",
      catalogId,
      components: [
        { id: "root", component: "Column", children: ["all", "some", "live", "link", "empty"] },
        { id: "all", component: "WorkTable", mode: "snapshot" },
        {
          id: "some",
          component: "StatusSummary",
          mode: "snapshot",
          issueIds: ["abra-2", "abra-2"],
        },
        { id: "live", component: "WorkTable", issueIds: ["abra-3"] },
        { id: "link", component: "ReportLink", issueId: "abra-1" },
        { id: "empty", component: "Kanban", issueIds: [] },
      ],
    },
  });

test("requirements preserve per-widget modes, deduplicate references and retain unfiltered siblings", () => {
  assert.deepEqual(bindingRequirements(surface()), {
    ids: ["abra-1", "abra-2", "abra-3"],
    unfiltered: true,
  });
  assert.deepEqual(bindingRequirements(surface(), "snapshot"), {
    ids: ["abra-1", "abra-2"],
    unfiltered: true,
  });
  assert.deepEqual(bindingRequirements(surface(), "live"), { ids: ["abra-3"], unfiltered: false });
  const rows = [{ issue_id: "abra-2" }, { issue_id: "abra-1" }, { issue_id: "abra-3" }];
  const captured = selectBindingRows(bindingRequirements(surface()), rows, 3);
  assert.equal(captured.rows.length, 3);
  assert.equal(captured.coverage.truncated, false);
  assert.deepEqual(selectBindingRows({ ids: [], unfiltered: false }, rows).rows, []);
});

test("explicit requirements survive deterministic 100-row budgeting without silent loss", () => {
  const rows = Array.from({ length: 102 }, (_, i) => ({
    issue_id: `abra-${String(i).padStart(3, "0")}`,
  }));
  const a = selectBindingRows({ ids: ["abra-101", "abra-101"], unfiltered: true }, rows, 102);
  const b = selectBindingRows({ ids: ["abra-101"], unfiltered: true }, rows.toReversed(), 102);
  assert.deepEqual(a, b);
  assert.equal(a.rows[0]!.issue_id, "abra-101");
  assert.equal(a.rows.length, 100);
  assert.equal(a.coverage.total, 102);
  assert.equal(a.coverage.truncated, true);
  assert.equal(
    selectBindingRows(
      { ids: rows.slice(0, 100).map((row) => row.issue_id), unfiltered: false },
      rows,
    ).rows.length,
    100,
  );
  assert.throws(
    () =>
      selectBindingRows(
        { ids: rows.slice(0, 101).map((row) => row.issue_id), unfiltered: false },
        rows,
      ),
    /exceed/,
  );
});

test("unavailable explicit IDs and unknown unfiltered totals are evidence, never successful zero counts", () => {
  const result = selectBindingRows({ ids: ["abra-missing"], unfiltered: false }, []);
  assert.equal(result.coverage.status, "unavailable");
  assert.deepEqual(result.coverage.unavailable_ids, ["abra-missing"]);
  assert.equal(result.coverage.total, 1);
  const unknown = selectBindingRows({ ids: [], unfiltered: true }, []);
  assert.equal(unknown.coverage.total, undefined);
  assert.equal(unknown.coverage.truncated, true);
});

test("pure bindings distinguish unavailable, pending, stale, partial and historical unknown coverage", () => {
  const row = new WorkspaceFixture().value.work.work[0]!;
  const captured = [{ ...row, title: "Captured original" }];
  const coverage = selectBindingRows({ ids: [row.issue_id], unfiltered: false }, [row]).coverage;
  const binding = {
    work: [],
    captured,
    capturedAt: "2026-11-16T10:00:00Z",
    liveCoverage: { ...coverage, status: "pending" as const },
  };
  assert.match(bindWork({ issueIds: [row.issue_id] }, binding).label, /Pending data/);
  assert.equal(bindWork({ issueIds: [row.issue_id] }, binding).incomplete, true);
  assert.match(bindWork({ mode: "snapshot" }, binding).label, /Coverage unknown/);
  assert.equal(bindWork({ mode: "snapshot" }, binding).selected[0]!.title, "Captured original");
  const stale = bindWork(
    { issueIds: [row.issue_id] },
    { ...binding, work: [row], liveCoverage: { ...coverage, status: "stale" } },
  );
  assert.equal(stale.selected.length, 1);
  assert.match(stale.label, /Stale data/);
  const partial = bindWork(
    {},
    { ...binding, work: [row], liveCoverage: { ...coverage, total: 200, truncated: true } },
  );
  assert.equal(partial.total, 200);
  assert.match(partial.label, /Partial data/);
  const missing = bindWork(
    { issueIds: [row.issue_id] },
    { ...binding, liveCoverage: { ...coverage, status: "unavailable" } },
  );
  assert.match(missing.label, /Unavailable/);
});
