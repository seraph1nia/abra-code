import { GitError } from "../errors.ts";
import {
  type BranchName,
  type Commit,
  type Executable,
  type PullRequestUrl,
  type Timestamp,
} from "@abracode/contracts/identities";
import { type Feedback } from "@abracode/contracts/workflow/feedback-contracts";
import { Effect, Schema } from "effect";
import { CrewError, type ManagedExecution, type Project } from "../domain.ts";
import { type Runner } from "../process.ts";
import { type ForgeFindingSchema } from "@abracode/contracts/workflow/correction-contracts";
import { type OperationResult } from "./operation-result.ts";
import { type PRActionAdapter } from "./action-contracts.ts";
import { GitHubFeedback } from "./feedback.ts";
import { Forge, PRSchema, type PR } from "./forge.ts";
import { assessPR, deliveryEvidence, mergePR, type DeliveryAssessment } from "./merge.ts";
import { GitHubPRActions } from "./pr-actions.ts";
import { deliverPublication, provisionalPublication, type Publication } from "./publish.ts";
import { GitHubReadiness } from "./readiness.ts";
import { type Git } from "./repository.ts";
import { GitHubReviewers, type ReviewerSuggestions } from "./reviewers.ts";

export { PRSchema, type PR } from "./forge.ts";
export { type DeliveryAssessment } from "./merge.ts";
export { assertOwnedPR, matchesOwnedPR, type OwnedPRCheck, type Publication } from "./publish.ts";

export interface Delivery {
  assessment?(p: Project, e: ManagedExecution): Effect.Effect<DeliveryAssessment, CrewError>;
  provisional?(
    p: Project,
    e: ManagedExecution,
  ): Effect.Effect<{ commit: Commit; pr?: PullRequestUrl }, CrewError>;
  readonly actions?: PRActionAdapter;
  reviewers?(
    p: Project,
    e: ManagedExecution,
  ): Effect.Effect<typeof ReviewerSuggestions.Type, CrewError>;
  feedback?(p: Project, e: ManagedExecution): Effect.Effect<Feedback, CrewError>;
  findings?(
    p: Project,
    e: ManagedExecution,
  ): Effect.Effect<(typeof ForgeFindingSchema.Type)[], CrewError>;
  deliver(
    p: Project,
    e: ManagedExecution,
    publication: Publication,
  ): Effect.Effect<
    {
      commit: Commit;
      pr?: PullRequestUrl;
    },
    CrewError
  >;
  inspect(p: Project, e: ManagedExecution): Effect.Effect<PR | undefined, CrewError>;
  merge(
    p: Project,
    e: ManagedExecution,
    assessment?: DeliveryAssessment,
    beforeSubmit?: () => Effect.Effect<void, CrewError>,
  ): Effect.Effect<OperationResult, CrewError>;
  evidence(
    p: Project,
    e: ManagedExecution,
  ): Effect.Effect<
    {
      commit: Commit;
      target: BranchName;
      at: Timestamp;
    },
    CrewError
  >;
}

const PRListSchema = Schema.Array(PRSchema);

export class GitHubDelivery implements Delivery {
  private readonly client: Forge;
  private readonly reviewerAdapter: GitHubReviewers;
  private readonly readinessAdapter: GitHubReadiness;
  private readonly feedbackAdapter: GitHubFeedback;
  readonly actions: GitHubPRActions;

  constructor(
    private readonly git: Git,
    runner: Runner,
    forge: Executable,
  ) {
    this.client = new Forge(runner, forge);
    this.reviewerAdapter = new GitHubReviewers(this.git, this.client);
    this.readinessAdapter = new GitHubReadiness(this.client);
    this.feedbackAdapter = new GitHubFeedback(this.client);
    this.actions = new GitHubPRActions(this.client, this.inspect);
  }

  reviewers = (p: Project, e: ManagedExecution) => this.reviewerAdapter.suggest(p, e);

  private call(p: Project, args: string[]) {
    return this.client.json(p, PRListSchema, args);
  }

  inspect = Effect.fn("GitHubDelivery.inspect")(
    { self: this },
    function* (p: Project, e: ManagedExecution) {
      const rows = yield* this.call(p, [
        "pr",
        "list",
        "--state",
        "all",
        "--head",
        e.branch,
        "--base",
        e.target_branch ?? p.target_branch,
        "--limit",
        "100",
        "--json",
        "url,state,headRefOid,baseRefName,mergeCommit,mergedAt,reviewDecision,statusCheckRollup,isDraft,mergeable,mergeStateStatus,body,title",
      ]);
      if (rows.length > 1) {
        return yield* new GitError(
          "PR_AMBIGUOUS",
          "Multiple PRs match the owned branch; recover manually",
        );
      }
      return rows[0];
    },
  );

  deliver = (p: Project, e: ManagedExecution, publication: Publication, draft = false) =>
    deliverPublication(this.git, this.client, this.inspect, p, e, publication, draft);

  provisional = (p: Project, e: ManagedExecution) =>
    provisionalPublication(this.git, this.client, this.inspect, p, e);

  assessment = (p: Project, e: ManagedExecution) =>
    assessPR(this.inspect, this.readinessAdapter, this.feedbackAdapter, p, e);

  feedback = (p: Project, e: ManagedExecution) =>
    this.assessment(p, e).pipe(Effect.map((a) => a.feedback));

  findings = (p: Project, e: ManagedExecution) =>
    this.feedback(p, e).pipe(Effect.map((f) => [...f.findings]));

  merge = (
    p: Project,
    e: ManagedExecution,
    assessed?: DeliveryAssessment,
    beforeSubmit?: () => Effect.Effect<void, CrewError>,
  ) => mergePR(this.client, this.inspect, this.assessment, p, e, assessed, beforeSubmit);

  evidence = (p: Project, e: ManagedExecution) => deliveryEvidence(this.git, this.inspect, p, e);
}
