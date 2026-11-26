import { httpDriver } from "../platform.ts";
import { OpenCode } from "@opencode/client/effect";
import { Service, type Endpoint } from "@opencode/client/effect/service";
import { Effect, Exit, Duration } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";

export const OPENCODE_VERSION = "2.3.0";

/** Capture authentication in the HTTP client used by every native request. */
export const makeClient = (endpoint: Endpoint) =>
  Effect.gen(function* () {
    const http = yield* httpDriver;
    return yield* OpenCode.make({ baseUrl: endpoint.url }).pipe(
      Effect.provideService(
        HttpClient.HttpClient,
        HttpClient.mapRequest(http, (request) =>
          HttpClientRequest.setHeaders(request, Service.headers(endpoint) ?? {}),
        ),
      ),
    );
  });

/** Single-flight successful acquisition; failure never poisons later discovery. */
export function memoSuccessful<A, E, R>(effect: Effect.Effect<A, E, R>) {
  type Entry = readonly [Effect.Effect<A, E, R>, Effect.Effect<void>];
  let entry: Entry | undefined;
  const read = Effect.suspend(() =>
    entry
      ? entry[0]
      : Effect.cachedInvalidateWithTTL(effect, (exit) =>
          Exit.isSuccess(exit) ? Duration.infinity : Duration.zero,
        ).pipe(Effect.flatMap((created) => (entry ??= created)[0])),
  );
  return { read, invalidate: Effect.suspend(() => (entry ? entry[1] : Effect.void)) };
}
