/* oxlint-disable effecttsgo/unstable-api-usage -- Review capability HTTP atoms load only when a review is opened. */
import { Effect } from "effect";
import { FetchHttpClient } from "effect/http";
import { Atom, AtomHttpApi } from "effect/reactivity";
import { IssueId, type ContentHash } from "@abracode/contracts/identities";
import { reviewApi } from "@abracode/contracts/web/review-api";
import type {
  ReviewSelection,
  ReviewSubmit,
  ReviewResponseQuerySchema,
} from "@abracode/contracts/web/reviews";
export class ReviewApi extends AtomHttpApi.Service<ReviewApi>()("ReviewApi", {
  api: reviewApi,
  httpClient: FetchHttpClient.layer,
}) {}
export const reviewListQuery = (issue?: string) =>
  ReviewApi.query("reviews", "reviewList", {
    query: issue ? { issue_id: IssueId.make(issue) } : {},
    reactivityKeys: ["reviews-observed"],
    timeToLive: "0 seconds",
  });
export const reviewQuery = (selection: ReviewSelection) =>
  ReviewApi.query("reviews", "review", {
    query: { review_id: selection.review_id, revision: selection.revision },
    reactivityKeys: ["reviews-observed"],
    timeToLive: "0 seconds",
  });
export const reviewAssetQuery = (selection: ReviewSelection, hash: ContentHash) =>
  ReviewApi.query("reviews", "reviewAsset", {
    query: { ...selection, hash },
    timeToLive: "30 seconds",
  });
export const submitReview = Atom.family((_id: string) =>
  ReviewApi.runtime.fn<ReviewSubmit>()((payload) =>
    Effect.flatMap(ReviewApi, (client) => client.reviews.reviewSubmit({ payload })),
  ),
);

export const readReviewReceipt = ReviewApi.runtime.fn(
  (query: typeof ReviewResponseQuerySchema.Type) =>
    Effect.flatMap(ReviewApi, (client) => client.reviews.reviewReceipt({ query })),
);
