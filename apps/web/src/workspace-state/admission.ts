/* oxlint-disable effecttsgo/unstable-api-usage -- Scoped browser observation and typed HTTP atoms. */
import { useEffect, useRef, useState } from "react";
import { HttpAgent } from "@ag-ui/client";
import { useAtomSet } from "@effect/atom-react";
import { readRetained, writeRetained } from "../retained-input.ts";
import { Exit } from "effect";
import { SubmissionSchema } from "@abracode/contracts/web/workspace-wire";
import type { WorkspaceSnapshot } from "@abracode/contracts/web/contracts";
import { readReceipt } from "../data.ts";
import { requestError } from "../request-state.tsx";
type Pending = typeof SubmissionSchema.Type;
export function useWorkspaceAdmission({
  workspace,
  isReady,
  draft,
  selection,
  clearSent,
  delivery,
  setDraft,
  refresh,
  setError,
}: {
  workspace: WorkspaceSnapshot;
  isReady: boolean;
  draft: string;
  delivery: Pending["delivery"];
  selection?: Pending["selection"];
  clearSent: (input: Pending) => void;
  setDraft: (text: string) => void;
  refresh: () => void;
  setError: (text: string) => void;
}) {
  const storageKey = `abra-pending-${workspace.session_id}`;
  const [pending, setPending] = useState(() => readRetained(storageKey, SubmissionSchema));
  const [admitting, setAdmitting] = useState(false);
  const admittingRef = useRef(false);
  const mounted = useRef(false);
  const senders = useRef(new Map<string, { agent: HttpAgent; admitted: boolean }>());
  const lookupReceipt = useAtomSet(readReceipt, { mode: "promiseExit" });
  useEffect(() => {
    mounted.current = true;
    const transports = senders.current;
    return () => {
      mounted.current = false;
      for (const sender of transports.values()) void sender.agent.detachActiveRun();
      transports.clear();
    };
  }, []);
  useEffect(() => {
    if (!pending) return;
    let active = true;
    const reconcile = (receipt: WorkspaceSnapshot["receipts"][number] | null) => {
      if (!active || !receipt) return;
      if (
        receipt.request_id !== pending.request_id ||
        receipt.text !== pending.text ||
        receipt.delivery !== pending.delivery ||
        JSON.stringify(receipt.capture?.selection) !== JSON.stringify(pending.selection)
      ) {
        setAdmitting(false);
        admittingRef.current = false;
        setError(
          "Submission identity conflicts with retained evidence. The pending input was preserved.",
        );
        return;
      }
      if (receipt.status === "admitted") {
        const sender = senders.current.get(pending.request_id);
        if (sender) {
          sender.admitted = true;
          void sender.agent.detachActiveRun();
        }
        if (pending.selection) clearSent(pending);
        setPending(undefined);
        setAdmitting(false);
        admittingRef.current = false;
        try {
          localStorage.removeItem(storageKey);
        } catch {
          setError("Submission was admitted, but browser recovery storage is unavailable.");
        }
      } else if (receipt.status === "uncertain") {
        setAdmitting(false);
        admittingRef.current = false;
        setError(
          "Submission is uncertain. Use Reconcile submission to check the same input identity.",
        );
      }
    };
    const recent = workspace.receipts.find((r) => r.request_id === pending.request_id);
    if (recent) reconcile(recent);
    else {
      // History is a display window, not the admission ledger. Read the exact
      // retained identity on restored or subsequent server observations.
      void lookupReceipt(pending.request_id).then((result) => {
        if (!active) return;
        if (Exit.isSuccess(result)) reconcile(result.value);
        else setError(requestError(result.cause));
      });
    }
    return () => {
      active = false;
    };
  }, [workspace.receipts, pending, storageKey, lookupReceipt, setError, clearSent]);

  async function send(input?: Pending) {
    if (!isReady || admittingRef.current || (!input && pending)) return;
    const submission = input ?? {
      request_id: crypto.randomUUID(),
      text: draft.trim(),
      ...(selection && { selection }),
      delivery,
    };
    if (!submission.text) return;
    // Persist before starting network admission; a storage failure leaves the draft intact.
    if (!writeRetained(storageKey, submission)) {
      setError(
        "Cannot retain submission identity in browser storage. Enable storage before sending.",
      );
      return;
    }
    admittingRef.current = true;
    setAdmitting(true);
    setPending(submission);
    if (!submission.selection) setDraft("");
    setError("");
    const sender = {
      agent: new HttpAgent({
        url: "/api/copilotkit/agent/abra/run",
        agentId: "abra",
        threadId: workspace.session_id,
        initialMessages: [{ id: submission.request_id, role: "user", content: submission.text }],
      }),
      admitted: false,
    };
    senders.current.set(submission.request_id, sender);
    let refused = false;
    try {
      await sender.agent.runAgent(
        {
          tools: [],
          context: [],
          forwardedProps: {
            request_id: submission.request_id,
            delivery: submission.delivery,
            ...(submission.selection && { selection: submission.selection }),
          },
        },
        {
          onRunErrorEvent: ({ event }) => {
            if (!submission.selection || !event.code?.startsWith("SELECTION_") || !mounted.current)
              return;
            refused = true;
            setPending(undefined);
            try {
              localStorage.removeItem(storageKey);
            } catch {
              /* Keep the mounted draft. */
            }
            setError(event.message);
          },
        },
      );
    } catch (cause) {
      if (!sender.admitted && !refused && mounted.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "Submission could not be confirmed. Reconcile before sending again.",
        );
    } finally {
      senders.current.delete(submission.request_id);
      if (mounted.current && !sender.admitted) {
        admittingRef.current = false;
        setAdmitting(false);
        refresh();
      }
    }
  }
  return { pending, admitting, send };
}
