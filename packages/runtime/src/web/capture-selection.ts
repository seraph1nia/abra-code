import { tryDomainValue } from "../effect.ts";
import { Effect } from "effect";
import { withinImage, type WorkSelection } from "@abracode/contracts/web/resources";
import { selectedDiffExcerpt } from "../workflow/read-model/ticket-diff.ts";
import { presentationHash } from "../presentation/identity.ts";
import type { Queries } from "../workflow/queries.ts";
import { CrewError } from "../domain.ts";

export function captureSelection(queries: Queries, selection: WorkSelection) {
  if (selection.kind === "region")
    return Effect.gen(function* () {
      const { receipt } = yield* queries
        .evidence(selection)
        .pipe(
          Effect.mapError(
            () =>
              new CrewError(
                "SELECTION_STALE",
                "This exact image is unavailable. Remove the selection or open retained evidence.",
              ),
          ),
        );
      if (receipt.kind !== "screenshot" || !withinImage(selection, receipt.width, receipt.height))
        return yield* new CrewError(
          "SELECTION_RANGE",
          "Select a region inside the original screenshot.",
        );
      return (
        receipt.description +
        " · " +
        receipt.width +
        "×" +
        receipt.height +
        " · selected " +
        selection.width +
        "×" +
        selection.height +
        " at (" +
        selection.x +
        ", " +
        selection.y +
        ")"
      );
    });
  return selection.kind === "plan"
    ? Effect.gen(function* () {
        const e = yield* queries.get(selection.issue_id);
        const content = yield* queries.planDocument(e, selection.file);
        if (
          selection.generation !== e.control_generation ||
          presentationHash(content) !== selection.hash
        )
          return yield* new CrewError(
            "SELECTION_STALE",
            "The selected plan changed. Review the updated document or remove the selection.",
          );
        const rows = content.split("\n");
        if (selection.end > rows.length)
          return yield* new CrewError(
            "SELECTION_RANGE",
            "Select lines in the owned plan document.",
          );
        const excerpt = rows.slice(selection.start - 1, selection.end).join("\n");
        if (excerpt.length > 8192)
          return yield* new CrewError("SELECTION_LIMIT", "Choose a shorter plan passage.");
        return excerpt;
      }).pipe(
        Effect.mapError((error) =>
          error.code.startsWith("SELECTION_")
            ? error
            : new CrewError(
                "SELECTION_STALE",
                "The selected plan is unavailable. Review the plan or remove the selection.",
              ),
        ),
      )
    : queries.diff(selection.issue_id, selection.scope, selection.file).pipe(
        Effect.mapError(
          () =>
            new CrewError(
              "SELECTION_STALE",
              "The selected diff is unavailable. Open the updated diff or remove the selection.",
            ),
        ),
        Effect.flatMap((diff) => tryDomainValue(selectedDiffExcerpt, diff, selection)),
      );
}
