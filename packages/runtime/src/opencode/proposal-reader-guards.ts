import { toToolError } from "@abracode/agents/tool-boundary";
import { Effect } from "effect";
import { resolve, relative, dirname, isAbsolute, sep } from "node:path";
import type { Context } from "@opencode/plugin/effect/plugin";
import { proposalReader, readerInstructions } from "@abracode/agents/proposal-reader";
import type { Controller } from "../workflow/controller.ts";
import { currentReview, readerPrompt } from "../workflow/proposal-review-contracts.ts";
import { IssueId, type SessionId } from "@abracode/contracts/identities";
import { CrewError } from "../domain.ts";
import { realpath } from "../filesystem.ts";

export const readerSession = (session: string) => session.startsWith("ses_proposal_");
const denied = () =>
  new CrewError("READER_SCOPE", "The current controller-owned proposal assignment is required");
const assignment = Effect.fn("proposalReader.assignment")(function* (
  controller: Controller,
  session: SessionId,
) {
  const native = yield* controller.queries.sessionIdentity(session);
  const binding = native.metadata?.proposal_reader;
  if (
    native.agent !== proposalReader ||
    !binding ||
    typeof binding !== "object" ||
    !("issue" in binding) ||
    typeof binding.issue !== "string"
  )
    return yield* denied();
  const e = yield* controller.get(IssueId.make(binding.issue));
  const review = currentReview(e);
  if (
    !review ||
    review.session !== session ||
    review.status !== "pending" ||
    e.stop_status ||
    e.current_phase !== "awaiting_plan_approval" ||
    e.worktree_directory !== native.directory
  )
    return yield* denied();
  return { e, review };
});

export function installReaderGuards(
  ctx: Context,
  controller: Controller,
  provide: <A, E>(effect: Effect.Effect<A, E>) => Effect.Effect<A, E>,
) {
  return Effect.gen(function* () {
    yield* ctx.session.hook("prompt", (event) =>
      Effect.gen(function* () {
        if (!readerSession(event.sessionID)) return;
        const { review } = yield* assignment(controller, event.sessionID);
        if (
          event.messageID !== review.prompt ||
          event.prompt.text !== readerPrompt(review) ||
          event.delivery !== "queue" ||
          event.prompt.files?.length ||
          event.prompt.skills?.length ||
          event.prompt.agents?.length
        )
          return yield* denied();
      }).pipe(Effect.orDie, provide),
    );
    yield* ctx.session.hook("context", (event) =>
      Effect.gen(function* () {
        if (!readerSession(event.sessionID) && event.agent !== proposalReader) return;
        yield* assignment(controller, event.sessionID);
        if (event.agent !== proposalReader) return yield* denied();
        event.system.splice(0, event.system.length, { type: "text", text: readerInstructions });
        for (const tool of Object.keys(event.tools)) if (tool !== "read") delete event.tools[tool];
      }).pipe(Effect.orDie, provide),
    );
    yield* ctx.tool.hook("execute.before", (event) =>
      Effect.gen(function* () {
        if (!readerSession(event.sessionID) && event.agent !== proposalReader) return;
        const { e, review } = yield* assignment(controller, event.sessionID);
        if (
          event.agent !== proposalReader ||
          event.tool !== "read" ||
          !event.input ||
          typeof event.input !== "object"
        )
          return yield* denied();
        const path =
          "path" in event.input
            ? event.input.path
            : "filePath" in event.input
              ? event.input.filePath
              : undefined;
        if (typeof path !== "string") return yield* denied();
        const root = yield* realpath(e.worktree_directory!);
        const file = yield* realpath(resolve(root, path));
        const local = relative(root, file);
        if (!local || local === ".." || local.startsWith(".." + sep) || isAbsolute(local))
          return yield* denied();
        const proposalDir = resolve(
          root,
          "openspec/changes",
          e.openspec_change,
          dirname(review.path),
        );
        const cited = [...review.proposal.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)|`([^`\n]+)`/g)]
          .map((match) => match[1] ?? match[2]!)
          .some((ref) => resolve(proposalDir, ref) === file || resolve(root, ref) === file);
        if (!cited) return yield* denied();
      }).pipe(
        Effect.mapError((error) => toToolError(error.code, error.message)),
        provide,
      ),
    );
  });
}
