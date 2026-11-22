import { useState } from "react";
import type {
  CapacityUsageSchema,
  WorkPageSchema,
} from "@abracode/contracts/visibility/discovery-contracts";
import type { WorkspaceSnapshot } from "@abracode/contracts/web/contracts";
import { fleetLabels } from "@abracode/contracts/visibility/fleet";
function SlotUsage({ label, usage }: { label: string; usage?: typeof CapacityUsageSchema.Type }) {
  return (
    <div className="finder-slots">
      <strong>{label}</strong>
      {usage ? (
        <dl>
          <div>
            <dt>Workers</dt>
            <dd>
              {usage.workers} / {usage.worker_limit}
            </dd>
          </div>
          <div>
            <dt>Execution slots</dt>
            <dd>
              {usage.retained} / {usage.retained_limit}
            </dd>
          </div>
        </dl>
      ) : (
        <small>Usage unavailable</small>
      )}
    </div>
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
    <>
      <section className="finder-capacity" aria-label="Capacity">
        <SlotUsage label="Workspace capacity" usage={page.capacity} />
        {repository && <SlotUsage label="Selected project" usage={page.project_capacity} />}
        <small>Idle work waiting for input uses no slots.</small>
      </section>
      {page.fleet_observation?.state === "unavailable" && (
        <output className="muted">Fleet totals are temporarily unavailable.</output>
      )}
      {page.fleet && (
        <details
          className="fleet-summary"
          open={fleetOpen}
          onToggle={(event) => setFleetOpen(event.currentTarget.open)}
        >
          <summary>
            Fleet across all projects · {page.fleet.total} tasks
            {page.fleet_observation?.state === "stale" && " · Stale"}
          </summary>
          {page.fleet_observation?.state === "stale" && (
            <output className="muted">Showing stale fleet totals while they refresh.</output>
          )}
          {page.fleet_observation?.observed_at && (
            <p className="muted">
              Fleet observed at {new Date(page.fleet_observation.observed_at).toLocaleTimeString()}.
            </p>
          )}
          <dl>
            {Object.entries(page.fleet.counts)
              .filter(([, count]) => count > 0)
              .map(([state, count]) => (
                <div key={state}>
                  <dt>{fleetLabels[state as keyof typeof fleetLabels]}</dt>
                  <dd>{count}</dd>
                </div>
              ))}
          </dl>
          <section aria-label="Fleet by project" className="fleet-projects">
            {page.fleet.repositories.map((group) => (
              <details key={group.repository_id ?? "unassigned"}>
                <summary>
                  {workspace.projects.find((project) => project.id === group.repository_id)?.name ??
                    group.repository_id ??
                    "Unassigned project"}
                </summary>
                <dl>
                  {Object.entries(group.counts)
                    .filter(([, count]) => count > 0)
                    .map(([state, count]) => (
                      <div key={state}>
                        <dt>{fleetLabels[state as keyof typeof fleetLabels]}</dt>
                        <dd>{count}</dd>
                      </div>
                    ))}
                </dl>
                <p className="muted">
                  {group.attention_total === undefined
                    ? "Attention count unavailable"
                    : `${group.attention_total} attention item${group.attention_total === 1 ? "" : "s"}`}
                </p>
              </details>
            ))}
          </section>
          <p className="muted">
            Native activity observed: {page.fleet.native_observed}/{page.fleet.native_total}.
            Completed today: {page.fleet.completed_today} ({page.fleet.timezone}).
          </p>
        </details>
      )}
    </>
  );
}
