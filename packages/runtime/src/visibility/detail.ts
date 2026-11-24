import { Clock, Effect } from "effect";
import { type IssueId } from "@abracode/contracts/identities";
import { type CrewError, identifier } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { diagnosticText } from "../opencode/diagnostics.ts";
import { type Queries } from "../workflow/queries.ts";
import { changeDocument } from "./documents.ts";
import { bindRetainedWork, retainedOverviewBlockers, retainedWork } from "./projections.ts";
import { type WorkDetail, type WorkItem } from "./protocol.ts";

export function observeOverview(queries: Queries, issueID: IssueId) {
  return domainEffect(
    Effect.gen(function* () {
      identifier(issueID);
      const task = yield* queries.observeTask(issueID);
      const { issue, execution: e } = task;
      const blocker_details = retainedOverviewBlockers(task);
      const work: WorkItem = {
        ...bindRetainedWork(
          retainedWork(
            queries.settings.supervisionMode,
            issue,
            e,
            {
              eligible: false,
              eligibility_observed: issue.status === "closed" ? undefined : false,
              blockers: blocker_details.map((blocker) => blocker.message),
              blocker_details,
            },
            task.closed_at,
          ),
          e,
          issue,
          yield* Clock.currentTimeMillis,
        ),
        supervision: task.execution_unavailable
          ? {
              primary: "recovery_required",
              native_activity: "unavailable",
              observed_at: task.source.captured_at,
            }
          : yield* queries.supervision(e, blocker_details, issue.status === "closed"),
        ...(task.execution_unavailable
          ? { phase: "recovery_required" as const, error: task.execution_unavailable }
          : {}),
      };
      return {
        execution: e,
        overview: {
          work,
          description: issue.description ?? "",
          ...(issue.thought_source && { thought_source: issue.thought_source }),
          errors: task.execution_unavailable ? [task.execution_unavailable] : [],
        },
      };
    }),
  );
}

export function buildDetail(
  queries: Queries,
  issueID: IssueId,
): Effect.Effect<WorkDetail, CrewError> {
  return domainEffect(
    Effect.gen(function* () {
      const { execution: e, overview } = yield* observeOverview(queries, issueID);
      const result: {
        -readonly [K in keyof WorkDetail]: WorkDetail[K];
      } & {
        errors: string[];
      } = {
        ...overview,
        change: e?.openspec_change,
        archive: e?.archive_path,
        artifacts: [],
      };
      if (e && e.workflow_policy !== "full-openspec") {
        result.change = undefined;
        result.proposal = e.scope
          ? `# ${e.workflow_policy === "research-only" ? "Research contract" : "Lightweight scope"}\n\n${e.scope.contract.goal}\n\n## Acceptance\n${e.scope.contract.acceptance.map((s) => `- ${s}`).join("\n")}\n\n## Constraints\n${e.scope.contract.constraints.map((s) => `- ${s}`).join("\n")}`
          : "Scope clarification required. Inspect the retained decision or revise with abra_work_scope.";
        return result;
      }
      if (!e) return result;
      if (e.archive_path || e.current_phase === "completed") {
        const archive = yield* queries.planDocuments(e).pipe(Effect.result);
        if (archive._tag === "Failure") result.errors.push(diagnosticText(archive.failure.message));
        else {
          result.documents = archive.success.paths;
          result.planning = archive.success.observation;
        }
        return result;
      }
      if (!e.worktree_directory) return result;
      const { statusPart, applyPart, documentsPart } = yield* Effect.all(
        {
          statusPart: domainEffect(
            Effect.gen(function* () {
              const status = yield* queries.specStatus(e);
              const artifacts = status.artifacts.map((a) => ({
                id: a.id,
                status: a.status,
                path: a.outputPath,
              }));
              const artifact = status.artifacts.find(
                (a) => a.id === "proposal" && a.status === "done",
              );
              let proposal: string | undefined;
              const errors: string[] = [];
              if (artifact) {
                proposal = yield* changeDocument(e, artifact.outputPath, "Proposal").pipe(
                  Effect.catch((error) =>
                    Effect.sync(() => {
                      errors.push(diagnosticText(error.message));
                      return undefined;
                    }),
                  ),
                );
              }
              return { artifacts, proposal, errors };
            }),
          ).pipe(
            Effect.catch((error) =>
              Effect.succeed({
                artifacts: undefined,
                proposal: undefined,
                errors: [diagnosticText(error.message)],
              }),
            ),
          ),
          applyPart: queries.specApply(e).pipe(
            Effect.map((apply) => ({
              progress: apply.taskTrackingConfigured ? apply.progress : undefined,
              error: undefined as string | undefined,
            })),
            Effect.catch((error) =>
              Effect.succeed({
                progress: undefined,
                error: diagnosticText(error.message),
              }),
            ),
          ),
          documentsPart: queries.planDocuments(e).pipe(Effect.result),
        },
        { concurrency: "unbounded" },
      );
      if (statusPart.artifacts) result.artifacts = statusPart.artifacts;
      if (statusPart.proposal !== undefined) result.proposal = statusPart.proposal;
      result.errors.push(...statusPart.errors);
      if (applyPart.progress !== undefined) result.progress = applyPart.progress;
      if (applyPart.error) result.errors.push(applyPart.error);
      if (documentsPart._tag === "Failure")
        result.errors.push(diagnosticText(documentsPart.failure.message));
      else {
        result.documents = documentsPart.success.paths;
        result.planning = documentsPart.success.observation;
      }
      return result;
    }),
  );
}
