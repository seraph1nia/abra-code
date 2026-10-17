import { externalOwns } from "../validation/contracts.ts";
import { ObligationKey, RoundId, FindingId, ChangeName } from "../identities.ts";
import { Clock, Effect } from "effect";
import { createHash } from "node:crypto";
import { CrewError, ensure, type Execution } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { synchronizeExecution, type Records } from "../storage/store.ts";
import { type Git } from "../git/repository.ts";
import { type ScopeDispositionSchema } from "./correction-contracts.ts";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
export class Corrections {
  constructor(
    private records: Records,
    private git: Git,
  ) {}
  decision = Effect.fn("Corrections.decision")(
    function* (this: Corrections, e: Execution, reason: string) {
      const at = yield* Clock.currentTimeMillis;
      const key = ObligationKey.make(`correction-${hash(reason).slice(0, 32)}`);
      const saved = yield* this.records.update(e.issue_id, (current) => {
        ensure(
          current.control_generation === e.control_generation &&
            current.operation?.id === e.operation?.id,
          "STALE_OPERATION",
          "Correction decision was superseded",
        );
        if (
          current.decisions?.some(
            (d) => d.key === key && d.generation === current.control_generation,
          )
        )
          return;
        return {
          ...current,
          decisions: [
            ...(current.decisions ?? []),
            {
              schema_version: 1,
              key,
              generation: current.control_generation,
              scope: current.workflow_policy,
              question: reason.slice(0, 8192),
              owner: "user",
              session_id: "controller",
              opened_at: at,
              status: "open",
            },
          ],
        };
      });
      synchronizeExecution(e, saved);
      return key;
    }.bind(this),
    domainEffect,
  );
  prepare = Effect.fn("Corrections.prepare")(
    function* (
      this: Corrections,
      e: Execution,
      source: "check" | "review" | "forge",
      findings: readonly FindingId[],
      instructions: string,
      scope: typeof ScopeDispositionSchema.Type,
    ) {
      if (externalOwns(e))
        return yield* new CrewError(
          "EXTERNAL_CUSTODY",
          "Return external branch custody before admitting a native writer or changing its scope",
        );
      if (!(e.workflow_policy !== "research-only" && !e.stop_status))
        return yield* new CrewError(
          "CORRECTION_POLICY",
          "Coding correction cannot resume paused/research work",
        );
      if (!e.plan_fingerprint)
        return yield* new CrewError("CORRECTION_PLAN", "Approved planning identity is required");
      const budget = e.effective_policy.repair_rounds;
      const head = yield* this.git.head(e.worktree_directory!);
      const ids = [...new Set(findings)].sort();
      const duplicate = e.rounds?.some((r) => r.findings.some((id) => ids.includes(id)));
      if (scope !== "in_scope" || (e.rounds?.length ?? 0) >= budget || duplicate) {
        yield* this.decision(
          e,
          scope !== "in_scope"
            ? `Correction requires ${scope === "scope_change" ? "revised scope approval" : "clarification"}: ${instructions}`
            : duplicate
              ? `Repeated correction finding requires inspection: ${instructions}`
              : `Correction budget exhausted (${e.rounds?.length ?? 0}/${budget}): ${instructions}`,
        );
        return undefined;
      }
      const ordinal = (e.rounds?.length ?? 0) + 1;
      const postArchive = !!e.archive_path || !!e.delivered_commit;
      const round = {
        schema_version: 1 as const,
        worker_sessions: (["explore", "apply", "review", "research"] as const).flatMap((role) => {
          const id = e[`${role}_session_id`];
          return id ? [{ id, role }] : [];
        }),
        id: RoundId.make(`round-${ordinal}-${hash(JSON.stringify([head, ids])).slice(0, 24)}`),
        ordinal,
        generation: e.control_generation,
        source,
        starting_head: head,
        plan_fingerprint: e.plan_fingerprint,
        findings: ids,
        instructions,
        openspec_change: e.openspec_change,
        archive_path: e.archive_path,
        prior_delivered_commit: e.delivered_commit,
        pull_request_reference: e.pull_request_reference,
        approval_receipts: structuredClone(e.approval_receipts),
        created_at: yield* Clock.currentTimeMillis,
      };
      e.rounds = [...(e.rounds ?? []), round];
      e.retry_instructions = `Correction round ${ordinal}/${budget}: ${instructions}. Preserve accepted scope and all previous archived artifacts.`;
      delete e.verification_receipt;
      delete e.review_receipt;
      delete e.delivery_receipt;
      delete e.delivered_commit;
      delete e.delivery_wait;
      delete e.active_role;
      delete e.capacity_reservation;
      delete e.archive_path;
      delete e.archived_tree;
      const revision = e.workflow_policy === "full-openspec" && postArchive;
      if (revision) {
        delete e.explore_session_id;
        delete e.apply_session_id;
        delete e.review_session_id;
        e.openspec_change = ChangeName.make(`${e.openspec_change}-r${ordinal}`);
        e.planning_base_commit = head;
        delete e.plan_fingerprint;
        e.current_phase = "planning";
      } else e.current_phase = "applying";
      yield* this.records.save(e);
      return revision ? ("explore" as const) : ("apply" as const);
    }.bind(this),
    domainEffect,
  );
  assertArchives = Effect.fn("Corrections.assertArchives")(
    function* (this: Corrections, e: Execution) {
      for (const round of e.rounds ?? [])
        if (round.archive_path) {
          if (
            !(
              !(yield* this.git.run(e.worktree_directory!, [
                "--literal-pathspecs",
                "diff",
                "--name-only",
                round.starting_head,
                "--",
                round.archive_path,
              ])) &&
              !(yield* this.git.run(e.worktree_directory!, [
                "--literal-pathspecs",
                "ls-files",
                "--others",
                "--exclude-standard",
                "--",
                round.archive_path,
              ]))
            )
          )
            return yield* new CrewError(
              "ARCHIVE_CHANGED",
              "Previous correction archives must remain immutable",
            );
        }
    }.bind(this),
    domainEffect,
  );
}
