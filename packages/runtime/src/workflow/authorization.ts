import { SessionId, Fingerprint, Commit, timestamp } from "../identities.ts";

import { Effect } from "effect";
import { Form } from "@opencode/schema/form";
import { type Execution, CrewError } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { type Runtime } from "../opencode/runtime.ts";
import { historicalWorkers } from "./worker-assignment.ts";
import { createHash } from "node:crypto";
import type { Git } from "../git/repository.ts";
import type { Records } from "../storage/store.ts";
import { scopeIdentity } from "../work/scope.ts";
import { approvedEvidence } from "./evidence.ts";
import { currentPlanning } from "./planning-contracts.ts";

type Kind = "plan" | "merge";
const retainedIdentity = (e: Execution, kind: Kind) =>
  kind === "plan" ? e.plan_fingerprint : e.delivered_commit;
const currentReceipts = (e: Execution, kind: Kind) =>
  e.approval_receipts.filter(
    (a) => a.kind === kind && a.fingerprint === retainedIdentity(e, kind) && !a.rejected_at,
  );

/** Read-only content and receipt evidence. Observers receive no form or write adapter. */
export class CheckpointEvidence {
  constructor(private git: Git) {}

  plan(e: Execution) {
    if (e.workflow_policy !== "full-openspec")
      return Effect.succeed(e.scope && scopeIdentity(e.scope.revision, e.scope.contract));
    return this.git.planFingerprint(e.worktree_directory!, e.openspec_change).pipe(
      Effect.map((content) =>
        currentPlanning(e)
          ? Fingerprint.make(
              createHash("sha256")
                .update("abracode-controlled-plan-v1")
                .update(currentPlanning(e)!.id)
                .update(content)
                .digest("hex"),
            )
          : // Identical artifact bytes in a new revision still require fresh authorization.
            e.planning_base_commit
            ? Fingerprint.make(
                createHash("sha256")
                  .update(e.openspec_change)
                  .update(e.rounds?.at(-1)?.id ?? "revision")
                  .update(content)
                  .digest("hex"),
              )
            : content,
      ),
    );
  }

  /** Retained status alone never proves that current worktree content still matches. */
  status(e: Execution, kind: Kind) {
    const receipts = currentReceipts(e, kind);
    return receipts.some((a) => a.authorized_at)
      ? "approved"
      : receipts.length
        ? "pending"
        : "missing";
  }

  observe(e: Execution, session: SessionId, form: string) {
    return Effect.gen({ self: this }, function* () {
      const receipt = e.approval_receipts.find(
        (a) => a.session_id === session && a.form_id === form,
      );
      if (!receipt) return;
      let active =
        !receipt.rejected_at &&
        !receipt.authorized_at &&
        e.current_phase ===
          (receipt.kind === "plan" ? "awaiting_plan_approval" : "awaiting_merge") &&
        receipt.fingerprint === retainedIdentity(e, receipt.kind);
      if (active && receipt.kind === "plan" && e.workflow_policy === "full-openspec") {
        const observed = yield* this.plan(e).pipe(Effect.result);
        active = observed._tag === "Success" && observed.success === receipt.fingerprint;
      }
      return {
        active,
        issue_id: e.issue_id,
        kind: receipt.kind,
        fingerprint: receipt.fingerprint,
        generation: e.control_generation,
      };
    });
  }

  assertPlan = Effect.fn("CheckpointEvidence.assertPlan")(
    function* (this: CheckpointEvidence, e: Execution) {
      const fingerprint = yield* this.plan(e);
      if (fingerprint !== e.plan_fingerprint)
        return yield* new CrewError(
          "PLAN_CHANGED",
          "Approved planning artifacts changed; prepare a new approval",
        );
      if (e.plan_approval_required !== false && this.status(e, "plan") !== "approved")
        return yield* new CrewError("APPROVAL_REQUIRED", "Plan approval is missing or stale");
      return yield* approvedEvidence(e);
    }.bind(this),
    domainEffect,
  );
}

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

/** Owns durable form ordering and retry collection; callers own locks and transitions. */
export class Authorizations {
  constructor(
    private records: Records,
    private runtime: Runtime,
    private evidence: CheckpointEvidence,
    private validatePlanning?: (e: Execution) => Effect.Effect<void, CrewError>,
  ) {}

  collect = Effect.fn("Authorizations.collect")(
    function* (this: Authorizations, e: Execution, kind: Kind, supervisor: SessionId) {
      yield* assertApprovalActor(e, supervisor);
      if (kind === "plan" && e.workflow_policy === "full-openspec")
        yield* this.validatePlanning?.(e) ?? Effect.void;
      const fingerprint = kind === "plan" ? yield* this.evidence.plan(e) : e.delivered_commit;
      if (
        kind === "plan" &&
        e.workflow_policy !== "full-openspec" &&
        !(e.scope && e.scope.fingerprint === fingerprint && e.plan_fingerprint === fingerprint)
      )
        return yield* new CrewError(
          "SCOPE_CHANGED",
          "Scoped contract changed; explicitly revise and approve it",
        );
      if (!fingerprint || (kind === "plan" && fingerprint !== e.plan_fingerprint))
        return yield* new CrewError("STALE_CHECKPOINT", "Checkpoint changed");
      return yield* this.collectIdentity(e, kind, supervisor, fingerprint);
    }.bind(this),
    domainEffect,
  );

  /** Recollect retained forms without reauthorizing content; later admission rechecks it. */
  collectPending = Effect.fn("Authorizations.collectPending")(
    function* (this: Authorizations, e: Execution) {
      const kind =
        e.current_phase === "awaiting_plan_approval"
          ? "plan"
          : e.current_phase === "awaiting_merge"
            ? "merge"
            : undefined;
      if (!kind) return;
      for (const receipt of currentReceipts(e, kind).filter((a) => !a.authorized_at)) {
        const { decision } = yield* this.collectIdentity(
          e,
          kind,
          receipt.session_id,
          receipt.fingerprint,
        );
        if (decision === "rejected") return kind;
      }
    }.bind(this),
    domainEffect,
  );

  private collectIdentity = Effect.fn("Authorizations.collectIdentity")(
    function* (
      this: Authorizations,
      e: Execution,
      kind: Kind,
      supervisor: SessionId,
      fingerprint: Fingerprint | Commit,
    ) {
      yield* assertApprovalActor(e, supervisor);
      let receipt = currentReceipts(e, kind).find((a) => a.fingerprint === fingerprint);
      if (!receipt) {
        receipt = { kind, fingerprint, session_id: supervisor, form_id: Form.ID.create() };
        e.approval_receipts.push(receipt);
        yield* this.records.saveOwned(e, ["approval_receipts"]);
        // The owned save refreshes the aggregate; update its retained receipt, not the old object.
        receipt = currentReceipts(e, kind).find((a) => a.fingerprint === fingerprint)!;
      }
      if (receipt.authorized_at) return { decision: "approved" as const, receipt };
      yield* this.runtime.requestApproval(
        receipt.session_id,
        receipt.form_id,
        `Authorize ${kind} for ${e.issue_id} (${fingerprint.slice(0, 12)})`,
        fingerprint,
      );
      const decision = yield* this.runtime.approval(receipt.session_id, receipt.form_id);
      if (decision === "approved" && kind === "plan" && e.workflow_policy === "full-openspec")
        yield* this.validatePlanning?.(e) ?? Effect.void;
      if (decision === "approved") receipt.authorized_at = yield* timestamp;
      if (decision === "rejected") receipt.rejected_at = yield* timestamp;
      if (decision !== "pending") yield* this.records.saveOwned(e, ["approval_receipts"]);
      return { decision, receipt };
    }.bind(this),
    domainEffect,
  );
}
