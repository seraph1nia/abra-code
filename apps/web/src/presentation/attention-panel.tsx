import { Link, useRouterState } from "@tanstack/react-router";
import { useLayoutEffect, useRef, useState } from "react";
import type { WorkspaceSnapshot } from "@abracode/contracts/web/contracts";
import type { ResourceSelection } from "@abracode/contracts/web/resources";
import { Button } from "@abracode/presentation/ui/button";
import { deferred } from "../deferred.tsx";
import { NativeForm, NativePermission } from "../native-attention.tsx";
const LeadsPanel = deferred<React.ComponentProps<typeof import("./leads.tsx").LeadsPanel>>(
  () => import("./leads.tsx").then((module) => ({ default: module.LeadsPanel })),
  "Lead history",
  "deferred-panel",
);

export function AttentionPanel({
  workspace,
  workAttention,
  attention,
  attentionOpen,
  refresh,
  open,
  inspect,
}: {
  workspace: WorkspaceSnapshot;
  workAttention: NonNullable<WorkspaceSnapshot["work"]["fleet"]>["attention"];
  attention: number;
  attentionOpen: boolean;
  refresh: () => void;
  open: (id: string) => void;
  inspect: (target: ResourceSelection) => void;
}) {
  const managementAttention = workspace.work.management?.entries ?? [];
  const section = useRef<HTMLElement>(null);
  const hash = useRouterState({ select: (state) => state.location.hash });
  const bound =
    workspace.forms.some(
      (item) => item.active && hash === "form-" + item.form.id + "-" + item.binding,
    ) ||
    workspace.permissions.some(
      (item) => hash === "permission-" + item.request.id + "-" + item.binding,
    );
  useLayoutEffect(() => {
    if (!attentionOpen || !bound) return;
    const container = section.current;
    if (!container) return;
    const focus = () => {
      const target = document.getElementById(hash);
      if (!target || !container.contains(target)) return false;
      if (!target.contains(document.activeElement)) target.focus({ preventScroll: true });
      target.scrollIntoView({ block: "nearest" });
      return true;
    };
    if (focus()) return;
    const observer = new MutationObserver(() => {
      if (focus()) observer.disconnect();
    });
    observer.observe(container, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [hash, attentionOpen, bound]);
  const nextForm = workspace.forms.find((item) => item.active && item.checkpoint?.active);
  const owners = [...new Set(workAttention.map((entry) => entry.owner))];
  return (
    <>
      <section
        ref={section}
        className="attention"
        hidden={!attentionOpen}
        aria-label="Needs your attention"
      >
        <div className="section-heading">
          <span className="attention-symbol">!</span>
          <h2>Needs your attention</h2>
          <span className="count">
            {attention + workAttention.length + managementAttention.length}
          </span>
        </div>
        {hash && !bound && /^(form|permission)-/.test(hash) && (
          <output>
            The selected request has closed or its binding has changed. Review the current requests
            below.{" "}
            {nextForm && (
              <Link to="/attention" hash={"form-" + nextForm.form.id + "-" + nextForm.binding}>
                Open next decision
              </Link>
            )}
          </output>
        )}
        {workspace.work_unavailable && <output>{workspace.work_unavailable}</output>}
        {attention > 0 && <h3>Your forms and permissions</h3>}
        {workspace.forms.map((item) => (
          <NativeForm key={`${item.form.id}-${item.binding}`} item={item} refresh={refresh} />
        ))}
        {workspace.permissions.map((item) => (
          <NativePermission key={item.request.id} item={item} refresh={refresh} />
        ))}
        {owners.map((owner) => (
          <section key={owner} aria-label={"Obligations for " + owner}>
            <h3>{owner === "user" ? "Your work" : owner}</h3>
            {workAttention
              .filter((entry) => entry.owner === owner)
              .map((entry) => (
                <div className="work-attention" key={`${entry.issue_id}:${entry.key}`}>
                  <Button variant="ghost" onClick={() => open(entry.issue_id)}>
                    {entry.title} · {entry.reason}
                  </Button>
                  <p className="muted">
                    {entry.owner === "user" ? "You" : entry.owner} · {entry.next_action}
                  </p>
                </div>
              ))}
          </section>
        ))}
        {managementAttention.length > 0 && <h3>Lead requests and proposals</h3>}
        {managementAttention.map((entry) => (
          <LazyLeadAttention
            key={`${entry.lead_id}/${entry.repository_id}`}
            entry={entry}
            inspect={inspect}
          />
        ))}
        {workspace.work.management?.truncated && (
          <output>Lead attention coverage is limited to 20 repository/lead pairs.</output>
        )}
        {(workspace.work.management?.diagnostic_count ?? 0) > 0 && (
          <output>
            Some retained lead evidence is unavailable. Inspect scoped lead diagnostics before
            assuming there is no pending work.
          </output>
        )}
        {workspace.work.fleet?.attention_truncated && (
          <output className="muted">
            Attention coverage is limited. Additional retained obligations may be available through
            Work.
          </output>
        )}
      </section>
    </>
  );
}

function LazyLeadAttention({
  entry,
  inspect,
}: {
  entry: NonNullable<WorkspaceSnapshot["work"]["management"]>["entries"][number];
  inspect: (target: ResourceSelection) => void;
}) {
  const [opened, setOpened] = useState(false);
  return (
    <details data-management-attention onToggle={(event) => setOpened(event.currentTarget.open)}>
      <summary>
        {entry.lead_id} · {entry.repository_id} · {entry.unanswered} unanswered · {entry.proposals}{" "}
        unaccepted proposals
      </summary>
      {opened && (
        <LeadsPanel
          repository={entry.repository_id}
          initialLead={entry.lead_id}
          inspect={inspect}
        />
      )}
    </details>
  );
}
