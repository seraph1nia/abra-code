/* oxlint-disable effecttsgo/unstable-api-usage -- Compatibility re-export of reviewGroup and reviewApi until Lane 3C switches apps/web to workspaceApi. */
import { HttpApi } from "effect/http-api";
import { reviewGroup } from "./http-api.ts";

export { reviewGroup };
export const reviewApi = HttpApi.make("abra-reviews").add(reviewGroup);
