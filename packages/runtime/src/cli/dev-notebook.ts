import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  type HttpClientResponse,
} from "effect/http";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Console, Effect, Redacted, Schema } from "effect";
import { resolveInstallationHome } from "../config/identity.ts";
import { loadPersonalConfig } from "../config/load.ts";
import { devNotebookPath, readDevNotebook } from "../config/memos.ts";
import { decode } from "../decode.ts";
import { CrewError } from "../domain.ts";
import { rename, rm, writeFile } from "../filesystem.ts";
import { AbsolutePath, Executable, LockKey } from "@abracode/contracts/identities";
import { ProcessRunner } from "../process.ts";
import { FileLocks } from "../storage/lock.ts";

const login = { username: "abra", password: "abra-local-dev" };
const user = Schema.Struct({ name: Schema.Literal("users/abra") });
const session = Schema.Struct({ accessToken: Schema.String, user });
const credential = Schema.Struct({
  token: Schema.String.check(Schema.isPattern(/^[!-~]+$/u)),
  personalAccessToken: Schema.Struct({ name: Schema.String }),
});

type RequestOptions = {
  method?: "POST" | "DELETE";
  headers?: Record<string, string>;
  body?: string;
};
function request(instance: string, path: string, options: RequestOptions = {}) {
  const req = HttpClientRequest.make(options.method ?? "GET")(instance + "/api/" + path, {
    headers: options.headers,
  });
  return HttpClient.execute(
    options.body === undefined
      ? req
      : HttpClientRequest.bodyText(req, options.body, "application/json"),
  ).pipe(
    Effect.timeout("10 seconds"),
    Effect.mapError(() => new CrewError("DEV_MEMOS", "Could not reach the local Memos container.")),
  );
}
function response<S extends Schema.Constraint>(
  res: HttpClientResponse.HttpClientResponse,
  schema: S,
) {
  return Effect.gen(function* () {
    if (res.status < 200 || res.status >= 300)
      return yield* new CrewError("DEV_MEMOS", `Local Memos setup failed (HTTP ${res.status}).`);
    const json = yield* res.json.pipe(
      Effect.timeout("10 seconds"),
      Effect.mapError(() => new CrewError("DEV_MEMOS", "Invalid Memos response.")),
    );
    return yield* decode(schema, json, "Local Memos setup");
  });
}
const post = (body: unknown, bearer?: string): RequestOptions => ({
  method: "POST",
  headers: {
    "content-type": "application/json",
    ...(bearer ? { Authorization: "Bearer " + bearer } : {}),
  },
  body: JSON.stringify(body),
});

export const connectDevNotebook = (sourceRoot: string) =>
  Effect.gen(function* () {
    const config = yield* loadPersonalConfig(yield* resolveInstallationHome);
    if (config.memos) return;
    const port = yield* new ProcessRunner().run(
      Executable.make("docker"),
      ["compose", "-f", "compose.yaml", "port", "memos", "5230"],
      AbsolutePath.make(sourceRoot),
    );
    if (!/^127\.0\.0\.1:\d+$/u.test(port))
      return yield* new CrewError(
        "DEV_MEMOS",
        "Expected the local Compose notebook on a loopback port.",
      );
    const instance = "http://" + port;
    const file = devNotebookPath(config);
    const persist = (token: string) =>
      Effect.gen(function* () {
        const tmp = file + "." + randomUUID() + ".tmp";
        yield* writeFile(tmp, JSON.stringify({ instance, token }) + "\n", {
          mode: 0o600,
          flag: "wx",
        }).pipe(
          Effect.andThen(rename(tmp, file)),
          Effect.ensuring(
            rm(tmp, { force: true }).pipe(
              Effect.catch((error) => Effect.logWarning("Resource cleanup failed", error)),
            ),
          ),
        );
      });
    const locks = new FileLocks(AbsolutePath.make(join(config.home, ".abracode/locks")));
    yield* locks.with(LockKey.make("dev-notebook"), () =>
      Effect.gen(function* () {
        const cached = yield* readDevNotebook(config);
        if (cached) {
          const token = Redacted.value(cached.token);
          const me = yield* request(instance, "auth/me", {
            headers: { Authorization: "Bearer " + token },
          });
          if (me.status !== 401) {
            yield* response(me, Schema.Struct({ user }));
            if (cached.instance !== instance) yield* persist(token);
            return;
          }
        }
        const profile = yield* response(
          yield* request(instance, "instance/profile"),
          Schema.Struct({ needsSetup: Schema.Boolean }),
        );
        if (profile.needsSetup)
          yield* response(yield* request(instance, "users", post(login)), user);
        const signIn = yield* request(
          instance,
          "auth/signin",
          post({ passwordCredentials: login }),
        );
        if (signIn.status === 401 || signIn.status === 403) {
          yield* Console.warn(
            "This notebook already has a different login. Configure its Memos connection in personal YAML.",
          );
          return;
        }
        const signed = yield* response(signIn, session);
        const issued = yield* response(
          yield* request(
            instance,
            signed.user.name + "/personalAccessTokens",
            post(
              { description: "AbraCode local development", expiresInDays: 0 },
              signed.accessToken,
            ),
          ),
          credential,
        );
        yield* persist(issued.token).pipe(
          Effect.onError(() =>
            request(instance, issued.personalAccessToken.name, {
              method: "DELETE",
              headers: { Authorization: "Bearer " + signed.accessToken },
            }).pipe(Effect.ignore),
          ),
        );
      }),
    );
  }).pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
  );
