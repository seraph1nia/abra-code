import {
  validateReportDocument,
  reportCatalogs,
} from "@abracode/contracts/presentation/report-document";
import { catalogId } from "@abracode/contracts/web/catalog";
import { WorkspaceFixture } from "./web.ts";

export function reportDocument() {
  const source = new WorkspaceFixture();
  const sections = [
    "summary",
    "findings",
    "checks",
    "events",
    "excerpts",
    "limitations",
    "diagrams",
  ];
  return validateReportDocument({
    format: "a2ui-snapshot",
    format_version: 1,
    document_id: "frozen-report",
    revision: 1,
    title: "Saved evidence",
    captured_at: "2026-11-15T10:00:00.000Z",
    catalog_id: catalogId,
    ...reportCatalogs[catalogId],
    provenance: {
      issue_id: "abra-web",
      execution_id: "execution-web",
      generation: 2,
      source_surface: {
        session_id: source.sessionID,
        surface_id: "frozen-layout",
        revision: 4,
        hash: "b".repeat(64),
      },
    },
    surface: {
      version: "1.0",
      createSurface: {
        surfaceId: "frozen-layout",
        catalogId,
        components: [
          { id: "root", component: "Column", children: ["work", "snapshotWork", ...sections] },
          { id: "work", component: "WorkTable", issueIds: ["abra-web"], mode: "live" },
          { id: "snapshotWork", component: "WorkTable", issueIds: ["abra-web"], mode: "snapshot" },
          ...sections.map((section) => ({ id: section, component: "ReportEvidence", section })),
        ],
      },
    },
    data: {
      snapshot_work: [{ ...source.value.work.work[0], title: "Older snapshot task title" }],
      work: [
        {
          ...source.value.work.work[0],
          title: "Frozen task title",
          phase: "awaiting_plan_approval",
          dependencies: [],
          dependency_count: 0,
        },
      ],
      evidence: {
        schema_version: 1,
        issue_id: "abra-web",
        execution_id: "execution-web",
        title: "Captured report evidence",
        summary: "Attributed snapshot commentary",
        observed_at: "2026-11-15T10:00:00.000Z",
        provenance: "Disposable captured evidence",
        status: "Awaiting plan approval",
        findings: [
          {
            title: "A captured finding",
            category: "Worker claim",
            summary: "<script>hostile()</script>",
            evidence: "Retained worker claim",
            references: [{ path: "source.ts", line: 1, commit: "a".repeat(40) }],
          },
        ],
        checks: [
          { name: "Repository verification", status: "not_run" },
          {
            name: "Pending native checks",
            status: "pending",
            evidence: "Waiting for native validation",
          },
        ],
        events: [
          { label: "Later event", status: "pending", at: "2026-11-15T10:00:00.000Z" },
          { label: "Earlier event", status: "observed", at: "2026-11-14T10:00:00.000Z" },
          { label: "Untimed evidence", status: "unavailable" },
        ],
        excerpts: [
          {
            title: "Captured code",
            kind: "code",
            text: "export const captured = " + "x".repeat(600),
            provenance: "Source at capture",
          },
        ],
        diagrams: [{ title: "Captured relationship", source: "flowchart LR\n  A --> B" }],
        limitations: ["The snapshot is not live."],
      },
    },
    limitations: ["Captured values only; later workflow state is not substituted."],
  });
}

/** New coverage records exercise partial live values beside legacy unknown snapshots. */
export function coveredReportDocument(includeCatalog = false) {
  const document = reportDocument();
  return validateReportDocument({
    ...document,
    surface: {
      ...document.surface,
      createSurface: {
        ...document.surface.createSurface,
        components: [
          ...document.surface.createSurface.components.map((component) =>
            component.id === "root"
              ? {
                  ...component,
                  children: [
                    ...(Array.isArray(component.children) ? component.children : []),
                    "counts",
                    ...(includeCatalog
                      ? [
                          "board",
                          "dependencies",
                          "timeline",
                          "decisions",
                          "reports",
                          "resource",
                          "catalogDiagram",
                        ]
                      : []),
                  ],
                }
              : component.id === "work"
                ? { id: component.id, component: "WorkTable", mode: "live" }
                : component,
          ),
          { id: "counts", component: "StatusSummary", mode: "live" },
          ...(includeCatalog
            ? [
                { id: "board", component: "Kanban", mode: "snapshot" },
                { id: "dependencies", component: "DependencyGraph", mode: "snapshot" },
                { id: "timeline", component: "Timeline", mode: "snapshot" },
                { id: "decisions", component: "DecisionSummary", mode: "snapshot" },
                { id: "reports", component: "ReportLink", issueId: "abra-web" },
                {
                  id: "catalogDiagram",
                  component: "Mermaid",
                  title: "Catalog relationship",
                  source: "flowchart LR\n  A --> B",
                },
                {
                  id: "resource",
                  component: "ResourceLink",
                  label: "Retained task",
                  target: { action: "open_task", issue_id: "abra-web" },
                },
              ]
            : []),
        ],
      },
    },
    data: {
      ...document.data,
      live_coverage: {
        population: "retained-work",
        requested_ids: [],
        returned: 1,
        total: 102,
        unavailable_ids: [],
        truncated: true,
        status: "observed",
      },
    },
  });
}
