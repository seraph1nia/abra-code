import { Link, useRouterState } from "@tanstack/react-router";
import { useLayoutEffect, useRef, useState } from "react";
import type { WorkspaceSnapshot } from "@abracode/contracts/web/contracts";
import type { ResourceSelection } from "@abracode/contracts/web/resources";
import { EvidenceDisclosure, SectionCard, StatusBadge } from "@abracode/presentation/cockpit";
import { AlertTriangle } from "@abracode/presentation/icons";
import { Button } from "@abracode/presentation/ui/button";
import { deferred } from "@abracode/presentation/deferred";
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
    let raf = 0;
    const focus = () => {
      const target = document.getElementById(hash);
      if (!target || !container.contains(target) || !target.isConnected) return false;
      if (!target.contains(document.activeElement)) target.focus({ preventScroll: true });
      if (document.activeElement !== target && !target.contains(document.activeElement))
        return false;
      target.scrollIntoView({ block: "nearest" });
      return true;
    };
    if (focus()) return;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (focus()) observer.disconnect();
      });
    };
    const observer = new MutationObserver(() => {
      if (focus()) observer.disconnect();
      else schedule();
    });
    observer.observe(container, { childList: true, subtree: true });
    schedule();
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [hash, attentionOpen, bound]);
  const nextForm = workspace.forms.find((item) => item.active && item.checkpoint?.active);
  const owners = [...new Set(workAttention.map((entry) => entry.owner))];
  const totalCount = attention;

  return (
    <section
      ref={section}
      className="attention inspector-stack"
      hidden={!attentionOpen}
      aria-label="Needs your attention"
    >
      <div className="section-heading">
        <AlertTriangle aria-hidden="true" className="attention-icon" />
        <h2>Needs your attention</h2>
        <StatusBadge tone={totalCount > 0 ? "attention" : "success"}>{totalCount}</StatusBadge>
      </div>
      {hash && !bound && /^(form|permission)-/.test(hash) && (
        <output className="error-banner">
          <span>
            The selected request has closed or its binding has changed. Review the current requests
            below.
          </span>
          {nextForm && (
            <Link to="/attention" hash={"form-" + nextForm.form.id + "-" + nextForm.binding}>
              Open next decision
            </Link>
          )}
        </output>
      )}
      {workspace.work_unavailable && (
        <output className="error-banner">{workspace.work_unavailable}</output>
      )}
      {(workspace.forms.length > 0 || workspace.permissions.length > 0) && (
        <div className="inspector-stack">
          <h3 className="eyebrow">Your forms and permissions</h3>
          {workspace.forms
            .filter(
              (item) =>
                attentionOpen ||
                (item.checkpoint?.kind !== "plan" && item.checkpoint?.kind !== "merge"),
            )
            .map((item) => (
              <NativeForm key={`${item.form.id}-${item.binding}`} item={item} refresh={refresh} />
            ))}
          {workspace.permissions.map((item) => (
            <NativePermission key={item.request.id} item={item} refresh={refresh} />
          ))}
        </div>
      )}
      {owners.map((owner) => (
        <SectionCard
          key={owner}
          title={owner === "user" ? "Your work" : owner}
          aria-label={"Obligations for " + owner}
        >
          <div className="list-group">
            {workAttention
              .filter((entry) => entry.owner === owner)
              .map((entry) => (
                <div className="work-attention list-row" key={`${entry.issue_id}:${entry.key}`}>
                  <div className="list-row-main">
                    <Button
                      variant="ghost"
                      className="work-attention-btn h-auto whitespace-normal"
                      onClick={() =>
                        entry.key === "communication"
                          ? inspect({
                              action: "open_task",
                              issue_id: entry.issue_id,
                              section: "activity",
                              activity: "communication",
                              ...(entry.request && { request: entry.request }),
                            })
                          : open(entry.issue_id)
                      }
                    >
                      {entry.title} · {entry.reason}
                    </Button>
                    <p className="muted">
                      {entry.owner === "user" ? "You" : entry.owner} · {entry.next_action}
                    </p>
                  </div>
                </div>
              ))}
          </div>
        </SectionCard>
      ))}
      {managementAttention.length > 0 && (
        <SectionCard title="Lead requests and proposals">
          <div className="inspector-stack">
            {managementAttention.map((entry) => (
              <LazyLeadAttention
                key={`${entry.lead_id}/${entry.repository_id}`}
                entry={entry}
                inspect={inspect}
              />
            ))}
          </div>
        </SectionCard>
      )}
      {workspace.work.management?.truncated && (
        <output className="muted">
          Lead attention coverage is limited to 20 repository/lead pairs.
        </output>
      )}
      {(workspace.work.management?.diagnostic_count ?? 0) > 0 && (
        <output className="muted">
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
    <EvidenceDisclosure
      data-management-attention
      summary={`${entry.lead_id} · ${entry.repository_id} · ${entry.unanswered} unanswered · ${entry.proposals} unaccepted proposals`}
      open={opened}
      onToggle={setOpened}
      className="management-attention-item"
    >
      {opened && (
        <LeadsPanel
          repository={entry.repository_id}
          initialLead={entry.lead_id}
          inspect={inspect}
        />
      )}
    </EvidenceDisclosure>
  );
}
