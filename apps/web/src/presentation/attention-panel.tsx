import { flushSync } from "react-dom";
import { useRef, useState } from "react";
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
  reviewNext,
  refresh,
  open,
  inspect,
}: {
  workspace: WorkspaceSnapshot;
  workAttention: NonNullable<WorkspaceSnapshot["work"]["fleet"]>["attention"];
  attention: number;
  attentionOpen: boolean;
  reviewNext: () => void;
  refresh: () => void;
  open: (id: string) => void;
  inspect: (target: ResourceSelection) => void;
}) {
  const managementAttention = workspace.work.management?.entries ?? [];
  const section = useRef<HTMLElement>(null);
  const next = workspace.forms.find((item) => item.active);
  return (
    <>
      {!!attention && !attentionOpen && (
        <div className="attention-shortcut">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              flushSync(reviewNext);
              const selector = next
                ? `[data-native-form-id="${CSS.escape(next.form.id)}"]`
                : "[data-native-permission]";
              section.current?.querySelector<HTMLElement>(selector)?.focus();
            }}
          >
            Review next
          </Button>
        </div>
      )}
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
        {workspace.forms.map((item) => (
          <NativeForm key={`${item.form.id}-${item.binding}`} item={item} refresh={refresh} />
        ))}
        {workspace.permissions.map((item) => (
          <NativePermission key={item.request.id} item={item} refresh={refresh} />
        ))}
        {workAttention.map((entry) => (
          <div className="work-attention" key={`${entry.issue_id}:${entry.key}`}>
            <Button variant="ghost" onClick={() => open(entry.issue_id)}>
              {entry.title} · {entry.reason}
            </Button>
            <p className="muted">
              {entry.owner === "user" ? "You" : entry.owner} · {entry.next_action}
            </p>
          </div>
        ))}
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
