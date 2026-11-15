import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Effect, Scope, Exit } from "effect";
import { webProxy } from "../../src/web/proxy.ts";
import { CrewError } from "../../src/domain.ts";

async function listen(server: Server) {
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
async function proxy(discover: Parameters<typeof webProxy>[0]["discover"]) {
  const scope = await Effect.runPromise(Scope.make());
  const web = await Effect.runPromise(
    webProxy({ port: 0, sessionID: "ses_abra", discover }).pipe(
      Effect.provideService(Scope.Scope, scope),
    ),
  );
  return { ...web, close: () => Effect.runPromise(Scope.close(scope, Exit.void)) };
}
async function stop(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((done) => server.close(() => done()));
}

test("web proxy opens Abra, authenticates internally, and isolates its host and origin", async (t) => {
  let calls = 0;
  const upstream = createServer((req, res) => {
    calls++;
    assert.equal(
      req.headers.authorization,
      `Basic ${Buffer.from("opencode:internal-secret").toString("base64")}`,
    );
    assert.equal(req.headers.cookie, undefined);
    assert.equal(req.headers["x-forwarded-host"], undefined);
    res.writeHead(200, {
      "content-type": "application/json",
      "set-cookie": "secret=value",
      "www-authenticate": "Basic",
      "access-control-allow-origin": "*",
    });
    res.end(JSON.stringify({ method: req.method, path: req.url }));
  });
  const url = await listen(upstream);
  const web = await proxy(
    Effect.succeed({
      url,
      auth: { type: "basic", username: "opencode", password: "internal-secret" },
    }),
  );
  t.onTestFinished(async () => {
    await web.close();
    await stop(upstream);
  });
  const root = await fetch(web.origin, { redirect: "manual" });
  assert.equal(root.status, 302);
  assert.equal(root.headers.get("location"), new URL(web.url).pathname);
  assert.equal(
    Buffer.from(new URL(web.url).pathname.split("/")[2], "base64url").toString(),
    web.origin,
  );
  const response = await fetch(`${web.origin}/api/test?q=1`, {
    method: "POST",
    headers: {
      authorization: "Basic client-secret",
      cookie: "browser=value",
      "x-forwarded-host": "evil.example",
      origin: web.origin,
    },
  });
  assert.deepEqual(await response.json(), { method: "POST", path: "/api/test?q=1" });
  for (const name of ["set-cookie", "www-authenticate", "access-control-allow-origin"])
    assert.equal(response.headers.get(name), null);
  const foreignHeaders: Record<string, string>[] = [
    { origin: "https://evil.example" },
    { origin: "http://127.0.0.1:9999" },
    { "sec-fetch-site": "cross-site" },
    { "sec-fetch-site": "same-site" },
  ];
  for (const headers of foreignHeaders)
    assert.equal(
      (await fetch(`${web.origin}/api/test`, { headers })).status,
      403,
      JSON.stringify(headers),
    );
  assert.equal(
    await new Promise<number | undefined>((done, reject) => {
      const req = request(
        `${web.origin}/api/test`,
        { headers: { host: "evil.example" } },
        (res) => {
          res.resume();
          done(res.statusCode);
        },
      );
      req.once("error", reject);
      req.end();
    }),
    403,
  );
  for (const path of [
    "/api/pair",
    "/api/pair/",
    "/api/%70air",
    "/auth/connect/code",
    "/%61uth/connect/code",
  ])
    assert.equal((await fetch(web.origin + path)).status, 404);
  assert.equal(calls, 1, "Refused requests must not reach the authenticated service");
});

test("an occupied web port fails without stopping the process that owns it", async (t) => {
  const incumbent = createServer((_req, res) => res.end("incumbent"));
  const origin = await listen(incumbent);
  t.onTestFinished(() => stop(incumbent));
  await assert.rejects(
    Effect.runPromise(
      Effect.scoped(
        webProxy({
          port: Number(new URL(origin).port),
          sessionID: "ses_abra",
          discover: Effect.undefined,
        }),
      ),
    ),
    /WEB_LISTEN|Choose another with --port/,
  );
  assert.equal(await (await fetch(origin)).text(), "incumbent");
});

test("web proxy streams uploads and events without buffering and closes active streams", async (t) => {
  let next: (() => void) | undefined;
  let uploaded = "";
  const upstream = createServer((req, res) => {
    req.on("data", (chunk) => {
      uploaded += chunk.toString();
    });
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write("data: first\n\n");
    next = () => res.write("data: second\n\n");
  });
  const url = await listen(upstream);
  const web = await proxy(Effect.succeed({ url }));
  t.onTestFinished(async () => {
    await web.close();
    await stop(upstream);
  });
  const res = await fetch(`${web.origin}/api/events`, { method: "POST", body: "upload" });
  const reader = res.body!.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), "data: first\n\n");
  assert.equal(uploaded, "upload");
  next!();
  assert.equal(new TextDecoder().decode((await reader.read()).value), "data: second\n\n");
  await web.close();
  await assert.rejects(reader.read());
  assert.equal(upstream.listening, true, "Proxy shutdown does not stop the native service");
});

test("web proxy rediscovers endpoints and never replays a disconnected submission", async (t) => {
  let attempts = 0;
  const first = createServer((req) => {
    attempts++;
    req.destroy();
  });
  const firstURL = await listen(first);
  const second = createServer((req, res) => {
    assert.equal(
      req.headers.authorization,
      `Basic ${Buffer.from("opencode:new-secret").toString("base64")}`,
    );
    res.end("reconnected");
  });
  const secondURL = await listen(second);
  let endpoint:
    | { url: string; auth?: { type: "basic"; username: string; password: string } }
    | undefined = { url: firstURL };
  const web = await proxy(Effect.sync(() => endpoint));
  t.onTestFinished(async () => {
    await web.close();
    await stop(first);
    await stop(second);
  });
  const failed = await fetch(`${web.origin}/api/prompt`, { method: "POST", body: "once" });
  assert.equal(failed.status, 502);
  assert.equal(attempts, 1);
  endpoint = {
    url: secondURL,
    auth: { type: "basic", username: "opencode", password: "new-secret" },
  };
  assert.equal(await (await fetch(`${web.origin}/api/info`)).text(), "reconnected");
  endpoint = undefined;
  assert.equal((await fetch(`${web.origin}/api/info`)).status, 502);
  endpoint = { url: "http://example.com" };
  assert.equal((await fetch(`${web.origin}/api/info`)).status, 502);
  assert.equal(attempts, 1);
  const unavailable = await proxy(
    Effect.fail(new CrewError("TEST", "must not leak internal-secret")),
  );
  try {
    assert.doesNotMatch(
      await (await fetch(`${unavailable.origin}/api/info`)).text(),
      /internal-secret/,
    );
  } finally {
    await unavailable.close();
  }
});

test("legacy form projection preserves checkpoint identities and answers", async (t) => {
  const form = {
    id: "frm_exact",
    sessionID: "ses_abra",
    title: "Exact checkpoint",
    metadata: { source: "abracode", fingerprint: "same-head" },
    fields: [{ key: "authorize", type: "boolean", default: false }],
    state: { status: "pending" },
  };
  let answer = "";
  const upstream = createServer((req, res) => {
    if (req.method === "POST") {
      req.on("data", (chunk) => {
        answer += chunk.toString();
      });
      req.on("end", () => {
        res.end("{}");
      });
      return;
    }
    assert.equal(req.headers["accept-encoding"], "identity");
    const body = JSON.stringify({
      data: [form, { ...form, id: "other", metadata: { source: "other-plugin" } }],
    });
    res.writeHead(200, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body),
      etag: "old-body",
    });
    res.end(body);
  });
  const url = await listen(upstream);
  const web = await proxy(Effect.succeed({ url }));
  t.onTestFinished(async () => {
    await web.close();
    await stop(upstream);
  });
  const res = await fetch(`${web.origin}/api/session/ses_abra/form`);
  assert.equal(res.headers.get("content-length"), null);
  assert.equal(res.headers.get("etag"), null);
  const projected = (await res.json()) as {
    data: Array<typeof form & { metadata: { kind?: string } }>;
  };
  assert.deepEqual(projected.data[0], {
    ...form,
    metadata: { ...form.metadata, kind: "mcp-elicitation" },
  });
  assert.equal(projected.data[1].metadata.kind, undefined);
  await fetch(`${web.origin}/api/session/ses_abra/form/frm_exact/reply`, {
    method: "POST",
    body: '{"answer":{"authorize":false}}',
  });
  assert.equal(answer, '{"answer":{"authorize":false}}');
  assert.deepEqual(form.metadata, { source: "abracode", fingerprint: "same-head" });
});

test("web proxy authenticates WebSocket upgrades, preserves bytes, and rejects foreign origins", async (t) => {
  let upgrades = 0;
  const upstream = createServer();
  const upstreamSockets = new Set<import("node:stream").Duplex>();
  upstream.on("upgrade", (req, socket, head) => {
    upgrades++;
    assert.equal(
      req.headers.authorization,
      `Basic ${Buffer.from("opencode:ws-secret").toString("base64")}`,
    );
    upstreamSockets.add(socket);
    socket.once("close", () => upstreamSockets.delete(socket));
    socket.on("error", () => {});
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\nhello",
    );
    if (head.length) socket.write(head);
    socket.pipe(socket);
  });
  const url = await listen(upstream);
  const web = await proxy(
    Effect.succeed({ url, auth: { type: "basic", username: "opencode", password: "ws-secret" } }),
  );
  t.onTestFinished(async () => {
    await web.close();
    for (const socket of upstreamSockets) socket.destroy();
    await stop(upstream);
  });
  for (const origin of ["https://evil.example", undefined]) {
    const status = await new Promise<number | undefined>((done, reject) => {
      const req = request(`${web.origin}/api/ws`, {
        headers: { connection: "Upgrade", upgrade: "websocket", ...(origin ? { origin } : {}) },
      });
      req.once("response", (res) => {
        res.resume();
        done(res.statusCode);
      });
      req.once("error", reject);
      req.end();
    });
    assert.equal(status, 403);
  }
  await new Promise<void>((done, reject) => {
    const req = request(`${web.origin}/api/ws`, {
      headers: { connection: "Upgrade", upgrade: "websocket", origin: web.origin },
    });
    req.once("error", reject);
    req.once("upgrade", (_res, socket, head) => {
      let received = head.toString();
      socket.on("error", reject);
      socket.on("data", (chunk) => {
        received += chunk.toString();
        if (received === "helloping") {
          socket.destroy();
          done();
        }
      });
      socket.write("ping");
    });
    req.end();
  });
  assert.equal(upgrades, 1);
});
