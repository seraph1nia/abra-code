import { Effect, Schema } from "effect";
import { NonEmpty, Positive } from "../contracts.ts";
import { CrewError, ensure, type Project, type ManagedExecution } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { type CurrentAction } from "../workflow/action-contracts.ts";
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
    function* (this: GitHubPRActions, p: Project, e: ManagedExecution, action: CurrentAction) {
      const pr = yield* this.inspect(p, e);
      ensure(
        pr &&
          pr.headRefOid === action.head &&
          pr.url === action.pr &&
          action.pr === e.pull_request_reference &&
          action.repository_id === e.repository_id &&
          pr.baseRefName === (e.target_branch ?? p.target_branch),
        "PR_HEAD",
        "PR action target or head changed",
      );
      const repo = yield* this.forge.repo(p);
      const { endpoint, issue } = prEndpoint(repo.full_name, pr.url);
      const request = (command: PreparedWrite["command"]): ActionPreparation => {
        ensure(pr.state === "OPEN", "PR_CLOSED", "PR action requires the exact open target");
        return { kind: "write", write: { action, command } };
      };
      switch (action.kind) {
        case "ready":
          return !pr.isDraft
            ? { kind: "confirmed" as const, receipt: pr.url }
            : request({ kind: "ready" });
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
          ensure(
            identity.head.sha === action.head && identity.base.ref === pr.baseRefName,
            "PR_HEAD",
            "Review request PR changed",
          );
          ensure(
            !action.target.users.includes(identity.user.login),
            "REVIEWER_SELF",
            "PR author cannot review their own pull request",
          );
          for (const user of users)
            ensure(
              yield* reviewerPermission(this.forge, p, repo.full_name, "user", user),
              "REVIEWER_PERMISSION",
              "Selected reviewer does not have write access",
            );
          for (const team of teams)
            ensure(
              yield* reviewerPermission(this.forge, p, repo.full_name, "team", team),
              "REVIEWER_PERMISSION",
              "Selected team cannot review this repository",
            );
          return request({ kind: "reviewers", endpoint, users, teams });
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
          ensure(
            existing.length <= 1,
            "ACTION_AMBIGUOUS",
            "Multiple replies match the retained action identity",
          );
          if (existing[0]) return { kind: "confirmed" as const, receipt: existing[0].html_url };
          const fresh = yield* new GitHubFeedback(this.forge).observe(p, e, pr);
          ensure(
            fresh.complete &&
              fresh.findings.some(
                (f) => f.id === action.target.finding && f.revision === action.target.revision,
              ),
            "FINDING_STALE",
            "Feedback changed before reply",
          );
          return request({
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
          ensure(
            state.id === action.target.thread_id,
            "THREAD_IDENTITY",
            "Thread identity changed",
          );
          if (state.isResolved) return { kind: "confirmed" as const, receipt: state.id };
          ensure(
            state.viewerCanResolve,
            "THREAD_PERMISSION",
            "Authenticated actor cannot resolve this thread",
          );
          const fresh = yield* new GitHubFeedback(this.forge).observe(p, e, pr);
          ensure(fresh.complete, "FEEDBACK_UNCONFIRMED", "Thread source is incomplete");
          const comments = fresh.findings.filter(
            (f) => f.thread_id === action.target.thread_id && f.blocking,
          );
          const prior = new Map(e.feedback?.findings.map((f) => [f.id, f]));
          ensure(
            comments.every(
              (f) =>
                action.target.revisions.some((s) => s.id === f.id && s.revision === f.revision) &&
                prior.get(f.id)?.disposition?.status === "addressed" &&
                prior.get(f.id)?.disposition?.head === action.head,
            ),
            "THREAD_CHANGED",
            "Thread has unhandled or changed comments",
          );
          return request({ kind: "resolve", thread: state.id });
        }
        case "rerun": {
          const target = action.target;
          const run = yield* this.forge.json(p, ActionsRun, [
            "api",
            `repos/${repo.full_name}/actions/runs/${target.run_id}`,
          ]);
          ensure(
            run.id === target.run_id &&
              run.head_sha === action.head &&
              run.path === target.workflow,
            "ACTIONS_HEAD",
            "Rerun does not belong to the delivered head/workflow",
          );
          if (run.run_attempt > target.run_attempt)
            return run.status === "completed"
              ? { kind: "confirmed" as const, receipt: `attempt ${run.run_attempt}` }
              : { kind: "awaiting" as const, detail: `Waiting for attempt ${run.run_attempt}` };
          ensure(
            run.run_attempt === target.run_attempt,
            "RERUN_ELIGIBILITY",
            "Only the retained completed failed attempt can be retried",
          );
          if (run.status !== "completed")
            return { kind: "awaiting" as const, detail: "Source attempt remains active" };
          ensure(
            ["failure", "cancelled", "timed_out"].includes(run.conclusion ?? ""),
            "RERUN_ELIGIBILITY",
            "Only a completed failed attempt can be retried",
          );
          return request({
            kind: "rerun",
            endpoint: `repos/${repo.full_name}/actions/runs/${target.run_id}/rerun-failed-jobs`,
          });
        }
      }
    }.bind(this),
    domainEffect,
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
    function* (this: GitHubPRActions, p: Project, e: ManagedExecution, write: PreparedWrite) {
      const { action, command } = write;
      ensure(
        !e.stop_status &&
          action.head === e.delivered_commit &&
          action.pr === e.pull_request_reference &&
          action.repository_id === e.repository_id &&
          action.kind === command.kind,
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
          ensure(
            command.users.every((u) => accepted.requested_reviewers.some((r) => r.login === u)) &&
              command.teams.every((t) => accepted.requested_teams.some((r) => r.slug === t)),
            "REVIEW_REQUEST_UNCONFIRMED",
            "Review request response did not confirm selected reviewers",
          );
          return { kind: "confirmed" as const, receipt: "Review requests accepted" };
        }
        case "reply": {
          const posted = yield* this.forge.request(p, Reply, "POST", command.endpoint, {
            body: command.body,
          });
          ensure(
            posted.user?.login === command.actor && posted.body === command.body,
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
          ensure(
            resolved.data.resolveReviewThread.thread.id === command.thread &&
              resolved.data.resolveReviewThread.thread.isResolved,
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
    }.bind(this),
    domainEffect,
  );
}
