import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { Effect } from "effect";
import { join } from "node:path";
import { mkdir, readFile, writeFile, symlink, lstat, rm, link } from "node:fs/promises";
import * as Id from "../../src/identities.ts";
import { CrewError } from "../../src/domain.ts";
import { Reports } from "../../src/workflow/reports.ts";
import { reportHash, validateReportHTML } from "../../src/workflow/report-build.ts";
import { snapshotJSON } from "../../src/presentation/report-evidence.ts";
import { captureReportSnapshot } from "../../src/workflow/report-snapshot.ts";
import type { VisualBuild } from "../../src/workflow/report-contracts.ts";
import { fixture } from "../fixtures.ts";
import { run } from "../effects.ts";
const parent = Id.SessionId.make("ses_legacy-parent"),
  issue = Id.IssueId.make("legacy-report");
async function prepare(status: VisualBuild["status"] = "published") {
  const f = await run(fixture);
  f.work.add(issue);
  const e = await run(f.controller.start(issue, parent));
  await run(f.controller.recordSupervisor(parent));
  const snapshot = await run(captureReportSnapshot(f.work, e));
  const html = `<!doctype html><html><body><script type="application/json" id="abracode-report-data">${snapshotJSON(snapshot)}</script><script type="application/json" id="abracode-license-notices">{}</script></body></html>`;
  const request = { request_id: Id.RequestId.make("original-legacy") };
  const directory = join(f.config.home, ".abracode/reports/generated", issue, request.request_id);
  await mkdir(directory, { recursive: true });
  const path = Id.AbsolutePath.make(join(directory, "index.html")),
    staging = Id.AbsolutePath.make(join(directory, ".stage-original.html"));
  const artifact = {
    schema_version: 1 as const,
    request_id: request.request_id,
    issue_id: issue,
    execution_id: e.execution_id,
    generation: e.control_generation,
    input_hash: reportHash(JSON.stringify(snapshot)),
    template_hash: reportHash("retired-solid-template"),
    hash: reportHash(html),
    bytes: Buffer.byteLength(html),
    path,
    observed_at: Id.Timestamp.make(snapshot.observed_at),
  };
  const build: VisualBuild = {
    request,
    requested_by: parent,
    generation: e.control_generation,
    snapshot,
    input_hash: artifact.input_hash,
    template_hash: artifact.template_hash,
    status,
    ...(status === "published" || status === "validated" ? { artifact } : {}),
    ...(status === "validated" ? { staging } : {}),
  };
  if (status === "published") await writeFile(path, html);
  if (status === "validated") await writeFile(staging, html);
  await run(f.records.update(issue, (current) => ({ ...current, visual_reports: [build] })));
  const reports = () =>
    new Reports(f.config.home, f.records, f.git, f.locks, f.work, (...args) =>
      f.runtime.notify(...args),
    );
  return { f, reports, build, request, html, path, staging };
}

test("published legacy HTML retains original identity and bytes while new requests default to JSON", async (t) => {
  const { f, reports, build, request, html, path } = await prepare();
  t.onTestFinished(() => run(f.close()));
  const inode = (await lstat(path)).ino;
  assert.deepEqual(await run(reports().generate(parent, issue, request)), build);
  assert.equal((await run(reports().readArtifact(issue, request.request_id))).html, html);
  assert.equal((await lstat(path)).ino, inode);
  await assert.rejects(
    run(reports().generate(parent, issue, { ...request, title: "Changed input" })),
    /different input/,
  );
  const next = await run(
    reports().generate(parent, issue, { request_id: Id.RequestId.make("new-json-request") }),
  );
  assert.equal(next.artifact?.schema_version, 2);
  assert.equal(next.format, "a2ui-snapshot");
  assert.equal(await readFile(path, "utf8"), html);
  const current = await run(f.records.execution(issue));
  assert.equal(current?.control_generation, build.generation);
});

test("validated legacy staging and publication receipt loss reconcile without a compiler or replacement", async (t) => {
  const { f, reports, request, html, path, staging } = await prepare("validated");
  t.onTestFinished(() => run(f.close()));
  await link(staging, path);
  const inode = (await lstat(path)).ino;
  const set = f.records.store.set.bind(f.records.store);
  let lost = true;
  f.records.store.set = (key, value) =>
    set(key, value).pipe(
      Effect.andThen(
        Effect.suspend(() => {
          if (
            lost &&
            key === `execution/${issue}` &&
            JSON.stringify(value).includes('"status":"published"')
          ) {
            lost = false;
            return Effect.fail(new CrewError("STORAGE", "lost publication response"));
          }
          return Effect.void;
        }),
      ),
    );
  await assert.rejects(run(reports().generate(parent, issue, request)), /lost publication/);
  f.records.store.set = set;
  const retried = await run(reports().generate(parent, issue, request));
  assert.equal(retried.status, "published");
  assert.equal((await lstat(path)).ino, inode);
  assert.equal(await readFile(path, "utf8"), html);
  await rm(path);
  await assert.rejects(run(reports().generate(parent, issue, request)), /ENOENT/);
});

test("unfinished legacy builds preserve captured input and become explicitly unavailable", async (t) => {
  const { f, reports, build, request, staging } = await prepare("pending");
  t.onTestFinished(() => run(f.close()));
  await writeFile(staging, "Unvalidated old compiler evidence");
  const result = await run(reports().generate(parent, issue, request));
  assert.equal(result.status, "failed");
  assert.match(result.error!, /compiler is retired/);
  assert.deepEqual(result.snapshot, build.snapshot);
  assert.equal(result.input_hash, build.input_hash);
  assert.equal(result.template_hash, build.template_hash);
  assert.equal(result.artifact, undefined);
  assert.equal(await readFile(staging, "utf8"), "Unvalidated old compiler evidence");
  await run(reports().recover());
  assert.equal((await run(f.records.execution(issue)))?.visual_reports?.length, 1);
});

test("legacy reads and original-request retries reject altered or redirected bytes", async (t) => {
  const { f, reports, request, html, path } = await prepare();
  t.onTestFinished(() => run(f.close()));
  validateReportHTML(html, (await run(f.records.execution(issue)))!.visual_reports![0]!.snapshot);
  await writeFile(path, "tampered");
  await assert.rejects(run(reports().generate(parent, issue, request)), /digest|hash/);
  assert.equal(await readFile(path, "utf8"), "tampered");
  await rm(path);
  const external = join(f.root, "unrelated.html");
  await writeFile(external, html);
  await symlink(external, path);
  await assert.rejects(
    run(reports().readArtifact(issue, request.request_id)),
    /regular|symbolic|owned/,
  );
  assert.equal(await readFile(external, "utf8"), html);
});
