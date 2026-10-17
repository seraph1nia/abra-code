/* oxlint-disable effecttsgo/unstable-api-usage -- OpenCode 2.0.28 requires Effect HTTP; versions are pinned and real-server tested. */
import { OpenCode } from "@opencode/client/effect";
import { Service, type Endpoint } from "@opencode/client/effect/service";
import { Effect, Exit, Duration } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
/** Capture authentication in the HTTP client used by every native request. */
export const makeClient = (endpoint: Endpoint) =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    return yield* OpenCode.make({ baseUrl: endpoint.url }).pipe(
      Effect.provideService(
        HttpClient.HttpClient,
        HttpClient.mapRequest(http, (request) =>
          HttpClientRequest.setHeaders(request, Service.headers(endpoint) ?? {}),
        ),
      ),
    );
  }).pipe(Effect.provide(FetchHttpClient.layer));

/** Single-flight successful acquisition; failure never poisons later discovery. */
export const memoSuccessful = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.cachedWithTTL(effect, (exit) =>
    Exit.isSuccess(exit) ? Duration.infinity : Duration.zero,
  );
