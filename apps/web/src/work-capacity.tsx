import { useState } from "react";
import type {
  CapacityUsageSchema,
  WorkPageSchema,
} from "@abracode/contracts/visibility/discovery-contracts";
import type { WorkspaceSnapshot } from "@abracode/contracts/web/contracts";
import { fleetLabels } from "@abracode/contracts/visibility/fleet";
import { SectionCard, StatusBadge } from "@abracode/presentation/cockpit";

function SlotUsage({ label, usage }: { label: string; usage?: typeof CapacityUsageSchema.Type }) {
  const workerPct =
    usage && usage.worker_limit > 0
      ? Math.min(100, Math.round((usage.workers / usage.worker_limit) * 100))
      : 0;
  const retainedPct =
    usage && usage.retained_limit > 0
      ? Math.min(100, Math.round((usage.retained / usage.retained_limit) * 100))
      : 0;
  return (
    <SectionCard title={label} className="finder-slots">
      {usage ? (
        <dl className="bento-2 capacity-grid">
          <div className="metric-well">
            <dt className="metric-label">Workers</dt>
            <dd className="metric-value">
              {usage.workers} / {usage.worker_limit}
            </dd>
            <div className="capacity-bar is-running" aria-hidden="true">
              <span style={{ width: `${workerPct}%` }} />
            </div>
          </div>
          <div className="metric-well">
            <dt className="metric-label">Execution slots</dt>
            <dd className="metric-value">
              {usage.retained} / {usage.retained_limit}
            </dd>
            <div className="capacity-bar" aria-hidden="true">
              <span style={{ width: `${retainedPct}%` }} />
            </div>
          </div>
        </dl>
      ) : (
        <small className="muted">Usage unavailable</small>
      )}
    </SectionCard>
  );
}

export function WorkCapacity({
  page,
  repository,
  workspace,
}: {
  page: typeof WorkPageSchema.Type;
  repository?: string;
  workspace: WorkspaceSnapshot;
}) {
  const [fleetOpen, setFleetOpen] = useState(false);
  return (
    <div className="inspector-stack">
      <section className="finder-capacity inspector-stack" aria-label="Capacity">
        <SlotUsage label="Workspace capacity" usage={page.capacity} />
        {repository && <SlotUsage label="Selected project" usage={page.project_capacity} />}
        <small className="muted">Idle work waiting for input uses no slots.</small>
      </section>
      {page.fleet_observation?.state === "unavailable" && (
        <output className="muted">Fleet totals are temporarily unavailable.</output>
      )}
      {page.fleet && (
        <details
          className="fleet-summary evidence-disclosure"
          open={fleetOpen}
          onToggle={(event) => setFleetOpen(event.currentTarget.open)}
        >
          <summary>
            Fleet across all projects · {page.fleet.total} tasks
            {page.fleet_observation?.state === "stale" && " · Stale"}
          </summary>
          <div className="evidence-disclosure-body">
            {page.fleet_observation?.state === "stale" && (
              <output className="muted">Showing stale fleet totals while they refresh.</output>
            )}
            {page.fleet_observation?.observed_at && (
              <p className="muted">
                Fleet observed at{" "}
                {new Date(page.fleet_observation.observed_at).toLocaleTimeString()}.
              </p>
            )}
            <dl className="fleet-kv-list">
              {Object.entries(page.fleet.counts)
                .filter(([, count]) => count > 0)
                .map(([state, count]) => (
                  <div key={state} className="metric-well">
                    <dt className="metric-label">
                      {fleetLabels[state as keyof typeof fleetLabels]}
                    </dt>
                    <dd className="metric-value">{count}</dd>
                  </div>
                ))}
            </dl>
            <section aria-label="Fleet by project" className="fleet-projects inspector-stack">
              {page.fleet.repositories.map((group) => (
                <details key={group.repository_id ?? "unassigned"} className="evidence-disclosure">
                  <summary>
                    <span>
                      {workspace.projects.find((project) => project.id === group.repository_id)
                        ?.name ??
                        group.repository_id ??
                        "Unassigned project"}
                    </span>
                    {group.attention_total !== undefined && group.attention_total > 0 && (
                      <StatusBadge tone="attention">{group.attention_total} attention</StatusBadge>
                    )}
                  </summary>
                  <div className="evidence-disclosure-body">
                    <dl className="fleet-kv-list">
                      {Object.entries(group.counts)
                        .filter(([, count]) => count > 0)
                        .map(([state, count]) => (
                          <div key={state} className="metric-well">
                            <dt className="metric-label">
                              {fleetLabels[state as keyof typeof fleetLabels]}
                            </dt>
                            <dd className="metric-value">{count}</dd>
                          </div>
                        ))}
                    </dl>
                    <p className="muted">
                      {group.attention_total === undefined
                        ? "Attention count unavailable"
                        : `${group.attention_total} attention item${group.attention_total === 1 ? "" : "s"}`}
                    </p>
                  </div>
                </details>
              ))}
            </section>
            <p className="muted">
              Native activity observed: {page.fleet.native_observed}/{page.fleet.native_total}.
              Completed today: {page.fleet.completed_today} ({page.fleet.timezone}).
            </p>
          </div>
        </details>
      )}
    </div>
  );
}
