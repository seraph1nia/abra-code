import type { AttentionForm } from "@abracode/contracts/web/contracts";
import type { WorkOverviewSchema } from "@abracode/contracts/web/wire";
import { phaseLabel } from "@abracode/contracts/presentation/work-state";
import { OutcomeSummary, Evidence } from "@abracode/presentation/cards";
import { SectionCard, StatusBadge, statusTone } from "@abracode/presentation/cockpit";
import { Button } from "@abracode/presentation/ui/button";
import { Markdown } from "../markdown.tsx";
import { ExecutionContractSummary } from "../presentation/execution-contract.tsx";
import { ThoughtSource } from "../thought-source.tsx";
import { workControl } from "../workspace-commands.ts";

export function Overview({
  detail,
  ask,
  forms,
  focusForm,
}: {
  detail: typeof WorkOverviewSchema.Type;
  ask: (text: string) => void;
  forms: readonly AttentionForm[];
  focusForm: (id: string) => void;
}) {
  const work = detail.work;
  const statusText = work.phase ? phaseLabel(work.phase) : work.issue_status;
  const policyLabel =
    work.policy === "research-only"
      ? "Research task"
      : work.policy === "lightweight-fix"
        ? "Lightweight fix"
        : work.policy === "full-openspec"
          ? "Full OpenSpec task"
          : "Workflow policy unavailable";
  const activeCheckpoints = forms.filter(
    (item) =>
      item.active &&
      item.checkpoint?.active &&
      item.checkpoint.issue_id === work.issue_id &&
      (item.checkpoint.kind === "plan" || item.checkpoint.kind === "merge"),
  );

  return (
    <div className="inspector-stack">
      <SectionCard
        title={
          <span className="detail-status">
            <StatusBadge tone={statusTone(statusText)} dot>
              {statusText}
            </StatusBadge>
            <StatusBadge tone="neutral">P{work.priority}</StatusBadge>
            <StatusBadge tone="neutral">{policyLabel}</StatusBadge>
          </span>
        }
        actions={
          <div className="button-row" style={{ margin: 0 }}>
            {(["pause", "resume", "advance"] as const).map((action) => (
              <Button
                variant="outline"
                size="sm"
                key={action}
                onClick={() => ask(workControl(action, work.issue_id).text)}
              >
                Ask Abra to {action} work
              </Button>
            ))}
          </div>
        }
      >
        {activeCheckpoints.length > 0 && (
          <div className="button-row" style={{ margin: 0 }}>
            {activeCheckpoints.map((item) => (
              <Button
                key={item.form.id}
                variant="outline"
                size="sm"
                onClick={() => focusForm(item.form.id)}
              >
                Review current {item.checkpoint!.kind} approval
              </Button>
            ))}
          </div>
        )}
        <Markdown
          key={detail.description}
          className="prose"
          content={detail.description}
          mode="static"
        />
        {detail.thought_source && (
          <ThoughtSource
            reference={detail.thought_source.reference}
            excerpt={detail.thought_source.excerpt}
          />
        )}
        <p className="muted">
          Controls send a request to Abra. The controller validates each transition.
        </p>
      </SectionCard>

      {work.outcome && (
        <SectionCard title="Outcomes" aria-label="Independent work outcomes">
          <OutcomeSummary outcome={work.outcome} />
          <p>{work.outcome.next_action}</p>
          <Evidence>
            {work.outcome.delivered_commit && (
              <p>
                Delivered commit: <code>{work.outcome.delivered_commit}</code>
              </p>
            )}
            {work.outcome.approval.evidence_at && (
              <p>Approval recorded {work.outcome.approval.evidence_at}</p>
            )}
            {work.outcome.delivery.evidence_at && (
              <p>Delivery recorded {work.outcome.delivery.evidence_at}</p>
            )}
            {work.outcome.cleanup.blocker && (
              <>
                <p>Cleanup is blocked by retained local resources.</p>
                <ul>
                  {work.outcome.cleanup.blocker.paths.map((path) => (
                    <li key={path.path}>
                      {path.path} · {path.category}
                    </li>
                  ))}
                </ul>
                {work.outcome.cleanup.blocker.truncated && (
                  <p>More resources exist outside this preview.</p>
                )}
              </>
            )}
          </Evidence>
        </SectionCard>
      )}

      {(work.progress || work.blockers.length > 0 || work.eligibility_observed === false) && (
        <div className="bento-2">
          {work.progress && (
            <SectionCard title="Latest progress">
              <p>{work.progress.summary}</p>
              <small className="muted">{new Date(work.progress.at).toLocaleString()}</small>
            </SectionCard>
          )}
          {(work.blockers.length > 0 || work.eligibility_observed === false) && (
            <SectionCard
              title="Readiness"
              accent={work.blockers.length > 0 ? "attention" : undefined}
            >
              {work.blockers.length > 0 && (
                <ul className="readiness-list">
                  {work.blockers.map((blocker) => (
                    <li key={blocker}>{blocker}</li>
                  ))}
                </ul>
              )}
              {work.eligibility_observed === false && (
                <p className="muted">
                  Readiness to start has not been checked. Ask Abra to assess ready work.
                </p>
              )}
            </SectionCard>
          )}
        </div>
      )}

      {work.execution_contract && (
        <SectionCard title="Planning and repair">
          <ExecutionContractSummary contract={work.execution_contract} />
        </SectionCard>
      )}

      {detail.errors.length > 0 && (
        <details className="evidence-disclosure">
          <summary>Unavailable planning evidence ({detail.errors.length})</summary>
          <div className="evidence-disclosure-body">
            {detail.errors.map((error, index) => (
              <p key={index}>{error}</p>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
