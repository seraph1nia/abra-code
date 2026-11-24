/* oxlint-disable effecttsgo/unstable-api-usage -- Shared pinned Effect 4 HTTP API client. */
import { Effect } from "effect";
import { FetchHttpClient } from "effect/http";
import { HttpApiClient } from "effect/http-api";
import { workspaceApi } from "@abracode/contracts/web/http-api";

/** Fetch remains behind HttpApiClient's schema encoding and response validation. */
export const workspaceUrls = HttpApiClient.urlBuilder(workspaceApi);
export const makeWorkspaceClient = (baseUrl: string) =>
  HttpApiClient.make(workspaceApi, { baseUrl }).pipe(Effect.provide(FetchHttpClient.layer));
