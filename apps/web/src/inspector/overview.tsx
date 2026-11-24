import type { AttentionForm } from "@abracode/contracts/web/contracts";
import type { WorkOverviewSchema } from "@abracode/contracts/web/wire";
import { phaseLabel } from "@abracode/contracts/presentation/work-state";
import { OutcomeSummary, Evidence } from "@abracode/presentation/cards";
import { Badge } from "@abracode/presentation/ui/badge";
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
  return (
    <>
      <div className="detail-status">
        <span className={`status-dot ${work.issue_status}`} />
        {work.phase ? phaseLabel(work.phase) : work.issue_status}
        <Badge variant="secondary">P{work.priority}</Badge>
      </div>
      <p>
        {work.policy === "research-only"
          ? "Research task"
          : work.policy === "lightweight-fix"
            ? "Lightweight fix"
            : work.policy === "full-openspec"
              ? "Full OpenSpec task"
              : "Workflow policy unavailable"}
      </p>
      {forms
        .filter(
          (item) =>
            item.active &&
            item.checkpoint?.active &&
            item.checkpoint.issue_id === work.issue_id &&
            (item.checkpoint.kind === "plan" || item.checkpoint.kind === "merge"),
        )
        .map((item) => (
          <Button key={item.form.id} variant="outline" onClick={() => focusForm(item.form.id)}>
            Review current {item.checkpoint!.kind} approval
          </Button>
        ))}
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
      {work.execution_contract && <ExecutionContractSummary contract={work.execution_contract} />}
      {work.outcome && (
        <section aria-label="Independent work outcomes">
          <h3>Outcomes</h3>
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
        </section>
      )}
      {detail.errors.length > 0 && (
        <details>
          <summary>Unavailable planning evidence</summary>
          {detail.errors.map((error, index) => (
            <p key={index}>{error}</p>
          ))}
        </details>
      )}
      {work.progress && (
        <section>
          <h3>Latest progress</h3>
          <p>{work.progress.summary}</p>
          <small>{new Date(work.progress.at).toLocaleString()}</small>
        </section>
      )}
      {work.blockers.length > 0 && (
        <section>
          <h3>Readiness</h3>
          <ul>
            {work.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </section>
      )}
      {work.eligibility_observed === false && (
        <p className="muted">
          Readiness to start has not been checked. Ask Abra to assess ready work.
        </p>
      )}
      <div className="button-row">
        {(["pause", "resume", "advance"] as const).map((action) => (
          <Button
            variant="outline"
            key={action}
            onClick={() => ask(workControl(action, work.issue_id).text)}
          >
            Ask Abra to {action} work
          </Button>
        ))}
      </div>
      <p className="muted">
        Controls send a request to Abra. The controller validates each transition.
      </p>
    </>
  );
}
