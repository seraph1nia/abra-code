import { Effect } from "effect";
import {
  ReceiptSchema,
  type SubmissionReceipt,
  type SelectionFollowup,
} from "@abracode/contracts/web/workspace-wire";
import { CrewError, ensure, type Execution } from "../domain.ts";
import {
  SessionId,
  StorageKey,
  LockKey,
  WebSubmissionId,
  type IssueId,
} from "@abracode/contracts/identities";
import { decode } from "../decode.ts";
import type { Store } from "../storage/store.ts";
import type { Locks } from "../storage/lock.ts";
import { committedScope } from "../visibility/invalidations.ts";
import { messageRequests } from "@abracode/contracts/workflow/message-contracts";

export const selectionReceiptKey = (session: SessionId, request: WebSubmissionId) =>
  StorageKey.make(`web/receipt/${session}/${request}`);
export const admittedSelection = Effect.fn("admittedSelection")(function* (
  store: Store,
  session: SessionId,
  request: WebSubmissionId,
  issue: IssueId,
) {
  const id = yield* decode(WebSubmissionId, request, "Selected question");
  const raw = yield* store.get(selectionReceiptKey(session, id));
  const receipt = yield* decode(ReceiptSchema, raw, "Selected question");
  if (
    receipt.request_id !== id ||
    receipt.status !== "admitted" ||
    receipt.capture?.selection.issue_id !== issue
  )
    return yield* new CrewError(
      "MESSAGE_SOURCE",
      "An admitted selection on this issue is required",
    );
  return receipt;
});

export function answerSelection(
  store: Store,
  locks: Locks,
  session: SessionId,
  request: WebSubmissionId,
  issue: IssueId,
  answer: string,
) {
  return locks.with(LockKey.make("web-admission"), () =>
    Effect.gen(function* () {
      const id = yield* decode(WebSubmissionId, request, "Selected question");
      const receipt = yield* admittedSelection(store, session, id, issue);
      if (receipt.answer && receipt.answer !== answer)
        return yield* new CrewError(
          "MESSAGE_REBIND",
          "The selected request already has a different direct answer",
        );
      yield* store.set(selectionReceiptKey(session, id), { ...receipt, answer });
      yield* committedScope({ admissions: true, issues: [issue] });
      return answer;
    }),
  );
}

export function selectedFollowups(
  receipt: SubmissionReceipt,
  e: Execution | undefined,
  owner: SessionId,
): SelectionFollowup[] {
  if (!receipt.capture || e?.issue_id !== receipt.capture.selection.issue_id) return [];
  return messageRequests(e.messages)
    .filter(
      (m) =>
        m.sender_session_id === owner &&
        m.source?.type === "selection" &&
        m.source.request_id === receipt.request_id,
    )
    .map((m) => ({
      request_id: m.request_id,
      role: m.role,
      status: m.status,
      acknowledged_at: m.acknowledged_at,
      answer: m.reply?.body,
      check: m.reply?.check,
    }));
}

export function captureCheck(e: Execution, fingerprint: string) {
  const receipt = e.verification_receipt;
  ensure(
    receipt?.fingerprint === fingerprint,
    "MESSAGE_EVIDENCE",
    "Check fingerprint must match this issue's retained verification receipt",
  );
  return {
    fingerprint: receipt.fingerprint,
    at: receipt.at,
    commands: receipt.commands.map((c) => (Array.isArray(c) ? c : c.argv).join(" ")),
  };
}
