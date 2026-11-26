import { workCatalogDocument } from "@abracode/contracts/web/catalog";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { Effect } from "effect";
import { RequestId, ContentHash } from "@abracode/contracts/identities";
import { fixture } from "../helpers/workspace-http.ts";
test("snapshot saves reject invalid or executable inputs before entering the artifact owner", async (t) => {
  const web = await fixture();
  t.onTestFinished(web.close);
  let saves = 0;
  const original = web.backend.saveSurface;
  web.backend.saveSurface = (input) => {
    saves++;
    return original(input);
  };
  const valid = {
    issue_id: "abra-web",
    request_id: "snapshot-request",
    surface_id: "workView",
    revision: 1,
  };
  for (const update of [
    { revision: 0 },
    { revision: -1 },
    { surface_id: "../secret" },
    { action: "approve" },
    { document: { html: "<script>execute()</script>" } },
  ]) {
    const response = await fetch(`${web.origin}/api/report/save-surface`, {
      method: "POST",
      headers: { origin: web.origin, "content-type": "application/json" },
      body: JSON.stringify({ ...valid, ...update }),
    });
    assert.equal(response.status, 400);
  }
  assert.equal(saves, 0);
  assert.equal(
    (
      await fetch(`${web.origin}/api/report/save-surface`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(valid),
      })
    ).status,
    403,
  );
  assert.equal(saves, 0);
});

test("Effect HTTP boundary rejects foreign origins, raw native routes and encoded traversal", async (t) => {
  const web = await fixture();
  t.onTestFinished(web.close);
  for (const path of [
    "/api/session",
    "/api/server",
    "/api/auth",
    "/api/pair",
    "/api/copilotkit/threads",
    "/api/copilotkit/agent/worker/run",
  ]) {
    assert.equal((await fetch(`${web.origin}${path}`)).status, 404, path);
  }
  assert.equal(
    (await fetch(`${web.origin}/api/bootstrap`, { headers: { origin: "http://localhost:1" } }))
      .status,
    403,
  );
  assert.equal(
    (
      await fetch(`${web.origin}/api/copilotkit/agent/abra/stop/${web.backend.sessionID}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      })
    ).status,
    403,
  );
  assert.equal(web.backend.stops, 0);
  const status = await new Promise<number>((resolve, reject) => {
    const req = request(web.origin, { path: "/assets/%2e%2e/package.json" }, (res) => {
      res.resume();
      resolve(res.statusCode!);
    });
    req.on("error", reject);
    req.end();
  });
  assert.equal(status, 400);
  const rebound = await new Promise<number>((resolve, reject) => {
    const req = request(
      web.origin,
      { path: "/api/bootstrap", headers: { host: "evil.local" } },
      (res) => {
        res.resume();
        resolve(res.statusCode!);
      },
    );
    req.on("error", reject);
    req.end();
  });
  assert.equal(rebound, 403);
});

test("retired HTML artifact routes are unavailable", async (t) => {
  const web = await fixture();
  t.onTestFinished(web.close);
  const query = {
    issue_id: web.backend.value.work.work[0].issue_id,
    request_id: RequestId.make("published-report"),
  };
  for (const path of ["preview", "download"]) {
    assert.equal(
      (await fetch(web.origin + "/api/report/" + path + "?" + new URLSearchParams(query))).status,
      404,
    );
  }
});

test("explicit report exports use fixed identities and opaque preview without prompt submission", async (t) => {
  const web = await fixture();
  t.onTestFinished(web.close);
  const query = {
    issue_id: web.backend.value.work.work[0].issue_id,
    request_id: RequestId.make("exported-report"),
    hash: ContentHash.make("a".repeat(64)),
  };
  let exports = 0,
    reads = 0;
  const receipt = {
    document_hash: query.hash,
    exporter_hash: ContentHash.make("b".repeat(64)),
    hash: ContentHash.make("c".repeat(64)),
    bytes: 42,
  };
  web.backend.exportDocument = () =>
    Effect.sync(() => {
      exports++;
      return receipt;
    });
  web.backend.readExport = () =>
    Effect.sync(() => {
      reads++;
      return { ...receipt, html: "<!doctype html><p>Exported evidence</p>" };
    });
  const invalid = await fetch(`${web.origin}/api/report/export`, {
    method: "POST",
    headers: { origin: web.origin, "content-type": "application/json" },
    body: JSON.stringify({ ...query, path: "/private" }),
  });
  assert.equal(invalid.status, 400);
  assert.equal(exports, 0);
  assert.deepEqual(
    await Effect.runPromise(web.client.work.exportDocument({ payload: query })),
    receipt,
  );
  assert.equal(exports, 1);
  const url = new URLSearchParams({ ...query, exporter_hash: receipt.exporter_hash });
  const preview = await fetch(`${web.origin}/api/report/export/preview?${url}`);
  assert.match(await preview.text(), /Exported evidence/);
  assert.match(preview.headers.get("content-security-policy") ?? "", /sandbox allow-scripts/);
  assert.doesNotMatch(preview.headers.get("content-security-policy") ?? "", /allow-same-origin/);
  const download = await fetch(`${web.origin}/api/report/export/download?${url}`);
  assert.match(
    download.headers.get("content-disposition") ?? "",
    /attachment; filename="abra-report-exported-report.html"/,
  );
  assert.equal(reads, 2);
  assert.equal(exports, 1);
  assert.equal(web.backend.submissions, 0);
  assert.equal(web.backend.stops, 0);
});

test("workspace serves the exact versioned discovery documents", async (t) => {
  const web = await fixture();
  t.onTestFinished(web.close);
  const response = await fetch(web.origin + "/catalog/work/v1/catalog.json");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), workCatalogDocument);
  assert.equal((await fetch(web.origin + "/catalog/work-v5.json")).status, 404);
});

test("hashed public assets cache immutably and use package compression while private responses stay fresh", async (t) => {
  const assets = await mkdtemp(join(tmpdir(), "abra-web-assets-"));
  t.onTestFinished(() => rm(assets, { recursive: true, force: true }));
  await mkdir(join(assets, "assets"));
  const first = "export const greeting = 'hello';\n".repeat(256);
  const second = first + "export const version = 2;\n";
  await writeFile(join(assets, "index.html"), "<!doctype html><p>Current app</p>");
  await writeFile(join(assets, "assets", "app-abc12345.js"), first);
  await writeFile(join(assets, "assets", "app-def67890.js"), second);
  await writeFile(join(assets, "assets", "mutable.js"), first);
  const web = await fixture(assets);
  t.onTestFinished(web.close);
  const assetURL = web.origin + "/assets/app-abc12345.js";
  const response = await fetch(assetURL);
  assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal(await response.text(), first);
  assert.equal(await (await fetch(assetURL)).text(), first);
  assert.equal(await (await fetch(web.origin + "/assets/app-def67890.js")).text(), second);
  const compressed = await new Promise<{ body: Buffer; encoding?: string; vary?: string }>(
    (resolve, reject) => {
      request(assetURL, { headers: { "accept-encoding": "gzip" } }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () =>
          resolve({
            body: Buffer.concat(chunks),
            encoding: response.headers["content-encoding"],
            vary: response.headers.vary,
          }),
        );
        response.on("error", reject);
      })
        .on("error", reject)
        .end();
    },
  );
  assert.equal(compressed.encoding, "gzip");
  assert.match(compressed.vary ?? "", /accept-encoding/i);
  assert.equal(gunzipSync(compressed.body).toString(), first);
  assert.ok(compressed.body.length < Buffer.byteLength(first) / 2);
  for (const path of ["/", "/api/bootstrap", "/assets/mutable.js", "/assets/missing-abc12345.js"]) {
    const response = await fetch(web.origin + path);
    assert.equal(response.headers.get("cache-control"), "no-store", path);
  }
  const forbidden = await fetch(assetURL, { headers: { origin: "https://foreign.example" } });
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.headers.get("cache-control"), "no-store");
});
