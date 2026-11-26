import { useWorkspaceCall } from "../data.ts";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRetainedSubmission } from "../use-retained-submission.ts";
import { Cause, Equal, Exit, Option } from "effect";
import { WebSubmissionId } from "@abracode/contracts/identities";
import { SubmissionSchema } from "@abracode/contracts/web/workspace-wire";
import type { WorkspaceSnapshot } from "@abracode/contracts/web/contracts";
import { readRetained, writeRetained } from "../retained-input.ts";
import { readReceipt, submitMessage } from "../data.ts";
import { requestError } from "../request-error.ts";

type Pending = typeof SubmissionSchema.Type;
type Receipt = WorkspaceSnapshot["receipts"][number];

export function useWorkspaceAdmission({
  workspace,
  isReady,
  draft,
  selection,
  thought,
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
  thought?: Pending["thought"];
  clearSent: (input: Pending) => void;
  setDraft: (text: string) => void;
  refresh: () => void;
  setError: (text: string) => void;
}) {
  const storageKey = `abra-pending-${workspace.session_id}`;
  const [pending, setPending] = useState(() => readRetained(storageKey, SubmissionSchema));
  const { working: admitting, submit } = useRetainedSubmission(submitMessage);
  const mounted = useRef(false);
  const reconciledIds = useRef(new Set<string>());
  const lookupReceipt = useWorkspaceCall(readReceipt);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const applyReceipt = useCallback(
    (
      expected: Pending,
      receipt: Receipt | null,
    ): "admitted" | "uncertain" | "conflict" | "none" => {
      if (!receipt) return "none";
      if (
        receipt.request_id !== expected.request_id ||
        receipt.text !== expected.text ||
        receipt.delivery !== expected.delivery ||
        !Equal.equals(receipt.thought, expected.thought) ||
        !Equal.equals(receipt.capture?.selection, expected.selection)
      ) {
        setError(
          "Submission identity conflicts with retained evidence. The pending input was preserved.",
        );
        return "conflict";
      }
      if (receipt.status === "admitted") {
        if (!reconciledIds.current.has(expected.request_id)) {
          reconciledIds.current.add(expected.request_id);
          if (reconciledIds.current.size > 32) {
            const oldest = reconciledIds.current.values().next().value;
            if (oldest !== undefined) reconciledIds.current.delete(oldest);
          }
          if (expected.selection || expected.thought) clearSent(expected);
        }
        setPending(undefined);
        try {
          localStorage.removeItem(storageKey);
        } catch {
          setError("Submission was admitted, but browser recovery storage is unavailable.");
        }
        return "admitted";
      }
      if (receipt.status === "uncertain") {
        setError(
          "Submission is uncertain. Use Reconcile submission to check the same input identity.",
        );
        return "uncertain";
      }
      return "none";
    },
    [clearSent, setError, storageKey],
  );

  useEffect(() => {
    if (!pending) return;
    let active = true;
    const recent = workspace.receipts.find((r) => r.request_id === pending.request_id);
    if (recent) {
      void Promise.resolve().then(() => {
        if (active) applyReceipt(pending, recent);
      });
    } else if (!admitting) {
      // History is a display window, not the admission ledger. Read the exact
      // retained identity on restored or subsequent server observations.
      void lookupReceipt(pending.request_id).then((result) => {
        if (!active) return;
        if (Exit.isSuccess(result)) applyReceipt(pending, result.value);
        else setError(requestError(result.cause));
      });
    }
    return () => {
      active = false;
    };
  }, [workspace.receipts, pending, admitting, lookupReceipt, setError, applyReceipt]);

  async function send(input?: Pending) {
    if (!isReady || admitting || (!input && pending)) return;
    const submission: Pending = input ?? {
      request_id: WebSubmissionId.make(crypto.randomUUID()),
      text: draft.trim(),
      ...(selection && { selection }),
      ...(thought && { thought }),
      delivery,
    };
    if (!submission.text) return;
    // Persist before starting network admission; a storage failure leaves the draft intact.
    const result = await submit(submission, () => {
      if (!writeRetained(storageKey, submission)) {
        setError(
          "Cannot retain submission identity in browser storage. Enable storage before sending.",
        );
        return false;
      }
      setPending(submission);
      if (!submission.selection && !submission.thought) setDraft("");
      setError("");
      return true;
    });
    if (!result || !mounted.current) return;
    if (Exit.isSuccess(result)) {
      const outcome = applyReceipt(submission, result.value);
      if (outcome !== "admitted") {
        refresh();
      }
      return;
    }
    const failure = Cause.findErrorOption(result.cause);
    const errorObj =
      Option.isSome(failure) && failure.value && typeof failure.value === "object"
        ? failure.value
        : undefined;
    const code = errorObj && "code" in errorObj ? String(errorObj.code) : undefined;
    const message = errorObj && "message" in errorObj ? String(errorObj.message) : undefined;
    if ((submission.selection || submission.thought) && code?.startsWith("SELECTION_")) {
      setPending(undefined);
      try {
        localStorage.removeItem(storageKey);
      } catch {
        /* Keep the mounted draft. */
      }
      setError(message ?? requestError(result.cause));
    } else if (!reconciledIds.current.has(submission.request_id)) {
      setError(message ?? "Submission could not be confirmed. Reconcile before sending again.");
    }
    refresh();
  }
  return { pending, admitting, send };
}
