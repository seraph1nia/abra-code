import { Effect, Exit, Scope } from "effect";
import { HttpApiClient } from "effect/http-api";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { workspaceApi } from "@abracode/contracts/web/http-api";
import { workspaceServer } from "../../src/web/server.ts";
import { WorkspaceFixture } from "./web.ts";
export async function fixture(assets?: string, configure?: (backend: WorkspaceFixture) => void) {
  const backend = new WorkspaceFixture();
  configure?.(backend);
  const scope = await Effect.runPromise(Scope.make());
  const web = await Effect.runPromise(
    workspaceServer({ port: 0, backend, assets }).pipe(Effect.provideService(Scope.Scope, scope)),
  );
  const client = await Effect.runPromise(
    HttpApiClient.make(workspaceApi, {
      baseUrl: web.origin,
      transformClient: (client) =>
        HttpClient.mapRequest(client, HttpClientRequest.setHeader("origin", web.origin)),
    }).pipe(Effect.provide(FetchHttpClient.layer)),
  );
  return { ...web, backend, client, close: () => Effect.runPromise(Scope.close(scope, Exit.void)) };
}
