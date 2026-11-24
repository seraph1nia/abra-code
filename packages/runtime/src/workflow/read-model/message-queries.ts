import { Effect } from "effect";
import { type IssueId, type MessageId, timestamp } from "@abracode/contracts/identities";
import {
  messageRequests,
  MessagesPageSchema,
  requiresResponse,
} from "@abracode/contracts/workflow/message-contracts";
import { CrewError, type Execution } from "../../domain.ts";
import { domainEffect } from "../../effect.ts";
import { type PromptAdmission, type Runtime } from "../../opencode/runtime.ts";
import { nativeActivity } from "../../visibility/supervision.ts";

export type MessageQueryDeps = {
  runtime: Runtime;
  get: (id: IssueId) => Effect.Effect<Execution, CrewError>;
};

export function queryMessages(deps: MessageQueryDeps, id: IssueId, offset = 0, limit = 20) {
  return domainEffect(
    Effect.gen(function* () {
      if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 50
      )
        return yield* new CrewError(
          "MESSAGE_PAGE",
          "Use a nonnegative offset and limit between 1 and 50",
        );
      const e = yield* deps.get(id);
      const messages = e.messages ?? [];
      const page = messages.slice(offset, offset + limit);
      const requests = messageRequests(page);
      const observations = new Map(
        yield* Effect.forEach(
          [...new Set(requests.map((m) => m.recipient_session_id))],
          (session) =>
            Effect.gen(function* () {
              const state = yield* deps.runtime.session(session).pipe(Effect.result);
              const admissions = yield* deps.runtime
                .promptAdmissions(
                  session,
                  requests
                    .filter((m) => m.recipient_session_id === session)
                    .flatMap((m) => [
                      { prompt_id: m.prompt_id, prompt: m.prompt },
                      ...(m.response_recovery
                        ? [
                            {
                              prompt_id: m.response_recovery.prompt_id,
                              prompt: m.response_recovery.prompt,
                            },
                          ]
                        : []),
                    ]),
                )
                .pipe(Effect.orElseSucceed(() => new Map<MessageId, PromptAdmission>()));
              return [
                session,
                { state: state._tag === "Success" ? state.success : undefined, admissions },
              ] as const;
            }),
          { concurrency: 4 },
        ),
      );
      const entries: Array<(typeof MessagesPageSchema.Type)["entries"][number]> = page.map(
        (record) => {
          if (record.type === "finding") return { record };
          const observation = observations.get(record.recipient_session_id)!;
          const activity = nativeActivity(observation.state, !observation.state);
          const decisionKey = record.source?.type === "decision" ? record.source.key : undefined;
          const escalation = e.attention?.findLast(
            (a) =>
              a.code === "message_pending" &&
              a.message_refs?.some((ref) => ref.request_id === record.request_id),
          );
          return {
            record,
            native: observation.admissions.get(record.prompt_id) ?? "unavailable",
            recovery_native: record.response_recovery
              ? (observation.admissions.get(record.response_recovery.prompt_id) ?? "unavailable")
              : undefined,
            native_state: activity === "unobserved" ? "unknown" : activity,
            native_outcome: observation.state?.outcome,
            escalation: escalation
              ? {
                  id: escalation.id,
                  status: escalation.status,
                  evidence: escalation.evidence,
                  disposition: escalation.disposition,
                }
              : undefined,
            decision: decisionKey
              ? e.decisions?.find(
                  (d) => d.key === decisionKey && d.generation === record.generation,
                )
              : undefined,
          };
        },
      );
      return {
        entries,
        total: messages.length,
        outstanding: messageRequests(messages).filter(requiresResponse).length,
        offset,
        limit,
        next_offset: offset + limit < messages.length ? offset + limit : undefined,
        observed_at: yield* timestamp,
      };
    }),
  );
}
