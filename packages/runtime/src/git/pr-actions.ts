import { GitError } from "../errors.ts";
import { Effect, Schema } from "effect";
import { NonEmpty, Positive } from "@abracode/contracts/primitives";
import { CrewError, type Project, type ManagedExecution } from "../domain.ts";
import { type CurrentAction } from "@abracode/contracts/workflow/action-contracts";
import {
  type ActionPreparation,
  type ActionOutcome,
  type PreparedWrite,
  type PRActionAdapter,
} from "./action-contracts.ts";
import { Forge, type PR } from "./forge.ts";
import { prEndpoint, restPages, GitHubFeedback } from "./feedback.ts";
import { reviewerPermission } from "./reviewers.ts";
import { ActionsRun } from "./actions.ts";

const Reviewer = Schema.Struct({ login: NonEmpty });
const Team = Schema.Struct({ slug: NonEmpty });
const Requested = Schema.Struct({ users: Schema.Array(Reviewer), teams: Schema.Array(Team) });
const Review = Schema.Struct({
  user: Schema.NullOr(Reviewer),
  submitted_at: Schema.NullOr(Schema.String),
  commit_id: Schema.NullOr(Schema.String),
});
const Reply = Schema.Struct({
  in_reply_to_id: Schema.optional(Positive),
  html_url: NonEmpty,
  body: Schema.String,
  user: Schema.NullOr(Reviewer),
});
const ThreadState = Schema.Struct({
  data: Schema.Struct({
    node: Schema.Struct({
      id: NonEmpty,
      isResolved: Schema.Boolean,
      viewerCanResolve: Schema.Boolean,
    }),
  }),
});

/** Preparation and reconciliation are read-only. Only submit can perform an outward mutation. */
export class GitHubPRActions implements PRActionAdapter {
  constructor(
    private forge: Forge,
    private inspect: (p: Project, e: ManagedExecution) => Effect.Effect<PR | undefined, CrewError>,
  ) {}
  prepare: PRActionAdapter["prepare"] = Effect.fn("GitHubPRActions.prepare")(
    { self: this },
    function* (p: Project, e: ManagedExecution, action: CurrentAction) {
      const pr = yield* this.inspect(p, e);
      if (
        !pr ||
        pr.headRefOid !== action.head ||
        pr.url !== action.pr ||
        action.pr !== e.pull_request_reference ||
        action.repository_id !== e.repository_id ||
        pr.baseRefName !== (e.target_branch ?? p.target_branch)
      )
        return yield* new GitError("PR_HEAD", "PR action target or head changed");
      const repo = yield* this.forge.repo(p);
      const { endpoint, issue } = yield* prEndpoint(repo.full_name, pr.url);
      const request = (
        command: PreparedWrite["command"],
      ): Effect.Effect<ActionPreparation, CrewError> =>
        pr.state === "OPEN"
          ? Effect.succeed({ kind: "write", write: { action, command } })
          : Effect.fail(new GitError("PR_CLOSED", "PR action requires the exact open target"));
      switch (action.kind) {
        case "ready":
          return !pr.isDraft
            ? { kind: "confirmed" as const, receipt: pr.url }
            : yield* request({ kind: "ready" });
        case "reviewers": {
          const pending = yield* this.forge.json(p, Requested, [
            "api",
            `${endpoint}/requested_reviewers`,
          ]);
          const reviews = yield* restPages(
            this.forge,
            p,
            Review,
            `${endpoint}/reviews?per_page=100`,
          );
          const users = action.target.users.filter(
            (u) =>
              !pending.users.some((x) => x.login === u) &&
              !reviews.some(
                (r) => r.user?.login === u && r.submitted_at && r.commit_id === action.head,
              ),
          );
          const teams = action.target.teams.filter((t) => !pending.teams.some((x) => x.slug === t));
          if (!users.length && !teams.length)
            return { kind: "confirmed" as const, receipt: "Review request observed" };
          const identity = yield* this.forge.json(
            p,
            Schema.Struct({
              user: Reviewer,
              head: Schema.Struct({ sha: NonEmpty }),
              base: Schema.Struct({ ref: NonEmpty }),
            }),
            ["api", endpoint],
          );
          if (identity.head.sha !== action.head || identity.base.ref !== pr.baseRefName)
            return yield* new GitError("PR_HEAD", "Review request PR changed");
          if (action.target.users.includes(identity.user.login))
            return yield* new GitError(
              "REVIEWER_SELF",
              "PR author cannot review their own pull request",
            );
          const checks = [
            ...users.map((name) => ({
              kind: "user" as const,
              name,
              message: "Selected reviewer does not have write access",
            })),
            ...teams.map((name) => ({
              kind: "team" as const,
              name,
              message: "Selected team cannot review this repository",
            })),
          ];
          yield* Effect.forEach(
            checks,
            (check) =>
              reviewerPermission(this.forge, p, repo.full_name, check.kind, check.name).pipe(
                Effect.flatMap((allowed) =>
                  allowed
                    ? Effect.void
                    : Effect.fail(new GitError("REVIEWER_PERMISSION", check.message)),
                ),
              ),
            { concurrency: 4 },
          );
          return yield* request({ kind: "reviewers", endpoint, users, teams });
        }
        case "reply": {
          const actor = yield* this.forge.json(p, Reviewer, ["api", "user"]);
          const destination = action.target.destination;
          const replies = yield* restPages(
            this.forge,
            p,
            Reply,
            destination.kind === "thread"
              ? `${endpoint}/comments?per_page=100`
              : `${issue}/comments?per_page=100`,
          );
          const body = `${action.target.body}\n\n<!-- abracode-action:${action.id} -->`;
          const existing = replies.filter(
            (r) =>
              r.user?.login === actor.login &&
              r.body === body &&
              (destination.kind !== "thread" || r.in_reply_to_id === destination.comment_id),
          );
          if (!(existing.length <= 1))
            return yield* new GitError(
              "ACTION_AMBIGUOUS",
              "Multiple replies match the retained action identity",
            );
          if (existing[0]) return { kind: "confirmed" as const, receipt: existing[0].html_url };
          const fresh = yield* new GitHubFeedback(this.forge).observe(p, e, pr);
          if (
            !fresh.complete ||
            !fresh.findings.some(
              (f) => f.id === action.target.finding && f.revision === action.target.revision,
            )
          )
            return yield* new GitError("FINDING_STALE", "Feedback changed before reply");
          return yield* request({
            kind: "reply",
            endpoint:
              destination.kind === "thread"
                ? `${endpoint}/comments/${destination.comment_id}/replies`
                : `${issue}/comments`,
            body,
            actor: actor.login,
          });
        }
        case "resolve": {
          const state = (yield* this.forge.json(p, ThreadState, [
            "api",
            "graphql",
            "-f",
            "query=query($id:ID!){node(id:$id){... on PullRequestReviewThread{id isResolved viewerCanResolve}}}",
            "-f",
            `id=${action.target.thread_id}`,
          ])).data.node;
          if (state.id !== action.target.thread_id)
            return yield* new GitError("THREAD_IDENTITY", "Thread identity changed");
          if (state.isResolved) return { kind: "confirmed" as const, receipt: state.id };
          if (!state.viewerCanResolve)
            return yield* new GitError(
              "THREAD_PERMISSION",
              "Authenticated actor cannot resolve this thread",
            );
          const fresh = yield* new GitHubFeedback(this.forge).observe(p, e, pr);
          if (!fresh.complete)
            return yield* new GitError("FEEDBACK_UNCONFIRMED", "Thread source is incomplete");
          const comments = fresh.findings.filter(
            (f) => f.thread_id === action.target.thread_id && f.blocking,
          );
          const prior = new Map(e.feedback?.findings.map((f) => [f.id, f]));
          if (
            !comments.every(
              (f) =>
                action.target.revisions.some((s) => s.id === f.id && s.revision === f.revision) &&
                prior.get(f.id)?.disposition?.status === "addressed" &&
                prior.get(f.id)?.disposition?.head === action.head,
            )
          )
            return yield* new GitError(
              "THREAD_CHANGED",
              "Thread has unhandled or changed comments",
            );
          return yield* request({ kind: "resolve", thread: state.id });
        }
        case "rerun": {
          const target = action.target;
          const run = yield* this.forge.json(p, ActionsRun, [
            "api",
            `repos/${repo.full_name}/actions/runs/${target.run_id}`,
          ]);
          if (
            run.id !== target.run_id ||
            run.head_sha !== action.head ||
            run.path !== target.workflow
          )
            return yield* new GitError(
              "ACTIONS_HEAD",
              "Rerun does not belong to the delivered head/workflow",
            );
          if (run.run_attempt > target.run_attempt)
            return run.status === "completed"
              ? { kind: "confirmed" as const, receipt: `attempt ${run.run_attempt}` }
              : { kind: "awaiting" as const, detail: `Waiting for attempt ${run.run_attempt}` };
          if (run.run_attempt !== target.run_attempt)
            return yield* new GitError(
              "RERUN_ELIGIBILITY",
              "Only the retained completed failed attempt can be retried",
            );
          if (run.status !== "completed")
            return { kind: "awaiting" as const, detail: "Source attempt remains active" };
          if (!["failure", "cancelled", "timed_out"].includes(run.conclusion ?? ""))
            return yield* new GitError(
              "RERUN_ELIGIBILITY",
              "Only a completed failed attempt can be retried",
            );
          return yield* request({
            kind: "rerun",
            endpoint: `repos/${repo.full_name}/actions/runs/${target.run_id}/rerun-failed-jobs`,
          });
        }
      }
    },
  );
  reconcile: PRActionAdapter["reconcile"] = (p, e, action) =>
    this.prepare(p, e, action).pipe(
      Effect.map((result): ActionOutcome =>
        result.kind === "write"
          ? { kind: "awaiting" as const, detail: "No matching remote postcondition yet" }
          : result,
      ),
    );
  submit: PRActionAdapter["submit"] = Effect.fn("GitHubPRActions.submit")(
    { self: this },
    function* (p: Project, e: ManagedExecution, write: PreparedWrite) {
      const { action, command } = write;
      if (
        e.stop_status ||
        action.head !== e.delivered_commit ||
        action.pr !== e.pull_request_reference ||
        action.repository_id !== e.repository_id ||
        action.kind !== command.kind
      )
        return yield* new GitError(
          "ACTION_STALE",
          "Prepared write no longer matches the owned delivery",
        );
      switch (command.kind) {
        case "ready":
          yield* this.forge.run(p, ["pr", "ready", action.pr]);
          return yield* this.reconcile(p, e, action);
        case "reviewers": {
          const accepted = yield* this.forge.request(
            p,
            Schema.Struct({
              requested_reviewers: Schema.Array(Reviewer),
              requested_teams: Schema.Array(Team),
            }),
            "POST",
            `${command.endpoint}/requested_reviewers`,
            { reviewers: command.users, team_reviewers: command.teams },
          );
          if (
            !command.users.every((u) => accepted.requested_reviewers.some((r) => r.login === u)) ||
            !command.teams.every((t) => accepted.requested_teams.some((r) => r.slug === t))
          )
            return yield* new GitError(
              "REVIEW_REQUEST_UNCONFIRMED",
              "Review request response did not confirm selected reviewers",
            );
          return { kind: "confirmed" as const, receipt: "Review requests accepted" };
        }
        case "reply": {
          const posted = yield* this.forge.request(p, Reply, "POST", command.endpoint, {
            body: command.body,
          });
          if (posted.user?.login !== command.actor || posted.body !== command.body)
            return yield* new GitError(
              "ACTION_IDENTITY",
              "Posted reply differs from prepared content",
            );
          return { kind: "confirmed" as const, receipt: posted.html_url };
        }
        case "resolve": {
          const resolved = yield* this.forge.json(
            p,
            Schema.Struct({
              data: Schema.Struct({
                resolveReviewThread: Schema.Struct({
                  thread: Schema.Struct({ id: NonEmpty, isResolved: Schema.Boolean }),
                }),
              }),
            }),
            [
              "api",
              "graphql",
              "-f",
              "query=mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{id isResolved}}}",
              "-f",
              `id=${command.thread}`,
            ],
          );
          if (
            resolved.data.resolveReviewThread.thread.id !== command.thread ||
            !resolved.data.resolveReviewThread.thread.isResolved
          )
            return yield* new GitError(
              "THREAD_UNCONFIRMED",
              "Thread resolution response is unconfirmed",
            );
          return { kind: "confirmed" as const, receipt: command.thread };
        }
        case "rerun":
          yield* this.forge.run(p, ["api", "--method", "POST", command.endpoint]);
          return {
            kind: "awaiting" as const,
            detail: "Rerun requested; awaiting the next completed attempt",
          };
      }
    },
  );
}
