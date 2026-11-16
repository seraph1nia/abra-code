import { SessionId, Fingerprint, Commit, timestamp } from "../identities.ts";

import { Effect } from "effect";
import { Form } from "@opencode/schema/form";
import { type Execution, CrewError } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { type Runtime } from "../opencode/runtime.ts";
import { historicalWorkers } from "./worker-assignment.ts";

export const assertApprovalActor = (e: Execution, supervisor: SessionId) =>
  Effect.gen(function* () {
    if (
      [
        e.explore_session_id,
        e.apply_session_id,
        e.review_session_id,
        e.research_session_id,
        e.session_intent?.id,
        ...historicalWorkers(e).map((worker) => worker.id),
      ].includes(supervisor)
    )
      return yield* new CrewError("SELF_APPROVAL", "Workers cannot authorize decisions");
  });

/** Owns exact-content forms and retained receipts; callers own lifecycle advancement. */
export const collectApproval = Effect.fn("Authorization.collect")(function* (
  runtime: Runtime,
  e: Execution,
  kind: "plan" | "merge",
  supervisor: SessionId,
  fingerprint: Fingerprint | Commit,
  save: () => Effect.Effect<unknown, CrewError>,
) {
  yield* assertApprovalActor(e, supervisor);
  if (!fingerprint)
    return yield* new CrewError("STALE_CHECKPOINT", "Checkpoint identity is missing");
  let receipt = e.approval_receipts.find(
    (a) => a.kind === kind && a.fingerprint === fingerprint && !a.rejected_at,
  );
  if (!receipt) {
    receipt = { kind, fingerprint, session_id: supervisor, form_id: Form.ID.create() };
    e.approval_receipts.push(receipt);
    yield* save();
  }
  if (receipt.authorized_at) return { decision: "approved" as const, receipt };
  yield* runtime.requestApproval(
    receipt.session_id,
    receipt.form_id,
    `Authorize ${kind} for ${e.issue_id} (${fingerprint.slice(0, 12)})`,
    fingerprint,
  );
  const decision = yield* runtime.approval(receipt.session_id, receipt.form_id);
  if (decision === "approved") receipt.authorized_at = yield* timestamp;
  if (decision === "rejected") receipt.rejected_at = yield* timestamp;
  if (decision !== "pending") yield* save();
  return { decision, receipt };
}, domainEffect);
