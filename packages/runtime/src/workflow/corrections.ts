import { sha256 } from "../digest.ts";
import { WorkflowError } from "../errors.ts";
import { tryDomainValue } from "../effect.ts";
import { externalOwns } from "@abracode/contracts/validation/contracts";
import { ObligationKey, RoundId, FindingId, ChangeName } from "@abracode/contracts/identities";
import { Clock, Effect } from "effect";
import { type Execution, type Config } from "../domain.ts";
import { type Records } from "../storage/store.ts";
import { type Git } from "../git/repository.ts";
import { type ScopeDispositionSchema } from "@abracode/contracts/workflow/correction-contracts";
import { openControllerDecision } from "./decision-ledger.ts";
import { assertTransition, resetDeliveryArtifactsPatch } from "./transitions.ts";

const hash = (text: string) => sha256(text);

export class Corrections {
  constructor(
    private records: Records,
    private git: Git,
    private config: Config,
  ) {}
  decision = Effect.fn("Corrections.decision")(
    { self: this },
    function* (e: Execution, reason: string) {
      return yield* openControllerDecision(this.records, e, {
        key: ObligationKey.make(`correction-${hash(reason).slice(0, 32)}`),
        question: reason,
        staleMessage: "Correction decision was superseded",
      });
    },
  );
  prepare = Effect.fn("Corrections.prepare")(
    { self: this },
    function* (
      e: Execution,
      source: "check" | "review" | "forge" | "checkpoint",
      findings: readonly FindingId[],
      instructions: string,
      scope: typeof ScopeDispositionSchema.Type,
      resumeIssue = false,
    ) {
      if (externalOwns(e))
        return yield* new WorkflowError(
          "EXTERNAL_CUSTODY",
          "Return external branch custody before admitting a native writer or changing its scope",
        );
      if (e.workflow_policy === "research-only" || e.stop_status)
        return yield* new WorkflowError(
          "CORRECTION_POLICY",
          "Coding correction cannot resume paused/research work",
        );
      if (!e.plan_fingerprint)
        return yield* new WorkflowError(
          "CORRECTION_PLAN",
          "Approved planning identity is required",
        );
      const budget =
        this.config.supervision_mode === "manual" ? 0 : e.effective_policy.repair_rounds;
      const head = yield* this.git.head(e.worktree_directory!);
      const ids = [...new Set(findings)].sort();
      const duplicate = e.rounds?.some((r) => r.findings.some((id) => ids.includes(id)));
      if (scope !== "in_scope" || (e.rounds?.length ?? 0) >= budget || duplicate) {
        const decision = yield* this.decision(
          e,
          scope !== "in_scope"
            ? `Correction requires ${scope === "scope_change" ? "revised scope approval" : "clarification"}: ${instructions}`
            : duplicate
              ? `Repeated correction finding requires inspection: ${instructions}`
              : `Correction budget exhausted (${e.rounds?.length ?? 0}/${budget}): ${instructions}`,
        );
        return { execution: decision.execution, role: undefined };
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
      const revision = e.workflow_policy === "full-openspec" && postArchive;
      const nextPhase = revision ? ("planning" as const) : ("applying" as const);
      yield* tryDomainValue(assertTransition, e, nextPhase, "correction");
      e = yield* this.records.commitOwned(e, {
        ...resetDeliveryArtifactsPatch({
          clearDeliveryArtifacts: true,
          clearDeliveredCommit: true,
          clearPlanningArtifacts: revision,
        }),
        rounds: [...(e.rounds ?? []), round],
        retry_instructions: `Correction round ${ordinal}/${budget}: ${instructions}. Preserve accepted scope and all previous archived artifacts.`,
        ...(revision && {
          openspec_base_change: e.openspec_base_change ?? e.openspec_change,
          openspec_change: ChangeName.make(
            `${e.openspec_base_change ?? e.openspec_change}-r${ordinal}`,
          ),
          planning_base_commit: head,
        }),
        current_phase: nextPhase,
        ...(resumeIssue && { pending_issue_status: "in_progress" }),
      });
      return { execution: e, role: revision ? ("explore" as const) : ("apply" as const) };
    },
  );
  assertArchives = Effect.fn("Corrections.assertArchives")(
    { self: this },
    function* (e: Execution) {
      const archived = [
        ...(e.rounds ?? []),
        ...(e.finishing?.synchronization?.map((a) => ({
          archive_path: a.prior_archive,
          starting_head: a.head,
        })) ?? []),
      ].filter((round) => Boolean(round.archive_path));
      yield* Effect.forEach(
        archived,
        (round) =>
          Effect.all(
            [
              this.git.run(e.worktree_directory!, [
                "--literal-pathspecs",
                "diff",
                "--name-only",
                round.starting_head,
                "--",
                round.archive_path!,
              ]),
              this.git.run(e.worktree_directory!, [
                "--literal-pathspecs",
                "ls-files",
                "--others",
                "--exclude-standard",
                "--",
                round.archive_path!,
              ]),
            ],
            { concurrency: 2 },
          ).pipe(
            Effect.flatMap(([changed, untracked]) =>
              changed || untracked
                ? Effect.fail(
                    new WorkflowError(
                      "ARCHIVE_CHANGED",
                      "Previous correction archives must remain immutable",
                    ),
                  )
                : Effect.void,
            ),
          ),
        { concurrency: 4 },
      );
    },
  );
}
