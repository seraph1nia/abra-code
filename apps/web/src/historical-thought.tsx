import { useState } from "react";
import type { TranscriptMessage } from "@abracode/contracts/web/contracts";
import { WorkspaceApi } from "./data.ts";
import { RequestState } from "./request-state.tsx";
import { ThoughtSource } from "./thought-source.tsx";

export default function HistoricalThought({
  message,
  request,
}: {
  message: TranscriptMessage;
  request: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Notebook source</summary>
      {open && (
        <RequestState
          query={WorkspaceApi.query("workspace", "receipt", {
            query: { request_id: request },
            timeToLive: "0 seconds",
          })}
        >
          {(receipt) =>
            receipt?.status === "admitted" &&
            receipt.message_id === message.id &&
            receipt.native_text === message.text &&
            receipt.thought ? (
              <ThoughtSource reference={receipt.thought} />
            ) : (
              <output>No verified notebook association is available for this message.</output>
            )
          }
        </RequestState>
      )}
    </details>
  );
}
