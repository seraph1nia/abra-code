import { Duration, Effect } from "effect";
import type { MessageId, SessionId } from "@abracode/contracts/identities";
import type { CrewError } from "../domain.ts";
import type { Runtime } from "../opencode/runtime.ts";

export const INITIAL_BACKOFF_MS = Duration.toMillis(Duration.seconds(30));
export const MAX_BACKOFF_MS = Duration.toMillis(Duration.minutes(5));
export const MAX_OUTBOX_ATTEMPTS = 8;

/** Pure capped exponential backoff for a 1-based attempt count: 30s, 60s, 120s, 240s, 300s cap. */
export function backoffDelayMs(attempt: number): number {
  const exponent = Math.max(0, Math.min(attempt - 1, 4));
  return Math.min(MAX_BACKOFF_MS, INITIAL_BACKOFF_MS * 2 ** exponent);
}

export function nextAttemptCount(previous: number): number {
  return Math.min(previous + 1, MAX_OUTBOX_ATTEMPTS);
}

export function nextCheckAt(now: number, attempt: number): number {
  return now + backoffDelayMs(attempt);
}

/** Deliver one idempotent synthetic notification and persist its receipt after delivery. */
export const deliverSyntheticNotice = <T>(
  runtime: Pick<Runtime, "notify">,
  session: SessionId,
  body: string,
  noticeId: MessageId,
  markNotified: () => Effect.Effect<T, CrewError>,
) => runtime.notify(session, body, noticeId).pipe(Effect.andThen(markNotified()));
