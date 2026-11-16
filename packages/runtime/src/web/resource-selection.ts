import { Effect, Schema } from "effect";
import { CrewError } from "../domain.ts";
import type { Queries } from "../workflow/queries.ts";
import { historicalWorkers } from "../workflow/worker-assignment.ts";
import { ResourceSelectionSchema } from "./resources.ts";

/** Ownership is checked before transcript, document or artifact bytes are requested. */
export function resolveOwnedResource(
  queries: Pick<Queries, "issue" | "execution">,
  input: unknown,
) {
  return Effect.gen(function* () {
    const target = yield* Schema.decodeUnknownEffect(ResourceSelectionSchema, {
      onExcessProperty: "error",
      reportInput: false,
    })(input).pipe(
      Effect.mapError(() => new CrewError("INVALID_DATA", "Resource selection is invalid")),
    );
    yield* queries.issue(target.issue_id);
    if (target.action === "open_task" || target.action === "open_changes") return target;
    const execution = yield* queries.execution(target.issue_id);
    if (!execution)
      return yield* new CrewError(
        "RESOURCE_UNAVAILABLE",
        "No retained execution owns this selection",
      );
    let owned = false;
    switch (target.action) {
      case "open_session":
        owned = [
          execution.explore_session_id,
          execution.apply_session_id,
          execution.review_session_id,
          execution.research_session_id,
          ...historicalWorkers(execution).map((session) => session.id),
        ].includes(target.session_id);
        break;
      case "open_decision":
        owned = !!execution.decisions?.some(
          (decision) => decision.key === target.key && decision.generation === target.generation,
        );
        break;
      case "open_artifact":
        owned = !!execution.visual_reports?.some(
          (report) =>
            report.request.request_id === target.request_id &&
            report.status === "published" &&
            report.artifact?.hash === target.hash,
        );
        break;
    }
    if (!owned)
      return yield* new CrewError(
        "INVALID_SELECTION",
        "The retained task does not own this resource revision",
      );
    return target;
  });
}
