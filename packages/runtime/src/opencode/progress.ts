import { domainEffect } from "../effect.ts";
import { Context, Effect } from "effect";
/** Ephemeral tool feedback; durable command/worker progress remains controller evidence. */
export type ProgressUpdate = {
  readonly stage: "setup" | "verify" | "deliver" | "merge" | "cleanup";
  readonly status: "started" | "running" | "completed";
  readonly completed?: number;
  readonly total?: number;
  readonly stdout_bytes?: number;
  readonly stderr_bytes?: number;
};
export const ToolProgress = Context.Reference<(update: ProgressUpdate) => Effect.Effect<void>>(
  "abracode/ToolProgress",
  { defaultValue: () => () => Effect.void },
);
export const progress = (update: ProgressUpdate) =>
  Effect.flatMap(ToolProgress, (report) => Effect.suspend(() => report(update))).pipe(
    Effect.catchCauseIf(
      (cause) => !cause.reasons.some((reason) => reason._tag === "Interrupt"),
      () => Effect.logDebug("AbraCode tool progress unavailable"),
    ),
  );

export const completedProgress =
  (stage: ProgressUpdate["stage"]) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    domainEffect(effect).pipe(Effect.tap(() => progress({ stage, status: "completed" })));
