import { actionsEvidence } from "./actions.ts";
import { digest } from "../digest.ts";
import { replyBody } from "../workflow/action-contracts.ts";
import { Clock, Effect, Schema } from "effect";
import { Commit, NonEmpty, Positive } from "../contracts.ts";
import { FindingId, Timestamp, PullRequestUrl } from "../identities.ts";
import { CrewError, ensure, type ManagedExecution, type Project } from "../domain.ts";
import { decode } from "../decode.ts";
import { domainEffect } from "../effect.ts";
import { Forge, type PR } from "./forge.ts";
import { type OperationResult } from "../workflow/results.ts";
import { GitHubReadiness } from "./readiness.ts";
import { FeedbackSchema, type Feedback, type Finding } from "../workflow/feedback-contracts.ts";

const User = Schema.NullOr(Schema.Struct({ login: NonEmpty }));
const Review = Schema.Struct({
  id: Positive,
  commit_id: Schema.NullOr(Commit),
  state: Schema.Literals(["APPROVED", "CHANGES_REQUESTED", "COMMENTED", "DISMISSED", "PENDING"]),
  body: Schema.NullOr(Schema.String),
  html_url: PullRequestUrl,
  submitted_at: Schema.NullOr(Timestamp),
  user: User,
});
const Comment = Schema.Struct({
  id: Positive,
  body: Schema.String,
  html_url: PullRequestUrl,
  updated_at: Timestamp,
  user: User,
});
const Page = Schema.Struct({ hasNextPage: Schema.Boolean, endCursor: Schema.NullOr(NonEmpty) });
const ThreadComment = Schema.Struct({
  id: NonEmpty,
  databaseId: Schema.NullOr(Positive),
  body: Schema.String,
  url: Schema.NullOr(PullRequestUrl),
  updatedAt: Timestamp,
  author: User,
  originalCommit: Schema.NullOr(Schema.Struct({ oid: Commit })),
  pullRequestReview: Schema.NullOr(Schema.Struct({ state: Review.fields.state })),
});
const Comments = Schema.Struct({ nodes: Schema.Array(ThreadComment), pageInfo: Page });
const Thread = Schema.Struct({
  id: NonEmpty,
  isResolved: Schema.Boolean,
  viewerCanResolve: Schema.Boolean,
  path: Schema.String,
  comments: Comments,
});
const Threads = Schema.Struct({ nodes: Schema.Array(Thread), pageInfo: Page });
const ThreadResponse = Schema.Struct({
  data: Schema.Struct({
    repository: Schema.Struct({ pullRequest: Schema.Struct({ reviewThreads: Threads }) }),
  }),
});
const CommentResponse = Schema.Struct({
  data: Schema.Struct({ node: Schema.Struct({ id: NonEmpty, comments: Comments }) }),
});
const commentFields =
  "nodes{id databaseId body url updatedAt author{login} originalCommit{oid} pullRequestReview{state}} pageInfo{hasNextPage endCursor}";
const threadsQuery = `query($owner:String!,$name:String!,$number:Int!,$cursor:String){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100,after:$cursor){nodes{id isResolved viewerCanResolve path comments(first:100){${commentFields}}} pageInfo{hasNextPage endCursor}}}}}`;
const commentsQuery = `query($id:ID!,$cursor:String!){node(id:$id){... on PullRequestReviewThread{id comments(first:100,after:$cursor){${commentFields}}}}}`;

/** REST pagination is consumed as complete page arrays; bounded malformed output never means empty. */
export function restPages<S extends Schema.ConstraintDecoder<unknown>>(
  forge: Forge,
  p: Project,
  schema: S,
  endpoint: string,
) {
  return forge
    .json(p, Schema.Array(Schema.Array(schema)), ["api", endpoint, "--paginate", "--slurp"])
    .pipe(
      Effect.flatMap((pages) =>
        pages.length
          ? Effect.succeed(pages.flat())
          : Effect.fail(new CrewError("FEEDBACK_INCOMPLETE", "Missing REST pagination evidence")),
      ),
    );
}
export function prEndpoint(slug: string, url: PullRequestUrl) {
  const parsed = new URL(url);
  const match = /^\/(.+)\/pull\/(\d+)$/.exec(parsed.pathname);
  ensure(
    match && match[1] === slug,
    "PR_IDENTITY",
    "Feedback PR does not match registered repository",
  );
  return {
    endpoint: `repos/${slug}/pulls/${match[2]}`,
    number: match[2]!,
    issue: `repos/${slug}/issues/${match[2]}`,
  };
}
export class GitHubFeedback {
  constructor(private forge: Forge) {}
  observe = Effect.fn("GitHubFeedback.observe")(
    function* (
      this: GitHubFeedback,
      p: Project,
      e: ManagedExecution,
      pr: PR,
      assessed?: OperationResult,
    ) {
      const repo = yield* this.forge.repo(p);
      const { endpoint, number, issue } = prEndpoint(repo.full_name, pr.url);
      const now = yield* Clock.currentTimeMillis;
      const readiness = assessed ?? (yield* new GitHubReadiness(this.forge).check(p, e, pr, true));
      let complete = !!e.forge_observation?.required_confirmed && !e.forge_observation.limited;
      let error = complete
        ? undefined
        : readiness.category === "completed"
          ? "Unconfirmed check policy"
          : readiness.reason;
      const reviews = yield* restPages(this.forge, p, Review, `${endpoint}/reviews?per_page=100`);
      const ordinary = yield* restPages(this.forge, p, Comment, `${issue}/comments?per_page=100`);
      const findings: Finding[] = [];
      let inspectionRequired = false;
      const add = (
        source: string,
        kind: Finding["kind"],
        text: string,
        extra: Partial<Finding> = {},
      ) => {
        if (Buffer.byteLength(text) > 8192 || findings.length >= 256) {
          complete = false;
          inspectionRequired = true;
          error = "Feedback payload exceeds bounded inspection limits";
          return;
        }
        const revision =
          extra.revision ??
          digest({
            text,
            original_head: extra.original_head,
            review_state: extra.review_state,
            resolved: extra.resolved,
            path: extra.path,
            run_attempt: extra.run_attempt,
          });
        findings.push({
          id: FindingId.make(`${kind}-${digest([source, revision]).slice(0, 48)}`),
          source_id: source,
          revision,
          kind,
          head: pr.headRefOid,
          text: text || "Review requests changes",
          blocking: true,
          ...extra,
        });
      };
      const latest = new Map<string, typeof Review.Type>();
      for (const review of reviews)
        if (review.submitted_at && review.state !== "PENDING" && review.state !== "COMMENTED") {
          const key = review.user?.login ?? `deleted-${review.id}`;
          if ((latest.get(key)?.id ?? 0) < review.id) latest.set(key, review);
        }
      for (const review of reviews) {
        if (!review.submitted_at || review.state === "PENDING") continue;
        const active =
          review.state === "COMMENTED" ||
          latest.get(review.user?.login ?? `deleted-${review.id}`)?.id === review.id;
        if (!active || (review.state !== "CHANGES_REQUESTED" && !review.body?.trim())) continue;
        add(`review-${review.id}`, "review", review.body?.trim() || "Review requests changes", {
          review_state: review.state,
          original_head: review.commit_id ?? undefined,
          author: review.user?.login,
          url: review.html_url,
          blocking: !["APPROVED", "DISMISSED"].includes(review.state),
        });
      }
      // A prepared identity plus exact content and authenticated author also reconciles a lost reply response.
      const replies = e.feedback?.actions.filter((a) => a.kind === "reply") ?? [];
      const actor = replies.length
        ? (yield* this.forge.json(p, Schema.Struct({ login: NonEmpty }), ["api", "user"])).login
        : undefined;
      const own = (body: string, author: string | undefined) =>
        e.feedback?.actions.some(
          (a) =>
            a.kind === "reply" &&
            a.status !== "superseded" &&
            author === actor &&
            body === `${replyBody(a)}\n\n<!-- abracode-action:${a.id} -->`,
        );
      for (const comment of ordinary)
        if (comment.body.trim() && !own(comment.body, comment.user?.login))
          add(`comment-${comment.id}`, "comment", comment.body, {
            author: comment.user?.login,
            url: comment.html_url,
            comment_id: comment.id,
          });
      let cursor: string | undefined;
      const visited = new Set<string>();
      const [owner, name] = repo.full_name.split("/");
      do {
        const page = (yield* this.forge.json(p, ThreadResponse, [
          "api",
          "graphql",
          "-f",
          `query=${threadsQuery}`,
          "-f",
          `owner=${owner}`,
          "-f",
          `name=${name}`,
          "-F",
          `number=${number}`,
          ...(cursor ? ["-f", `cursor=${cursor}`] : []),
        ])).data.repository.pullRequest.reviewThreads;
        for (const thread of page.nodes) {
          let comments = thread.comments;
          const seen = new Set<string>();
          for (;;) {
            for (const comment of comments.nodes)
              if (
                comment.body.trim() &&
                comment.pullRequestReview?.state !== "PENDING" &&
                !own(comment.body, comment.author?.login)
              ) {
                ensure(
                  comment.url,
                  "FEEDBACK_INCOMPLETE",
                  "Published thread comment has no source URL",
                );
                add(`thread-${thread.id}-${comment.id}`, "thread", comment.body, {
                  thread_id: thread.id,
                  comment_id: comment.databaseId ?? undefined,
                  author: comment.author?.login,
                  url: comment.url,
                  original_head: comment.originalCommit?.oid,
                  path: thread.path,
                  resolved: thread.isResolved,
                  can_resolve: thread.viewerCanResolve,
                  blocking: !thread.isResolved,
                });
              }
            if (!comments.pageInfo.hasNextPage) break;
            const next = comments.pageInfo.endCursor;
            ensure(
              next && !seen.has(next) && seen.size < 32,
              "FEEDBACK_INCOMPLETE",
              "Unconfirmed nested comment pagination",
            );
            seen.add(next);
            const nested = (yield* this.forge.json(p, CommentResponse, [
              "api",
              "graphql",
              "-f",
              `query=${commentsQuery}`,
              "-f",
              `id=${thread.id}`,
              "-f",
              `cursor=${next}`,
            ])).data.node;
            ensure(
              nested.id === thread.id,
              "FEEDBACK_INCOMPLETE",
              "Nested comment page belongs to another thread",
            );
            comments = nested.comments;
          }
        }
        if (!page.pageInfo.hasNextPage) break;
        const next = page.pageInfo.endCursor;
        ensure(
          next && !visited.has(next) && visited.size < 32,
          "FEEDBACK_INCOMPLETE",
          "Unconfirmed thread pagination",
        );
        visited.add(next);
        cursor = next;
      } while (true);
      const checks = e.forge_observation?.checks ?? [];
      let detailBytes = 0;
      for (const check of checks)
        if (["fail", "cancel"].includes(check.bucket)) {
          ensure(check.source, "CHECKS_UNCONFIRMED", "Check has no canonical source identity");
          const source = check.source;
          let evidence: Partial<Finding> = source.link
            ? yield* actionsEvidence(this.forge, p, repo.full_name, source.link, pr.headRefOid)
            : { evidence_unavailable: "Check has no linked job evidence" };
          if ("logs" in evidence && evidence.logs) {
            detailBytes += Buffer.byteLength(evidence.logs);
            if (detailBytes > 32768) {
              evidence = {
                ...evidence,
                logs: undefined,
                evidence_unavailable:
                  "Observation failure-detail budget reached; inspect the linked run",
              };
            }
          }
          add(`check-${source.kind}-${source.id}`, "check", `${check.name}: ${check.bucket}`, {
            url: source.link,
            revision: digest([source.revision, evidence.run_attempt]),
            blocking: check.blocking,
            // The canonical source and optional Actions attempt identify this revision.
            ...evidence,
            source_id: `check-${source.kind}-${source.id}`,
          });
        }
      if (new Set(findings.map((f) => f.source_id)).size !== findings.length) {
        complete = false;
        inspectionRequired = true;
        error = "Duplicate or inconsistent source identity across feedback pages";
      }
      const result: Feedback = {
        schema_version: 1,
        head: pr.headRefOid,
        pr: pr.url,
        target: pr.baseRefName,
        observed_at: now,
        next_check_at: now + 30000,
        attempts: 0,
        complete,
        error,
        ...(inspectionRequired ? { inspection_required: true } : {}),
        digest: digest(findings.map((f) => [f.id, f.resolved, f.blocking])),
        findings,
        history: [],
        actions: [],
      };
      return yield* decode(FeedbackSchema, result, "GitHub feedback observation");
    }.bind(this),
    domainEffect,
  );
}
