import { Git } from "../git/repository.ts";
import { ProcessRunner } from "../process.ts";
import { fullPlanFingerprint } from "../workflow/planning.ts";
import { createHash } from "node:crypto";
import { Effect } from "effect";
import type { Queries } from "../workflow/queries.ts";
import type { SessionId } from "../identities.ts";
/** Read-only current bindings. Human answers still enter the native form reply path. */
export const observeCheckpoint = (
  queries: Pick<Queries, "executions">,
  session_id: SessionId,
  form_id: string,
) =>
  Effect.gen(function* () {
    for (const e of yield* queries.executions()) {
      const approval = e.approval_receipts.find(
        (a) => a.session_id === session_id && a.form_id === form_id,
      );
      if (approval) {
        let active =
          !approval.rejected_at &&
          !approval.authorized_at &&
          e.current_phase ===
            (approval.kind === "plan" ? "awaiting_plan_approval" : "awaiting_merge") &&
          approval.fingerprint ===
            (approval.kind === "plan" ? e.plan_fingerprint : e.delivered_commit);
        if (active && approval.kind === "plan" && e.workflow_policy === "full-openspec") {
          const observed = yield* fullPlanFingerprint(new Git(new ProcessRunner()), e).pipe(
            Effect.result,
          );
          active = observed._tag === "Success" && observed.success === approval.fingerprint;
        }
        return {
          active,
          issue_id: e.issue_id,
          kind: approval.kind,
          fingerprint: approval.fingerprint,
          generation: e.control_generation,
        };
      }
      const decision = e.decisions?.find(
        (d) => d.form_session === session_id && d.form_id === form_id,
      );
      if (decision)
        return {
          active: decision.status === "open" && decision.generation === e.control_generation,
          issue_id: e.issue_id,
          kind: "decision" as const,
          identity: `${e.issue_id}:${decision.generation}:${decision.key}`,
          generation: e.control_generation,
          ...(decision.finishing_target
            ? {
                finishing_target: createHash("sha256")
                  .update(JSON.stringify(decision.finishing_target))
                  .digest("hex"),
              }
            : {}),
        };
    }
    return { active: false };
  });
