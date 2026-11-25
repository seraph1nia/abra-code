import {
  type AbsolutePath,
  SessionId,
  Fingerprint,
  Commit,
  timestamp,
} from "@abracode/contracts/identities";

import { Effect } from "effect";
import { Form } from "@opencode/schema/form";
import {
  type Execution,
  type ManagedExecution,
  type Approval,
  CrewError,
  ensure,
} from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { type Runtime } from "../opencode/runtime.ts";
import { readLeads } from "./lead-contracts.ts";
import { createHash } from "node:crypto";
import type { Git } from "../git/repository.ts";
import type { Records } from "../storage/store.ts";
import { scopeIdentity } from "../work/scope.ts";
import { approvedEvidence } from "./evidence.ts";
import { currentPlanning } from "./planning-contracts.ts";

type Kind = "plan" | "merge";
type ApprovalTarget =
  | { kind: "plan"; fingerprint: Fingerprint }
  | { kind: "merge"; fingerprint: Commit };
type ApprovalCheckpoint = ApprovalTarget & { session_id: SessionId };
const retainedIdentity = (e: ManagedExecution, kind: Kind) =>
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
                  .update(
                    e.rounds?.findLast((r) => r.openspec_change !== e.openspec_change)?.id ??
                      "revision",
                  )
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

export type ApprovalActorCheck = (session: SessionId) => Effect.Effect<void, CrewError>;

export const assertApprovalActor =
  (records: Records, runtime: Runtime, home: AbsolutePath): ApprovalActorCheck =>
  (session) =>
    Effect.gen(function* () {
      if (yield* records.workerAssignment(session))
        return yield* new CrewError("SELF_APPROVAL", "Workers cannot authorize decisions");
      const native = yield* runtime.session(session);
      if (
        native.agent !== "abra" ||
        native.directory !== home ||
        (yield* readLeads(records)).some(
          (lead) => lead.session_id === session || lead.retired_sessions.includes(session),
        )
      )
        return yield* new CrewError("ABRA_REQUIRED", "Use the central Abra session");
    });

/** Owns durable form ordering and retry collection; callers own locks and transitions. */
export class Authorizations {
  constructor(
    private records: Records,
    private runtime: Runtime,
    private evidence: CheckpointEvidence,
    readonly assertActor: ApprovalActorCheck,
    private validatePlanning?: (e: Execution) => Effect.Effect<void, CrewError>,
  ) {}

  collect = Effect.fn("Authorizations.collect")(
    function* (this: Authorizations, e: Execution, kind: Kind, supervisor: SessionId) {
      yield* this.assertActor(supervisor);
      if (kind === "plan") {
        if (e.workflow_policy === "full-openspec") yield* this.validatePlanning?.(e) ?? Effect.void;
        const fingerprint = yield* this.evidence.plan(e);
        if (
          e.workflow_policy !== "full-openspec" &&
          !(e.scope && e.scope.fingerprint === fingerprint && e.plan_fingerprint === fingerprint)
        )
          return yield* new CrewError(
            "SCOPE_CHANGED",
            "Scoped contract changed; explicitly revise and approve it",
          );
        if (!fingerprint || fingerprint !== e.plan_fingerprint)
          return yield* new CrewError("STALE_CHECKPOINT", "Checkpoint changed");
        return yield* this.collectIdentity(e, supervisor, { kind: "plan", fingerprint });
      }
      const fingerprint = e.delivered_commit;
      if (!fingerprint) return yield* new CrewError("STALE_CHECKPOINT", "Checkpoint changed");
      return yield* this.collectIdentity(e, supervisor, { kind: "merge", fingerprint });
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
        yield* this.assertActor(receipt.session_id);
        const target: ApprovalTarget =
          receipt.kind === "plan"
            ? { kind: "plan", fingerprint: receipt.fingerprint }
            : { kind: "merge", fingerprint: receipt.fingerprint };
        const { decision } = yield* this.collectIdentity(e, receipt.session_id, target);
        if (decision === "rejected") return kind;
      }
    }.bind(this),
    domainEffect,
  );

  private collectIdentity = Effect.fn("Authorizations.collectIdentity")(
    function* (this: Authorizations, e: Execution, supervisor: SessionId, target: ApprovalTarget) {
      const checkpoint: ApprovalCheckpoint =
        target.kind === "plan"
          ? { kind: "plan", fingerprint: target.fingerprint, session_id: supervisor }
          : { kind: "merge", fingerprint: target.fingerprint, session_id: supervisor };
      return yield* collectForm(
        e,
        this.records,
        this.runtime,
        checkpoint,
        `Authorize ${target.kind} for ${e.issue_id} (${target.fingerprint.slice(0, 12)})`,
        target.kind === "plan" && e.workflow_policy === "full-openspec"
          ? () => this.validatePlanning?.(e) ?? Effect.void
          : undefined,
      );
    }.bind(this),
    domainEffect,
  );
}

export const collectForm = Effect.fn("Authorizations.collectForm")(function* (
  e: ManagedExecution,
  records: Records,
  runtime: Runtime,
  checkpoint: ApprovalCheckpoint,
  title: string,
  validate?: () => Effect.Effect<void, CrewError>,
) {
  const { kind, fingerprint } = checkpoint;
  const active = (receipt: Approval) =>
    receipt.kind === kind && receipt.fingerprint === fingerprint && !receipt.rejected_at;
  const assertCurrent = (current: ManagedExecution) =>
    ensure(
      retainedIdentity(current, kind) === fingerprint,
      "STALE_CHECKPOINT",
      "Approval checkpoint changed",
    );
  const reserved = yield* records.commitOwned(e, (current) => {
    assertCurrent(current);
    if (current.approval_receipts.some(active)) return;
    const entry: Approval =
      checkpoint.kind === "plan"
        ? {
            kind: "plan",
            fingerprint: checkpoint.fingerprint,
            session_id: checkpoint.session_id,
            form_id: Form.ID.create(),
          }
        : {
            kind: "merge",
            fingerprint: checkpoint.fingerprint,
            session_id: checkpoint.session_id,
            form_id: Form.ID.create(),
          };
    return {
      approval_receipts: [...current.approval_receipts, entry],
    };
  });
  const receipt = reserved.approval_receipts.find(active)!;
  if (receipt.authorized_at) return { decision: "approved" as const, receipt };
  const { session_id, form_id } = receipt;
  yield* runtime.requestApproval(session_id, form_id, title, fingerprint);
  const decision = yield* runtime.approval(session_id, form_id);
  if (decision === "pending") return { decision, receipt };
  if (decision === "approved" && validate) yield* validate();
  const at = yield* timestamp;
  const matches = (r: Approval) =>
    r.kind === kind &&
    r.fingerprint === fingerprint &&
    r.session_id === session_id &&
    r.form_id === form_id;
  const saved = yield* records.commitOwned(e, (current) => {
    assertCurrent(current);
    const bound = current.approval_receipts.find(matches);
    ensure(bound, "STALE_CHECKPOINT", "Saved approval form changed");
    if (decision === "approved" ? bound.authorized_at : bound.rejected_at) return;
    ensure(
      !bound.authorized_at && !bound.rejected_at,
      "STALE_CHECKPOINT",
      "Saved approval decision changed",
    );
    const answer = decision === "approved" ? { authorized_at: at } : { rejected_at: at };
    return {
      approval_receipts: current.approval_receipts.map((r) =>
        r === bound ? { ...r, ...answer } : r,
      ),
    };
  });
  return { decision, receipt: saved.approval_receipts.find(matches)! };
}, domainEffect);
