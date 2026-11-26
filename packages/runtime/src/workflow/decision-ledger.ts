import { Clock, Effect } from "effect";
import type { Fingerprint, FormId, ObligationKey, SessionId } from "@abracode/contracts/identities";
import { ensure, type Execution } from "../domain.ts";
import { type Records } from "../storage/store.ts";
import type { Runtime } from "../opencode/runtime.ts";
import type { FinishingTarget } from "./finishing/contracts.ts";
import type { Decision } from "./obligation-contracts.ts";

export const MAX_DECISIONS = 256;

export function assertDecisionCapacity(
  decisions: readonly Decision[] | undefined,
  message = "Decision history is full",
): void {
  ensure((decisions?.length ?? 0) < MAX_DECISIONS, "DECISION_LIMIT", message);
}

export function appendDecision(
  decisions: readonly Decision[] | undefined,
  decision: Decision,
  limitMessage?: string,
): Decision[] {
  assertDecisionCapacity(decisions, limitMessage);
  return [...(decisions ?? []), decision];
}

export function makeControllerDecision(input: {
  readonly key: ObligationKey;
  readonly generation: number;
  readonly scope: string;
  readonly question: string;
  readonly openedAt: number;
  readonly finishingTarget?: FinishingTarget;
}): Decision {
  return {
    schema_version: 1,
    key: input.key,
    generation: input.generation,
    scope: input.scope,
    question: input.question.slice(0, 8192),
    owner: "user",
    session_id: "controller",
    opened_at: input.openedAt,
    status: "open",
    ...(input.finishingTarget ? { finishing_target: input.finishingTarget } : {}),
  };
}

/** Open an idempotent controller-owned user decision under operation ownership. */
export const openControllerDecision = (
  records: Records,
  e: Execution,
  input: {
    readonly key: ObligationKey;
    readonly question: string;
    readonly scope?: string;
    readonly matchAnyGeneration?: boolean;
    readonly staleMessage: string;
    readonly limitMessage?: string;
  },
) =>
  Effect.gen(function* () {
    const at = yield* Clock.currentTimeMillis;
    const saved = yield* records.update(e.issue_id, (current) => {
      ensure(
        current.control_generation === e.control_generation &&
          current.operation?.id === e.operation?.id,
        "STALE_OPERATION",
        input.staleMessage,
      );
      if (
        current.decisions?.some(
          (d) =>
            d.key === input.key &&
            (input.matchAnyGeneration || d.generation === current.control_generation),
        )
      )
        return;
      return {
        ...current,
        decisions: appendDecision(
          current.decisions,
          makeControllerDecision({
            key: input.key,
            generation: current.control_generation,
            scope: input.scope ?? current.workflow_policy,
            question: input.question,
            openedAt: at,
          }),
          input.limitMessage,
        ),
      };
    });
    return { execution: saved, key: input.key };
  });

/** Request a native approval form and read its current decision state. */
export const collectApprovalForm = (
  runtime: Pick<Runtime, "requestApproval" | "approval">,
  session: SessionId,
  form: FormId,
  prompt: string,
  fingerprint: Fingerprint,
) =>
  runtime
    .requestApproval(session, form, prompt, fingerprint)
    .pipe(Effect.andThen(runtime.approval(session, form)));
