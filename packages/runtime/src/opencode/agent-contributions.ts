import { Effect } from "effect";
import { Tool } from "@opencode/schema/tool";
import type { ToolAuthorization } from "@abracode/agents";
import { contributionAllows } from "@abracode/agents/policy";
import type { CrewError, Execution } from "../domain.ts";
import type { SessionId, MessageId } from "@abracode/contracts/identities";
import type { Store } from "../storage/store.ts";
import { readWorkerContext } from "../workflow/worker-context.ts";
import { assertVerifiedWorker } from "./session-authority.ts";

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
    if (!e?.worker_context_id)
      return yield* new Tool.Error({ message: "Current eligible worker assignment required" });
    const { role, profile } = yield* assertVerifiedWorker(
      e,
      native,
      readWorkerContext(store, e.worker_context_id),
      origin(native.sessionID, native.messageID),
    ).pipe(Effect.mapError((error) => new Tool.Error({ message: error.message })));
    if (
      !contributionAllows(profile, role, tool.id) ||
      !profile.contributions.some(
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
  });
