import { Effect, Schema } from "effect";
import {
  MemoryBody,
  MemoryPage,
  MemoryPublication,
  ScopedMemoryRead,
  MemoryReference,
  ScopedMemorySearch,
} from "@abracode/contracts/visibility/memory";
import { thoughtSubmissionMarker, selectionMarker } from "@abracode/contracts/web/workspace-wire";
import type { Context } from "@opencode/plugin/effect/plugin";
import type { Tool } from "@opencode/schema/tool";
import { RequestId, RepositoryId } from "@abracode/contracts/identities";
import { hash } from "../memory/collections.ts";
import { CrewError } from "../domain.ts";
import type { Controller } from "../workflow/controller.ts";
import { originatingUserMessage } from "./tool-caller.ts";
import { workerToolAllowed } from "./role-policy.ts";
import { assertSupervisor, assertVerifiedWorker } from "./session-authority.ts";
import { defineTool } from "./tool-definition.ts";

const forbidden = () => new CrewError("MEMORY_SCOPE", "Current authorized memory scope required.");
export function memoryTools(ctx: Context, c: Controller, central: boolean) {
  const origin = (call: Tool.Context) =>
    originatingUserMessage(ctx, call.sessionID, call.messageID);
  const supervisor = (call: Tool.Context) =>
    assertSupervisor(c, call.sessionID, {
      central,
      agent: call.agent,
      verifyNative: true,
      requireSupervisorMetadata: true,
      checkNotWorker: false,
      code: "MEMORY_SCOPE",
      message: "Current authorized memory scope required.",
    });
  const scope = (call: Tool.Context, tool: string, repo?: RepositoryId) =>
    Effect.gen(function* () {
      const session = call.sessionID;
      const assignment = yield* c.queries.assignment(session);
      if (!assignment) {
        yield* supervisor(call);
        yield* c.guardAttention(session, call.messageID, true);
        return repo;
      }
      const native = yield* c.queries.session(session);
      if (
        repo !== undefined ||
        !assignment.configuration_snapshot?.memory_reads ||
        native.directory !== assignment.worktree_directory ||
        call.agent !== native.agent
      )
        return yield* forbidden();
      const { role, profile } = yield* assertVerifiedWorker(
        assignment,
        call,
        c.queries.capturedWorkerPrompt(assignment),
        origin(call).pipe(Effect.map((user) => user?.id)),
        { code: "MEMORY_SCOPE", message: "Current authorized memory scope required." },
      );
      if (!workerToolAllowed(role, profile, tool)) return yield* forbidden();
      return assignment.repository_id;
    });
  return [
    defineTool({
      name: "memory_search",
      worker: true,
      diagnostic: true,
      description:
        "Find scoped, advisory Markdown. Workers omit repository_id. Abra selects a registered repository or omits it for shared alone. Continue with the same query and cursor.",
      input: ScopedMemorySearch,
      output: MemoryPage,
      run: (a, _s, call) =>
        scope(call, "abra_memory_search", a.repository_id).pipe(
          Effect.flatMap((repo) => c.memory.search(repo, a)),
        ),
    }),
    defineTool({
      name: "memory_read",
      worker: true,
      diagnostic: true,
      description:
        "Open a scoped memory citation at its exact revision. Workers omit repository_id. Cite the revision and verify advice against current evidence.",
      input: ScopedMemoryRead,
      output: MemoryBody,
      run: (a, _s, call) =>
        scope(call, "abra_memory_read", a.repository_id).pipe(
          Effect.flatMap((repo) => c.memory.read(repo, a)),
        ),
    }),
    defineTool({
      name: "memory_publish",
      description:
        "Save the operator's exact Remember for directive. For a correction the directive names the prior path and revision. Load abra-memory for syntax.",
      input: Schema.Struct({
        destination: MemoryPublication.fields.destination,
        source: MemoryPublication.fields.source,
        content: MemoryPublication.fields.content,
        corrects: MemoryPublication.fields.corrects,
      }),
      output: MemoryReference,
      run: (a, session, call) =>
        Effect.gen(function* () {
          yield* supervisor(call);
          const user = yield* origin(call);
          const dest =
            a.destination.kind === "shared"
              ? "all projects"
              : "repository " + a.destination.repository_id;
          const instruction = a.corrects
            ? `Correct ${a.corrects.path}@${a.corrects.revision} for ${dest}`
            : `Remember${a.source.kind === "verified-procedure" ? " verified procedure" : ""} for ${dest}`;
          const text = user?.text.split(selectionMarker)[0].split(thoughtSubmissionMarker)[0];
          if (!user || text !== instruction + ": " + a.content)
            return yield* new CrewError(
              "MEMORY_DIRECTION",
              "The current user message must explicitly name the destination and exact wording. Load abra-memory for examples.",
            );
          return yield* c.memory.publish({
            ...a,
            request_id: RequestId.make("turn-" + hash(session + "\n" + user.id)),
          });
        }),
    }),
  ];
}
