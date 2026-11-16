import { isActiveWorker } from "../workflow/worker-assignment.ts";
import { Effect } from "effect";
import {
  DiagramVerifyInputSchema,
  DiagramVerificationSchema,
} from "@abracode/contracts/presentation/diagrams";
import type { Controller } from "../workflow/controller.ts";
import { prepareDiagrams } from "../workflow/diagrams.ts";
import { CrewError } from "../domain.ts";
import { defineTool } from "./tool-definition.ts";
import { roleFor } from "./guards.ts";
import { policyAllows } from "./role-policy.ts";

export function mermaidVerifierTool(controller: Controller, central: boolean) {
  return defineTool({
    name: "mermaid_verify",
    description:
      "Parse, render and safety-check identified literal Mermaid sources (up to 32, 32 KiB each, 256 KiB total). Diagnostic only: does not verify facts/readability, publish reports or approve work. No paths/configuration/remote resources. Returns bounded per-diagram diagnostics.",
    worker: true,
    diagnostic: true,
    input: DiagramVerifyInputSchema,
    output: DiagramVerificationSchema,
    run: (input, session, call) =>
      Effect.gen(function* () {
        const assignment = yield* controller.queries.assignment(session);
        const native = yield* controller.queries.session(session);
        if (assignment) {
          const role = roleFor(assignment, session);
          const captured = yield* controller.queries.capturedWorkerPrompt(assignment);
          if (
            !isActiveWorker(assignment, session, { role, generation: captured.generation }) ||
            captured.session_id !== session ||
            captured.role !== role ||
            !policyAllows(role, "abra_mermaid_verify") ||
            native.agent !== captured.environment.agent ||
            call.agent !== captured.environment.agent ||
            native.directory !== assignment.worktree_directory
          )
            return yield* new CrewError(
              "DIAGRAM_ROLE",
              "Current managed diagram-verifier role required",
            );
        } else {
          if (
            !central ||
            call.agent !== "abra" ||
            native.agent !== "abra" ||
            native.directory !== controller.queries.settings.home ||
            native.metadata?.abracode_supervisor_home !== controller.queries.settings.home
          )
            return yield* new CrewError(
              "ABRA_REQUIRED",
              "Use the central Abra or a current assigned worker",
            );
          yield* controller.guardAttention(session, call.messageID, true);
          yield* controller.recordSupervisor(session);
        }
        const { assets: _, ...diagnostic } = yield* prepareDiagrams(input.diagrams);
        return diagnostic;
      }),
  });
}
