import { Effect } from "effect";
import {
  DiagramVerifyInputSchema,
  DiagramVerificationSchema,
} from "@abracode/contracts/presentation/diagrams";
import type { Controller } from "../workflow/controller.ts";
import { prepareDiagrams } from "../reporting/diagrams.ts";
import { defineTool } from "./tool-definition.ts";
import { authorizeHybridPrincipal } from "./session-authority.ts";

export function mermaidVerifierTool(controller: Controller, central: boolean) {
  return defineTool({
    name: "mermaid_verify",
    description:
      "Parse, render and safety-check identified literal Mermaid sources (up to 32, 32 KiB each, 256 KiB total). Diagnostic only: does not verify facts/readability, publish reports or approve work. No paths/configuration/remote resources. Returns bounded per-diagram diagnostics.",
    access: "supervisor_or_worker",
    diagnostic: true,
    input: DiagramVerifyInputSchema,
    output: DiagramVerificationSchema,
    run: (input, session, call) =>
      Effect.gen(function* () {
        yield* authorizeHybridPrincipal(
          controller,
          central,
          call,
          "abra_mermaid_verify",
          controller.queries.promptOrigin(session, call.messageID),
          {
            code: "DIAGRAM_ROLE",
            message: "Use central Abra or a current managed diagram-verifier role",
          },
        );
        const { assets: _, ...diagnostic } = yield* prepareDiagrams(input.diagrams);
        return diagnostic;
      }),
  });
}
