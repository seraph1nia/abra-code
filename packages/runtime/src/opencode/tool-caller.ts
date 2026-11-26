import { NativeAccessError } from "../errors.ts";
import { Effect } from "effect";
import type { Context } from "@opencode/plugin/effect/plugin";
import type { Tool } from "@opencode/schema/tool";
import { type CrewError, type Execution } from "../domain.ts";
import type { SessionId, MessageId } from "@abracode/contracts/identities";
import { isActiveWorker } from "../workflow/worker-assignment.ts";
import type { WorkerContext } from "../workflow/worker-context-contracts.ts";
import { requireOwnedPromptEffect } from "./guards.ts";

import { nativeSession } from "./native-call.ts";

export const originatingUserMessage = (ctx: Context, session: SessionId, message: MessageId) =>
  Effect.gen(function* () {
    const messages = yield* nativeSession(ctx).context({ sessionID: session });
    const index = messages.findIndex((m) => m.id === message);
    return messages.slice(0, index + 1).findLast((m) => m.type === "user");
  });

export const verifiedWorkerCaller = (
  assignment: Execution,
  call: Pick<Tool.Context, "sessionID" | "agent">,
  capture: Effect.Effect<WorkerContext, CrewError>,
  origin: Effect.Effect<MessageId | undefined, CrewError>,
) =>
  Effect.gen(function* () {
    const role = assignment.active_role;
    if (!role || !isActiveWorker(assignment, call.sessionID, { role }))
      return yield* new NativeAccessError(
        "WORKER_CALLER",
        "Current eligible worker assignment required",
      );
    const context = yield* capture;
    if (
      context.schema_version !== 2 ||
      context.session_id !== call.sessionID ||
      context.environment.agent !== call.agent ||
      context.generation !== assignment.control_generation ||
      context.prompt_id !== assignment.prompt_id ||
      context.role !== role
    )
      return yield* new NativeAccessError(
        "WORKER_CALLER",
        "Tool call does not match the current worker capture",
      );
    const prompt = yield* origin;
    if (!prompt)
      return yield* new NativeAccessError(
        "WORKER_CALLER",
        "Tool call lacks current assignment provenance",
      );
    yield* requireOwnedPromptEffect(assignment, call.sessionID, prompt).pipe(
      Effect.mapError(
        () => new NativeAccessError("WORKER_CALLER", "Tool call belongs to a stale assignment"),
      ),
    );
    return { role, profile: context.prepared.profile };
  });
