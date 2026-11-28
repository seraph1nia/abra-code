import { proposalReviewView } from "./proposal-review.ts";
import { planSteps } from "../openspec/plan-steps.ts";
import { tryDomainValue } from "../effect.ts";
import { Clock, Effect } from "effect";
import { type IssueId } from "@abracode/contracts/identities";
import { type CrewError, identifier } from "../domain.ts";
import { diagnosticText } from "../opencode/diagnostics.ts";
import { type Queries } from "../workflow/queries.ts";
import { changeDocument } from "../workflow/read-model/documents.ts";
import { bindRetainedWork, retainedOverviewBlockers, retainedWork } from "./projections.ts";
import { type WorkDetail, type WorkItem } from "./protocol.ts";

export function observeOverview(queries: Queries, issueID: IssueId) {
  return Effect.gen(function* () {
    yield* tryDomainValue(identifier, issueID);
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
    const research =
      e?.report_intent &&
      e.report_receipt?.hash === e.report_intent.receipt.hash &&
      e.report_receipt.scope_fingerprint === e.scope?.fingerprint
        ? e.report_intent.evidence
        : undefined;
    const current = e?.delivered_commit;
    const publication = e?.finishing?.publication;
    const destination = publication?.commit === current ? publication?.destination : undefined;
    const previous =
      destination && destination.kind !== "initial"
        ? destination.predecessor
        : e?.rounds?.findLast(
            (round) => round.prior_delivered_commit && round.prior_delivered_commit !== current,
          )?.prior_delivered_commit;
    const repository = e?.pull_request_reference?.match(
      /^(https:\/\/github\.com\/[\w.-]+\/[\w.-]+)\/pull\/\d+\/?$/i,
    )?.[1];
    return {
      execution: e,
      overview: {
        work,
        description: issue.description ?? "",
        intent: {
          goal:
            e?.scope?.contract.goal || e?.intent?.description || issue.description || issue.title,
          criteria: e?.scope?.contract.acceptance ?? [],
          ...(research && { results: research.acceptance, limitations: research.limitations }),
          comparison:
            previous && current && previous !== current
              ? {
                  previous,
                  current,
                  url: repository && repository + "/compare/" + previous + "..." + current,
                }
              : undefined,
        },
        ...(issue.thought_source && { thought_source: issue.thought_source }),
        errors: task.execution_unavailable ? [task.execution_unavailable] : [],
      },
    };
  });
}

export function buildDetail(
  queries: Queries,
  issueID: IssueId,
): Effect.Effect<WorkDetail, CrewError> {
  return Effect.gen(function* () {
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
      ...(e?.proposal_reviews && {
        proposal_reviews: e.proposal_reviews.map((r) => proposalReviewView(e, r)),
      }),
      ...(e?.plan_brief &&
        e.plan_brief.fingerprint === e.plan_fingerprint && { plan_brief: e.plan_brief }),
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
        const proposal = archive.success.paths.find((path) => path === "proposal.md");
        if (proposal) {
          const doc = yield* archive.success.read(proposal).pipe(Effect.result);
          if (doc._tag === "Success") result.proposal = doc.success;
          else result.errors.push(diagnosticText(doc.failure.message));
        }
        const retained = e.retained_steps;
        if (
          retained &&
          retained.change === e.openspec_change &&
          retained.fingerprint === e.plan_fingerprint
        )
          result.steps = retained.steps;
        else result.errors.push("Historical checklist unavailable for this revision.");
        result.documents = archive.success.paths;
        result.planning = archive.success.observation;
      }
      return result;
    }
    if (!e.worktree_directory) return result;
    const { statusPart, applyPart, documentsPart } = yield* Effect.all(
      {
        statusPart: Effect.gen(function* () {
          const status = yield* queries.specStatus(e);
          const artifacts = status.artifacts.map((a) => ({
            id: a.id,
            status: a.status,
            path: a.outputPath,
          }));
          const artifact = status.artifacts.find((a) => a.id === "proposal" && a.status === "done");
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
        }).pipe(
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
            steps: apply.taskTrackingConfigured ? planSteps(e, apply) : undefined,
            progress: apply.taskTrackingConfigured ? apply.progress : undefined,
            error: undefined as string | undefined,
          })),
          Effect.catch((error) =>
            Effect.succeed({
              steps: undefined,
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
    result.steps = applyPart.steps;
    if (applyPart.progress !== undefined) result.progress = applyPart.progress;
    if (applyPart.error) result.errors.push(applyPart.error);
    if (documentsPart._tag === "Failure")
      result.errors.push(diagnosticText(documentsPart.failure.message));
    else {
      result.documents = documentsPart.success.paths;
      result.planning = documentsPart.success.observation;
    }
    return result;
  });
}
