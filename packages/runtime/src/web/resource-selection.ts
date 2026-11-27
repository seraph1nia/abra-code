import { retainedFinding } from "@abracode/contracts/workflow/feedback-contracts";
import { presentationHash } from "../presentation/identity.ts";
import { Effect, Schema } from "effect";
import { CrewError } from "../domain.ts";
import type { Queries } from "../workflow/queries.ts";
import { historicalWorkers } from "../workflow/worker-assignment.ts";
import { ResourceSelectionSchema } from "@abracode/contracts/web/resources";

/** Ownership is checked before transcript, document or artifact bytes are requested. */
export function resolveOwnedResource(
  queries: Pick<Queries, "issue" | "execution" | "planDocument" | "diff"> &
    Partial<Pick<Queries, "sessionAvailability">>,
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
    if (target.action === "open_changes" && target.head) {
      const diff = yield* queries.diff(target.issue_id, target.scope ?? "all", target.file);
      if (diff.head !== target.head || !diff.files.some((entry) => entry.path === target.file))
        return yield* new CrewError(
          "INVALID_SELECTION",
          "The selected file is unavailable at the reported revision",
        );
    }
    if (target.action === "open_task" && target.request) {
      const e = yield* queries.execution(target.issue_id);
      const offset = e?.messages?.findIndex(
        (record) => record.request_id === target.request?.request_id,
      );
      if (offset === undefined || offset < 0)
        return yield* new CrewError(
          "INVALID_SELECTION",
          "The retained task does not own this request",
        );
      return { ...target, request: { ...target.request, offset } };
    }
    if (target.action === "open_task" || target.action === "open_changes") return target;
    const execution = yield* queries.execution(target.issue_id);
    if (!execution)
      return yield* new CrewError(
        "RESOURCE_UNAVAILABLE",
        "No retained execution owns this selection",
      );
    let owned = false;
    switch (target.action) {
      case "open_finding":
        owned = !!retainedFinding(execution.feedback, target.finding_id, target.revision);
        break;
      case "open_passage": {
        if (target.generation !== execution.control_generation) break;
        const content = yield* queries.planDocument(execution, target.file);
        owned =
          presentationHash(content) === target.hash && target.end <= content.split("\n").length;
        break;
      }
      case "open_session":
        owned = [
          execution.explore_session_id,
          execution.apply_session_id,
          execution.review_session_id,
          execution.research_session_id,
          ...historicalWorkers(execution).map((session) => session.id),
        ].includes(target.session_id);
        if (owned && queries.sessionAvailability)
          owned =
            (yield* queries.sessionAvailability(execution, target.session_id)) !== "unavailable";

        break;
      case "open_decision":
        owned = !!execution.decisions?.some(
          (decision) => decision.key === target.key && decision.generation === target.generation,
        );
        break;
      case "open_artifact":
        owned = !!ownedArtifact(execution, target.request_id, target.hash);
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

export function ownedArtifact(
  execution: import("../domain.ts").Execution | undefined,
  request: string,
  hash: string,
) {
  return execution?.visual_reports?.find(
    (report) =>
      report.request.request_id === request &&
      report.status === "published" &&
      report.artifact?.hash === hash,
  );
}
