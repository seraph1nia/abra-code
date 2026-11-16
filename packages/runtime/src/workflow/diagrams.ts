import { Effect } from "effect";
import {
  DiagramPreparationSchema,
  collectDiagrams,
  type DiagramInput,
} from "@abracode/contracts/presentation/diagrams";
import { CrewError } from "../domain.ts";
import { decode } from "../decode.ts";
import type { ReportDocument } from "../presentation/report-document.ts";

/** No compiler or browser machinery is loaded until a diagram operation needs it. */
export const prepareDiagrams = (diagrams: readonly DiagramInput[]) =>
  Effect.tryPromise({
    try: () =>
      import("@abracode/report-export/preparation")
        .then(({ diagramPreparer }) => diagramPreparer.prepare(diagrams))
        .catch((cause: unknown) => {
          if (
            cause instanceof Error &&
            "code" in cause &&
            ["ERR_MODULE_NOT_FOUND", "MODULE_NOT_FOUND", "ENOENT"].includes(String(cause.code))
          )
            return {
              compiler: "unavailable",
              verified: false,
              assets: [],
              results: diagrams.map(({ id }) => ({
                id,
                status: "unavailable" as const,
                message: "Diagram compiler prerequisites are unavailable.",
              })),
            };
          throw cause;
        }),
    catch: CrewError.from,
  }).pipe(
    Effect.flatMap((value) => decode(DiagramPreparationSchema, value, "Prepared diagram batch")),
  );

export const verifyDiagrams = (diagrams: readonly DiagramInput[]) =>
  diagrams.length
    ? prepareDiagrams(diagrams).pipe(
        Effect.flatMap((prepared) =>
          prepared.verified
            ? Effect.void
            : Effect.fail(
                new CrewError(
                  "DIAGRAM_INVALID",
                  prepared.results
                    .filter((r) => r.status !== "verified")
                    .map((r) => `${r.id}: ${r.status}: ${r.message}`)
                    .join("\n")
                    .slice(0, 8192),
                ),
              ),
        ),
      )
    : Effect.void;

export const documentDiagrams = (document: ReportDocument) =>
  collectDiagrams(document.surface.createSurface.components, document.data.evidence);
