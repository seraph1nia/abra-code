import { Effect } from "effect";
import { Agent } from "@opencode/schema/agent";
import type { Context } from "@opencode/plugin/effect/plugin";
import { proposalReader, readerPermissions } from "@abracode/agents/proposal-reader";
import { nativeSession } from "./native-call.ts";
import { CrewError, type Execution, type WorkerModel } from "../domain.ts";
import { readerPrompt, type ReviewRevision } from "../workflow/proposal-review-contracts.ts";
import { sha256 } from "../digest.ts";

/** Native identity is reserved by the controller before creation or prompt submission. */
export const ensureProposalReader = Effect.fn("NativeRuntime.ensureProposalReader")(function* (
  ctx: Context,
  e: Execution,
  revision: ReviewRevision,
  model?: WorkerModel,
) {
  const sessions = nativeSession(ctx);
  const directory = e.worktree_directory!;
  const metadata = {
    issue: e.issue_id,
    execution: e.execution_id,
    revision: revision.fingerprint,
    prompt: revision.prompt,
    digest: sha256(readerPrompt(revision)),
  };
  const existing = yield* sessions.get({ sessionID: revision.session }).pipe(
    Effect.catchIf(
      (err) => err.code === "SESSION_NOT_FOUND",
      () => Effect.void,
    ),
  );
  const session =
    existing ??
    (yield* sessions.create({
      id: revision.session,
      location: { directory },
      title: "Independent proposal review",
      agent: Agent.ID.make(proposalReader),
      model,
      permissions: readerPermissions(),
      metadata: { proposal_reader: metadata },
    }));
  const binding = session.metadata?.proposal_reader;
  if (
    session.id !== revision.session ||
    session.agent !== proposalReader ||
    session.parentID ||
    session.location.directory !== directory ||
    !binding ||
    typeof binding !== "object" ||
    Object.entries(metadata).some(([key, value]) => Reflect.get(binding, key) !== value) ||
    JSON.stringify(session.permissions?.map((p) => [p.action, p.resource, p.effect])) !==
      JSON.stringify(readerPermissions().map((p) => [p.action, p.resource, p.effect]))
  )
    return yield* new CrewError("READER_IDENTITY", "Proposal reader identity changed");
});

export const readProposalReport = Effect.fn("NativeRuntime.readProposalReport")(function* (
  ctx: Context,
  revision: ReviewRevision,
) {
  const context = yield* nativeSession(ctx).context({ sessionID: revision.session });
  const users = context.filter((m) => m.type === "user");
  if (
    users.length !== 1 ||
    users[0]?.id !== revision.prompt ||
    users[0].text !== readerPrompt(revision)
  )
    return yield* new CrewError("READER_CONTEXT", "Cannot verify the reader's exact input");
  const assistant = context.findLast((m) => m.type === "assistant");
  return (
    assistant?.content
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("") ?? ""
  );
});
