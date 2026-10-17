import { GitHubReviewers, type ReviewerSuggestions } from "./reviewers.ts";
import { GitHubPRActions } from "./pr-actions.ts";
import { type PRActionAdapter } from "./action-contracts.ts";
import { progress, completedProgress } from "../opencode/progress.ts";
import {
  Executable,
  AbsolutePath,
  Commit,
  PullRequestUrl,
  BranchName,
  Timestamp,
  timestamp,
} from "../identities.ts";

import { GitHubFeedback } from "./feedback.ts";
import { type Feedback } from "../workflow/feedback-contracts.ts";
import { type ForgeFindingSchema } from "../workflow/correction-contracts.ts";
import { domainEffect } from "../effect.ts";
import { CrewError, type ManagedExecution, type Project } from "../domain.ts";
import { Effect, Schema } from "effect";
import { mkdtemp, writeFile, rm } from "../filesystem.ts";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type Runner } from "../process.ts";
import { Git } from "./repository.ts";
import { type OperationResult } from "../workflow/results.ts";
import { prContent, updateSummary } from "./pr-content.ts";
import { GitHubReadiness } from "./readiness.ts";
import { Forge, PRSchema, type PR } from "./forge.ts";
export { PRSchema, type PR } from "./forge.ts";
export interface DeliveryAssessment {
  pr: PR;
  feedback: Feedback;
  readiness: OperationResult;
}
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
export class GitHubDelivery implements Delivery {
  reviewers = (p: Project, e: ManagedExecution) =>
    new GitHubReviewers(this.git, this.client).suggest(p, e);
  private client: Forge;
  readonly actions: GitHubPRActions;
  constructor(
    private git: Git,
    runner: Runner,
    forge: Executable,
  ) {
    this.client = new Forge(runner, forge);
    this.actions = new GitHubPRActions(this.client, this.inspect);
  }
  private call(p: Project, args: string[]) {
    return this.client.json(p, Schema.Array(PRSchema), args);
  }
  inspect = Effect.fn("GitHubDelivery.inspect")(
    function* (this: GitHubDelivery, p: Project, e: ManagedExecution) {
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
      ]).pipe(
        Effect.mapError((error) =>
          error.code === "COMMAND_FAILED"
            ? new CrewError(
                "FORGE_OBSERVATION_FAILED",
                "Forge observation unavailable; recheck before mutation",
              )
            : error,
        ),
      );
      if (!(rows.length <= 1))
        return yield* new CrewError(
          "PR_AMBIGUOUS",
          "Multiple PRs match the owned branch; recover manually",
        );
      return rows[0];
    }.bind(this),
    domainEffect,
  );
  private withBody<A>(
    content: string,
    action: (path: AbsolutePath) => Effect.Effect<A, CrewError>,
  ) {
    return Effect.scoped(
      Effect.gen(function* () {
        const temp = yield* Effect.acquireRelease(mkdtemp(join(tmpdir(), "abracode-pr-")), (temp) =>
          rm(temp, { recursive: true }).pipe(Effect.orDie),
        );
        const path = AbsolutePath.make(join(temp, "body.md"));
        yield* writeFile(path, content, { mode: 0o600, flag: "wx" });
        return yield* action(path);
      }),
    );
  }
  deliver = Effect.fn("GitHubDelivery.deliver")(
    function* (this: GitHubDelivery, p: Project, e: ManagedExecution, draft = false) {
      yield* progress({ stage: "deliver", status: "started" });
      if (!e.worktree_directory) return yield* new CrewError("WORKTREE", "Missing worktree");
      const commit = yield* this.git.commit(
        e.worktree_directory,
        e.issue_id,
        e.setup
          ? `Initialize OpenSpec for ${p.id}`
          : draft
            ? `Publish draft implementation ${e.issue_id}`
            : undefined,
      );
      // Retrying a push is avoided if the exact remote ref already exists.
      const remote = yield* this.git.run(e.worktree_directory, [
        "ls-remote",
        "origin",
        `refs/heads/${e.branch}`,
      ]);
      if (
        e.provisional &&
        !remote.startsWith(`${commit}\t`) &&
        !remote.startsWith(`${e.provisional.head}\t`) &&
        !remote.startsWith(`${e.rounds?.at(-1)?.prior_delivered_commit}\t`)
      )
        return yield* new CrewError(
          "DELIVERY_CHANGED",
          "Provisional remote branch changed outside controller publication",
        );
      if (!remote.startsWith(`${commit}\t`) && e.rounds?.at(-1)?.prior_delivered_commit) {
        const previous = e.rounds.at(-1)!.prior_delivered_commit!;
        if (!remote.startsWith(`${previous}\t`))
          return yield* new CrewError(
            "DELIVERY_CHANGED",
            "Correction remote branch is no longer the retained prior head",
          );
        yield* this.git.run(e.worktree_directory, [
          "merge-base",
          "--is-ancestor",
          previous,
          commit,
        ]);
        if (p.delivery === "github-pr") {
          const prior = yield* this.inspect(p, e);
          if (
            !(
              prior?.state === "OPEN" &&
              prior.url === e.pull_request_reference &&
              prior.headRefOid === previous &&
              prior.baseRefName === e.target_branch
            )
          )
            return yield* new CrewError("PR_HEAD", "Correction PR changed before push");
        }
      }
      if (!remote.startsWith(`${commit}\t`))
        yield* this.git.run(e.worktree_directory, ["push", "--set-upstream", "origin", e.branch]);
      if (p.delivery === "branch") return { commit };
      const content = prContent(p, e, commit);
      const existing = yield* this.inspect(p, e);
      if (existing) {
        if (!(existing.state !== "CLOSED"))
          return yield* new CrewError("PR_CLOSED", "Existing PR was closed without merging");
        if (!(!e.pull_request_reference || existing.url === e.pull_request_reference))
          return yield* new CrewError("PR_IDENTITY", "Owned PR identity changed");
        if (!(existing.headRefOid === commit))
          return yield* new CrewError(
            "PR_HEAD",
            "Owned PR head differs from the intended delivery",
          );
        if (!(existing.body !== undefined))
          return yield* new CrewError(
            "PR_BODY_UNKNOWN",
            "PR body unavailable; do not replace unknown user content",
          );
        const updated = updateSummary(existing.body, content.body);
        if (existing.state === "OPEN" && updated !== existing.body)
          yield* this.withBody(updated, (body) =>
            this.client.run(p, ["pr", "edit", existing.url, "--body-file", body]),
          );
        return { commit, pr: existing.url };
      }
      yield* this.withBody(content.body, (body) =>
        this.client.run(p, [
          "pr",
          "create",
          ...(draft ? ["--draft"] : []),
          "--head",
          e.branch,
          "--base",
          e.target_branch ?? p.target_branch,
          "--title",
          content.title,
          "--body-file",
          body,
        ]),
      );
      const created = yield* this.inspect(p, e);
      if (!created)
        return yield* new CrewError(
          "PR_UNKNOWN",
          "PR creation outcome unknown; reconcile before retrying",
        );
      return { commit, pr: created.url };
    }.bind(this),
    completedProgress("deliver"),
  );
  provisional = (p: Project, e: ManagedExecution) => this.deliver(p, e, true);
  assessment = Effect.fn("GitHubDelivery.assessment")(
    function* (this: GitHubDelivery, p: Project, e: ManagedExecution) {
      const pr = yield* this.inspect(p, e);
      if (
        !(
          pr?.state === "OPEN" &&
          pr.url === e.pull_request_reference &&
          pr.headRefOid === e.delivered_commit &&
          pr.baseRefName === e.target_branch
        )
      )
        return yield* new CrewError(
          "PR_HEAD",
          "Findings require the exact open delivered PR/head/target",
        );
      const readiness = yield* new GitHubReadiness(this.client).check(p, e, pr);
      const feedback = yield* new GitHubFeedback(this.client).observe(p, e, pr, readiness);
      const after = yield* this.inspect(p, e);
      if (
        !(
          after?.state === "OPEN" &&
          after.url === pr.url &&
          after.headRefOid === pr.headRefOid &&
          after.baseRefName === pr.baseRefName
        )
      )
        return yield* new CrewError(
          "PR_HEAD",
          "PR changed identity or head while observing findings",
        );
      return { pr, feedback, readiness };
    }.bind(this),
    domainEffect,
  );
  feedback = (p: Project, e: ManagedExecution) =>
    this.assessment(p, e).pipe(Effect.map((a) => a.feedback));
  findings = (p: Project, e: ManagedExecution) =>
    this.feedback(p, e).pipe(Effect.map((f) => [...f.findings]));
  merge = Effect.fn("GitHubDelivery.merge")(
    function* (
      this: GitHubDelivery,
      p: Project,
      e: ManagedExecution,
      assessed?: DeliveryAssessment,
    ) {
      yield* progress({ stage: "merge", status: "started" });
      const pr = yield* this.inspect(p, e);
      if (!pr) return yield* new CrewError("PR_MISSING", "No matching PR");
      if (
        !(
          ["OPEN", "MERGED"].includes(pr.state) &&
          pr.url === e.pull_request_reference &&
          pr.baseRefName === (e.target_branch ?? p.target_branch) &&
          pr.headRefOid === e.delivered_commit
        )
      )
        return yield* new CrewError("PR_HEAD", "PR target or head differs from reviewed delivery");
      if (pr.state === "MERGED") return { category: "completed", value: undefined } as const;
      const observation = assessed ?? (yield* this.assessment(p, e));
      if (observation.readiness.category !== "completed") return observation.readiness;
      const current = yield* this.inspect(p, e);
      if (
        !(
          current?.url === pr.url &&
          current.headRefOid === e.delivered_commit &&
          current.baseRefName === (e.target_branch ?? p.target_branch)
        )
      )
        return yield* new CrewError(
          "PR_HEAD",
          "PR identity, head or target changed during readiness observation",
        );
      if (!(current.state !== "CLOSED"))
        return yield* new CrewError("PR_CLOSED", "PR closed during readiness observation");
      if (current.state === "MERGED") return { category: "completed", value: undefined } as const;
      const method = e.effective_policy.merge_method;
      yield* this.client.run(p, [
        "pr",
        "merge",
        pr.url,
        `--${method}`,
        "--match-head-commit",
        e.delivered_commit!,
      ]);
      return { category: "completed", value: undefined } as const;
    }.bind(this),
    completedProgress("merge"),
  );
  evidence = Effect.fn("GitHubDelivery.evidence")(
    function* (this: GitHubDelivery, p: Project, e: ManagedExecution) {
      yield* progress({ stage: "deliver", status: "started" });
      if (p.delivery === "branch") {
        if (!e.delivered_commit) return yield* new CrewError("DELIVERY", "No committed delivery");
        const ref = yield* this.git.run(p.path, ["ls-remote", "origin", `refs/heads/${e.branch}`]);
        if (!ref.startsWith(`${e.delivered_commit}\t`))
          return yield* new CrewError(
            "DELIVERY",
            "Exact commit is not preserved in configured remote branch",
          );
        return { commit: e.delivered_commit, target: e.branch, at: yield* timestamp };
      }
      const pr = yield* this.inspect(p, e);
      if (
        !(
          pr?.state === "MERGED" &&
          pr.url === e.pull_request_reference &&
          pr.baseRefName === (e.target_branch ?? p.target_branch) &&
          pr.headRefOid === e.delivered_commit &&
          pr.mergeCommit?.oid
        )
      )
        return yield* new CrewError(
          "NOT_MERGED",
          "Delivery is not a verified merge of the intended PR head",
        );
      const target = e.target_branch ?? p.target_branch;
      const method = e.effective_policy.merge_method;
      yield* this.git.run(p.path, ["fetch", "--no-tags", "origin", `refs/heads/${target}`]);
      yield* this.git.run(p.path, [
        "merge-base",
        "--is-ancestor",
        pr.mergeCommit.oid,
        "FETCH_HEAD",
      ]);
      if (method === "merge")
        yield* this.git.run(p.path, [
          "merge-base",
          "--is-ancestor",
          e.delivered_commit!,
          "FETCH_HEAD",
        ]);
      return {
        commit: e.delivered_commit!,
        source_commit: e.delivered_commit!,
        result_commit: pr.mergeCommit.oid,
        target,
        method,
        pr: pr.url,
        at: yield* timestamp,
      };
    }.bind(this),
    completedProgress("deliver"),
  );
}
