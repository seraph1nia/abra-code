import { Effect } from "effect";

import { IssueId, type ContentHash } from "@abracode/contracts/identities";
import type {
  ReviewSelection,
  ReviewSubmit,
  ReviewResponseQuerySchema,
} from "@abracode/contracts/web/reviews";
import { WorkspaceApi } from "./data.ts";

export const reviewListQuery = (issue?: string) =>
  WorkspaceApi.query("reviews", "reviewList", {
    query: issue ? { issue_id: IssueId.make(issue) } : {},
    reactivityKeys: ["reviews-observed"],
    timeToLive: "0 seconds",
  });
export const reviewQuery = (selection: ReviewSelection) =>
  WorkspaceApi.query("reviews", "review", {
    query: { review_id: selection.review_id, revision: selection.revision },
    reactivityKeys: ["reviews-observed"],
    timeToLive: "0 seconds",
  });
export const reviewAssetQuery = (selection: ReviewSelection, hash: ContentHash) =>
  WorkspaceApi.query("reviews", "reviewAsset", {
    query: { ...selection, hash },
    timeToLive: "30 seconds",
  });
export const submitReview = (payload: ReviewSubmit) =>
  Effect.flatMap(WorkspaceApi, (client) => client.reviews.reviewSubmit({ payload }));

export const readReviewReceipt = (query: typeof ReviewResponseQuerySchema.Type) =>
  Effect.flatMap(WorkspaceApi, (client) => client.reviews.reviewReceipt({ query }));
