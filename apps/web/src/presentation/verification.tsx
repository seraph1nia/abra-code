import { ImageRegion } from "./image-region.tsx";
import { useState } from "react";
import type { EvidenceReceipt } from "@abracode/contracts/web/worker-evidence";
import type { WebWorkItem } from "@abracode/contracts/web/wire";
import type { Inspect } from "@abracode/presentation/cards";
import { EvidenceDisclosure, SectionCard, StatusBadge } from "@abracode/presentation/cockpit";
import { CheckCircle2, ShieldCheck, ArrowUpRight } from "@abracode/presentation/icons";
import { Button } from "@abracode/presentation/ui/button";
import { queries } from "../work-data.ts";
import { RequestState } from "../request-state.tsx";

export function VerificationPanel({
  work,
  inspect,
  decision,
  focusForm,
}: {
  work: WebWorkItem;
  inspect: Inspect;
  decision?: string;
  focusForm: (id: string) => void;
}) {
  const research = work.policy === "research-only";
  const label = research
    ? "Research contract"
    : work.policy === "lightweight-fix"
      ? "Lightweight scope"
      : "OpenSpec plan";
  const actions = (
    <SectionCard
      title={label}
      actions={
        decision ? (
          <Button size="sm" onClick={() => focusForm(decision)}>
            Answer current decision
          </Button>
        ) : undefined
      }
    >
      <div className="button-row" style={{ margin: 0 }}>
        <Button
          variant="outline"
          size="sm"
          onClick={() => inspect({ action: "open_task", issue_id: work.issue_id, section: "plan" })}
        >
          Inspect scope
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            inspect(
              research
                ? { action: "open_task", issue_id: work.issue_id, section: "reports" }
                : { action: "open_changes", issue_id: work.issue_id },
            )
          }
        >
          {research ? "Inspect research report" : "Inspect changes"}
        </Button>
      </div>
    </SectionCard>
  );
  return (
    <section className="verification-evidence inspector-stack" aria-label="Verification evidence">
      <RequestState query={queries.verification(work.issue_id)} unavailable={actions}>
        {(result) => {
          const checksCurrent = result.checks.some(
            (check) => check.fingerprint === result.observed,
          );
          const checkTone = !result.checks.length
            ? "neutral"
            : checksCurrent
              ? "success"
              : "attention";
          const reviewTone = !result.review
            ? "neutral"
            : result.review.passed
              ? result.review.fingerprint === result.observed
                ? "success"
                : "attention"
              : "danger";
          return (
            <div className="inspector-stack">
              <div className="bento-2">
                <SectionCard
                  title="Controller checks"
                  icon={<CheckCircle2 aria-hidden="true" />}
                  accent={
                    checkTone === "success"
                      ? "success"
                      : checkTone === "attention"
                        ? "attention"
                        : undefined
                  }
                  actions={
                    <StatusBadge tone={checkTone} dot>
                      {!result.checks.length
                        ? "No receipt"
                        : checksCurrent
                          ? "Passed"
                          : "Earlier pass"}
                    </StatusBadge>
                  }
                >
                  {!result.checks.length ? (
                    <p className="muted">No check receipt is available.</p>
                  ) : (
                    <p>
                      {checksCurrent
                        ? "Checks passed on the observed content."
                        : result.observed
                          ? "Earlier checks passed. Current content has no matching check receipt."
                          : "An earlier check passed. Current content is unconfirmed."}
                    </p>
                  )}
                  {result.checks.map((check) => (
                    <EvidenceDisclosure
                      key={check.fingerprint}
                      summary={
                        check.fingerprint === result.observed
                          ? "Passed on observed content"
                          : result.observed
                            ? "Earlier pass · content has changed"
                            : "Retained pass · current revision unconfirmed"
                      }
                    >
                      <p>
                        {check.at} · <code>{check.fingerprint}</code>
                      </p>
                      <pre className="report-code">{check.commands.join("\n")}</pre>
                    </EvidenceDisclosure>
                  ))}
                </SectionCard>

                <SectionCard
                  title="Independent Review"
                  icon={<ShieldCheck aria-hidden="true" />}
                  accent={
                    reviewTone === "danger"
                      ? "danger"
                      : reviewTone === "success"
                        ? "success"
                        : undefined
                  }
                  actions={
                    <StatusBadge tone={reviewTone} dot>
                      {!result.review
                        ? "Pending"
                        : result.review.passed
                          ? "Passed"
                          : "Findings reported"}
                    </StatusBadge>
                  }
                >
                  {result.review ? (
                    <>
                      <p>
                        {result.review.passed ? "Passed" : "Findings reported"} by{" "}
                        <code>{result.review.session_id}</code> ·{" "}
                        {result.review.fingerprint === result.observed
                          ? "matches observed content"
                          : "current revision unconfirmed"}
                      </p>
                      <EvidenceDisclosure summary="Review evidence">
                        <code>{result.review.fingerprint}</code>
                        <p>{result.review.findings}</p>
                      </EvidenceDisclosure>
                    </>
                  ) : (
                    <p className="muted">No independent review receipt is available.</p>
                  )}
                </SectionCard>
              </div>

              {actions}

              {(result.plan || result.scope) && (
                <SectionCard title="Captured scope &amp; acceptance">
                  {result.scope && (
                    <>
                      <p>{result.scope.goal}</p>
                      <ul className="readiness-list">
                        {[...result.scope.acceptance, ...result.scope.constraints].map(
                          (value, i) => (
                            <li key={i}>{value}</li>
                          ),
                        )}
                      </ul>
                    </>
                  )}
                  {result.plan && (
                    <EvidenceDisclosure summary="Scope fingerprint">
                      <code>{result.plan}</code>
                    </EvidenceDisclosure>
                  )}
                </SectionCard>
              )}

              {result.references && result.references.length > 0 && (
                <SectionCard title={`Worker references (${result.references.length})`}>
                  <div className="inspector-stack">
                    {result.references.map(({ source, session_id, excerpt }, i) => (
                      <div key={i} className="reference-item">
                        {source.kind === "documentation" ? (
                          <a href={source.url} target="_blank" rel="noreferrer">
                            {source.title} · {source.version} <ArrowUpRight aria-hidden="true" />
                          </a>
                        ) : (
                          <EvidenceDisclosure
                            summary={`${source.file}:${source.line} ${source.symbol}`}
                          >
                            <code>{source.revision}</code>
                            {excerpt !== undefined ? (
                              <pre className="report-code">{excerpt}</pre>
                            ) : (
                              <p>Historical location unavailable.</p>
                            )}
                          </EvidenceDisclosure>
                        )}
                        <small className="muted">Reported by {session_id}</small>
                      </div>
                    ))}
                  </div>
                </SectionCard>
              )}

              {result.evidence && result.evidence.length > 0 && (
                <SectionCard title={`Retained artifacts (${result.evidence.length})`}>
                  <div className="inspector-stack">
                    {result.evidence.map((item) => (
                      <RetainedAsset key={item.request_id} receipt={item} />
                    ))}
                  </div>
                </SectionCard>
              )}
            </div>
          );
        }}
      </RequestState>
    </section>
  );
}

export function RetainedAsset({ receipt }: { receipt: EvidenceReceipt }) {
  const [open, setOpen] = useState(false);
  return (
    <EvidenceDisclosure summary={receipt.description} open={open} onToggle={setOpen}>
      <p>
        {receipt.session_id} · generation {receipt.generation} · {receipt.at}
      </p>
      <p>
        Revision unverified
        {receipt.claimed_revision && " · worker reported " + receipt.claimed_revision}
      </p>
      {open && (
        <RequestState query={queries.evidence(receipt)}>
          {(asset) =>
            asset.receipt.kind === "trace" ? (
              <a
                download={asset.receipt.request_id + ".zip"}
                href={"data:application/zip;base64," + asset.data}
              >
                Download Playwright trace
              </a>
            ) : (
              <ImageRegion asset={asset} />
            )
          }
        </RequestState>
      )}
    </EvidenceDisclosure>
  );
}
