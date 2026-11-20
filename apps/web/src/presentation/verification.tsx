import { ImageRegion } from "./image-region.tsx";
import { useState } from "react";
import type { EvidenceReceipt } from "@abracode/contracts/web/worker-evidence";
import type { WebWorkItem } from "@abracode/contracts/web/wire";
import type { Inspect } from "@abracode/presentation/cards";
import { Button } from "@abracode/presentation/ui/button";
import { queries } from "../work-data.ts";
import { RequestState } from "../request-state.tsx";

export function VerificationPanel({ work, inspect }: { work: WebWorkItem; inspect: Inspect }) {
  const research = work.policy === "research-only";
  const label = research
    ? "Research contract"
    : work.policy === "lightweight-fix"
      ? "Lightweight scope"
      : "OpenSpec plan";
  return (
    <section className="verification-evidence" aria-label="Verification evidence">
      <h3>{label}</h3>
      <div className="button-row">
        <Button
          variant="outline"
          onClick={() => inspect({ action: "open_task", issue_id: work.issue_id, section: "plan" })}
        >
          Inspect scope
        </Button>
        <Button
          variant="outline"
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
      <RequestState query={queries.verification(work.issue_id)}>
        {(result) => (
          <>
            {result.plan && (
              <p>
                Scope fingerprint <code>{result.plan}</code>
              </p>
            )}
            {result.scope && (
              <>
                <p>{result.scope.goal}</p>
                <ul>
                  {[...result.scope.acceptance, ...result.scope.constraints].map((value, i) => (
                    <li key={i}>{value}</li>
                  ))}
                </ul>
              </>
            )}
            <h3>Controller checks</h3>
            {!result.checks.length && <p>No check receipt is available.</p>}
            {result.checks.map((check) => (
              <details key={check.fingerprint}>
                <summary>
                  {check.fingerprint === result.observed
                    ? "Passed on observed content"
                    : result.observed
                      ? "Earlier pass · content has changed"
                      : "Retained pass · current revision unconfirmed"}
                </summary>
                <p>
                  {check.at} · <code>{check.fingerprint}</code>
                </p>
                <pre>{check.commands.join("\n")}</pre>
              </details>
            ))}
            {result.references?.map(({ source, session_id, excerpt }, i) => (
              <div key={i}>
                {source.kind === "documentation" ? (
                  <a href={source.url} target="_blank" rel="noreferrer">
                    {source.title} · {source.version}
                  </a>
                ) : (
                  <details>
                    <summary>
                      {source.file}:{source.line} {source.symbol}
                    </summary>
                    <code>{source.revision}</code>
                    {excerpt !== undefined ? (
                      <pre>{excerpt}</pre>
                    ) : (
                      <p>Historical location unavailable.</p>
                    )}
                  </details>
                )}
                <small>Reported by {session_id}</small>
              </div>
            ))}
            {result.evidence?.map((item) => (
              <RetainedAsset key={item.request_id} receipt={item} />
            ))}
            <h3>Independent Review</h3>
            {result.review ? (
              <>
                <p>
                  {result.review.passed ? "Passed" : "Findings reported"} by{" "}
                  {result.review.session_id} ·{" "}
                  {result.review.fingerprint === result.observed
                    ? "matches observed content"
                    : "current revision unconfirmed"}
                </p>
                <code>{result.review.fingerprint}</code>
                <p>{result.review.findings}</p>
              </>
            ) : (
              <p>No independent review receipt is available.</p>
            )}
          </>
        )}
      </RequestState>
    </section>
  );
}

function RetainedAsset({ receipt }: { receipt: EvidenceReceipt }) {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{receipt.description}</summary>
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
    </details>
  );
}
