/* oxlint-disable effecttsgo/unstable-api-usage -- Optional review HTTP contracts use pinned Effect 4 APIs. */
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { WorkspaceError, WorkspaceForbidden } from "./http-api.ts";
import {
  ReviewSelectionSchema,
  ReviewViewSchema,
  ReviewListQuerySchema,
  ReviewListSchema,
  ReviewAssetQuerySchema,
  ReviewAssetDataSchema,
  ReviewSubmitSchema,
  ReviewReceiptSchema,
  ReviewResponseQuerySchema,
  ReviewReceiptLookupSchema,
} from "./reviews.ts";
const error = [WorkspaceError, WorkspaceForbidden] as const;
export const reviewGroup = HttpApiGroup.make("reviews").add(
  HttpApiEndpoint.get("reviewReceipt", "/api/review/receipt", {
    query: ReviewResponseQuerySchema,
    success: ReviewReceiptLookupSchema,
    error,
  }),
  HttpApiEndpoint.get("reviewList", "/api/reviews", {
    query: ReviewListQuerySchema,
    success: ReviewListSchema,
    error,
  }),
  HttpApiEndpoint.get("review", "/api/review", {
    query: ReviewSelectionSchema,
    success: ReviewViewSchema,
    error,
  }),
  HttpApiEndpoint.get("reviewAsset", "/api/review/asset", {
    query: ReviewAssetQuerySchema,
    success: ReviewAssetDataSchema,
    error,
  }),
  HttpApiEndpoint.post("reviewSubmit", "/api/review/submit", {
    payload: ReviewSubmitSchema,
    success: ReviewReceiptSchema,
    error,
  }),
);
export const reviewApi = HttpApi.make("abra-reviews").add(reviewGroup);
