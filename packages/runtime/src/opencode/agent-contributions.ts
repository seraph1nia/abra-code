import { Effect } from "effect";
import { Tool } from "@opencode/schema/tool";
import type { ToolAuthorization } from "@abracode/agents";
import { contributionAllows } from "@abracode/agents/policy";
import type { CrewError, Execution } from "../domain.ts";
import type { SessionId, MessageId } from "../identities.ts";
import type { Store } from "../storage/store.ts";
import { isActiveWorker } from "../workflow/worker-assignment.ts";
import { readWorkerContext } from "../workflow/worker-context.ts";
import { requireOwnedPrompt } from "./guards.ts";

/** Handler authorization is independent of visibility and native permission shaping. */
export const contributionAuthorization = (
  assignment: (session: SessionId) => Effect.Effect<Execution | undefined, CrewError>,
  store: Store,
  origin: (
    session: SessionId,
    message: MessageId,
  ) => Effect.Effect<MessageId | undefined, CrewError>,
): ToolAuthorization =>
  Effect.fn("AgentContributions.authorize")(function* (tool, native) {
    const e = yield* assignment(native.sessionID).pipe(
      Effect.mapError(() => new Tool.Error({ message: "Contribution assignment unavailable" })),
    );
    const role = e?.active_role;
    if (
      !e ||
      !role ||
      !e.worker_context_id ||
      !isActiveWorker(e, native.sessionID, { role, generation: e.control_generation })
    )
      return yield* new Tool.Error({ message: "Current eligible worker assignment required" });
    const context = yield* readWorkerContext(store, e.worker_context_id).pipe(
      Effect.mapError(() => new Tool.Error({ message: "Contribution capture unavailable" })),
    );
    if (
      context.schema_version !== 2 ||
      context.session_id !== native.sessionID ||
      context.environment.agent !== native.agent ||
      context.generation !== e.control_generation ||
      context.prompt_id !== e.prompt_id ||
      context.role !== role ||
      !contributionAllows(context.prepared.profile, role, tool.id) ||
      !context.prepared.profile.contributions.some(
        (t) =>
          t.id === tool.id &&
          t.revision === tool.revision &&
          t.action === tool.action &&
          t.schema_digest === tool.schema_digest,
      )
    )
      return yield* new Tool.Error({
        message: "Contribution is not captured for the current assignment",
      });
    const prompt = yield* origin(native.sessionID, native.messageID).pipe(
      Effect.mapError(
        () => new Tool.Error({ message: "Contribution call provenance unavailable" }),
      ),
    );
    if (!prompt)
      return yield* new Tool.Error({
        message: "Contribution call lacks current assignment provenance",
      });
    yield* Effect.try({
      try: () => requireOwnedPrompt(e, native.sessionID, prompt),
      catch: () => new Tool.Error({ message: "Contribution call belongs to a stale assignment" }),
    });
  });
