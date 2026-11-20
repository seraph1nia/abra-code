import { selectionLabel } from "@abracode/contracts/web/resources";
import { useMemo, useState } from "react";
import type { TranscriptMessage } from "@abracode/contracts/web/contracts";
import { selectedQuestion } from "@abracode/contracts/web/workspace-wire";
import { CapturedRegion } from "./image-region.tsx";
import { selectedReceiptQuery } from "../data.ts";
import { RequestState } from "../request-state.tsx";
export default function SelectedMessage({ message }: { message: TranscriptMessage }) {
  const source = useMemo(
    () => (message.role === "user" ? selectedQuestion(message.text) : undefined),
    [message],
  );
  const [open, setOpen] = useState(false);
  if (!source) return <div className="message-text">{message.text}</div>;
  return (
    <>
      <div className="message-text">{source.text}</div>
      <details onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary>
          {source.selection.issue_id} · {selectionLabel(source.selection)} · Captured selection
        </summary>
        {open && (
          <RequestState query={selectedReceiptQuery(source.request_id, source.selection.issue_id)}>
            {(receipt) => {
              if (
                !receipt?.capture ||
                receipt.message_id !== message.id ||
                receipt.native_text !== message.text
              )
                return <div className="message-text">{message.text}</div>;
              return (
                <>
                  <pre>{receipt.capture.excerpt}</pre>
                  {receipt.capture.selection.kind === "region" && (
                    <CapturedRegion region={receipt.capture.selection} />
                  )}
                  <p>
                    {receipt.status === "admitted"
                      ? "Received by Abra"
                      : "Admission awaiting confirmation"}
                  </p>
                  {receipt.answer && <p>Abra answered · {receipt.answer}</p>}
                  {receipt.followups?.map((f) => (
                    <div key={f.request_id}>
                      <p>
                        {f.role} · {f.acknowledged_at ? "Worker acknowledged" : f.status}
                      </p>
                      {f.answer && <p>{f.answer}</p>}
                      {f.check && (
                        <details>
                          <summary>Open recheck</summary>
                          <p>
                            Passed at {f.check.at} · {f.check.fingerprint}
                          </p>
                          <pre>{f.check.commands.join("\n")}</pre>
                        </details>
                      )}
                    </div>
                  ))}
                </>
              );
            }}
          </RequestState>
        )}
      </details>
    </>
  );
}
