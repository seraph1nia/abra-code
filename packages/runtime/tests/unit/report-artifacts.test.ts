import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { Effect } from "effect";
import { join } from "node:path";
import { mkdir, readFile, writeFile, symlink, lstat, rm, link } from "node:fs/promises";
import * as Id from "@abracode/contracts/identities";
import { CrewError } from "../../src/domain.ts";
import { Reports } from "../../src/reporting/reports.ts";
import { reportHash, validateReportHTML } from "../../src/reporting/report-build.ts";
import { snapshotJSON } from "@abracode/contracts/presentation/report-evidence";
import { captureReportSnapshot } from "../../src/reporting/report-snapshot.ts";
import type { VisualBuild } from "../../src/reporting/report-contracts.ts";
import { fixture } from "../fixtures.ts";
import { run } from "../effects.ts";
const parent = Id.SessionId.make("ses_legacy-parent"),
  issue = Id.IssueId.make("legacy-report");
async function prepare(
  status: VisualBuild["status"] = "published",
  embedded?: string,
  title?: string,
) {
  const f = await run(fixture);
  f.seed.named(issue);
  const e = await run(f.controller.start(issue, parent));
  await run(f.controller.recordSupervisor(parent));
  const snapshot = await run(captureReportSnapshot(f.work, e));
  const html = `<!doctype html><html><body><script type="application/json" id="abracode-report-data">${embedded ?? snapshotJSON(snapshot)}</script><script type="application/json" id="abracode-license-notices">{}</script></body></html>`;
  const request = { request_id: Id.RequestId.make("original-legacy"), ...(title && { title }) };
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

test("report discovery keeps equally titled published revisions separate when artifact bytes are offline", async (t) => {
  const { f, build, path } = await prepare("published", undefined, "Evidence report");
  t.onTestFinished(() => run(f.close()));
  const another = Id.RequestId.make("revised-report");
  const hash = reportHash("revised evidence");
  await run(
    f.records.update(issue, (current) => ({
      ...current,
      visual_reports: [
        build,
        {
          ...build,
          request: { request_id: another, title: "Evidence report" },
          artifact: { ...build.artifact!, request_id: another, hash },
        },
      ],
    })),
  );
  await rm(path);
  const result = await run(
    f.controller.queries.discoverEvidence({
      issue_id: issue,
      kind: "report",
      search: "Evidence report",
    }),
  );
  assert.equal(result.entries.length, 2);
  assert.deepEqual(
    new Set(
      result.entries.map((hit) => hit.resource?.action === "open_artifact" && hit.resource.hash),
    ),
    new Set([build.artifact!.hash, hash]),
  );
});

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

test("record writes allow report progress and preserve the prior record on history violations", async (t) => {
  const { f, build } = await prepare("validated");
  t.onTestFinished(() => run(f.close()));
  const update = (visual_reports: VisualBuild[] | undefined) =>
    f.records.update(issue, (e) => ({ ...e, visual_reports }));
  const notice = {
    phase: "published" as const,
    text: "Report ready",
    message_id: Id.MessageId.make("msg_report"),
    delivered: false,
  };
  await run(update([{ ...build, status: "published", notices: [notice] }]));
  const delivered = { ...notice, delivered: true, associated: true };
  const published: VisualBuild = { ...build, status: "published", notices: [delivered] };
  await run(update([published]));
  const before = await run(f.records.execution(issue));
  assert.deepEqual(before?.visual_reports?.[0]?.notices, [delivered]);
  const violations: (VisualBuild[] | undefined)[] = [
    undefined,
    [],
    [{ ...published, request: { ...build.request, title: "Rebound" } }],
    [{ ...published, artifact: undefined }],
    [{ ...published, status: "validated" }],
    [{ ...published, notices: [] }],
    [{ ...published, notices: [{ ...delivered, text: "Changed" }] }],
    [{ ...published, notices: [{ ...delivered, delivered: false }] }],
    [{ ...published, notices: [{ ...delivered, associated: false }] }],
  ];
  for (const reports of violations) {
    assert.equal((await run(Effect.flip(update(reports)))).code, "REPORT_HISTORY");
    assert.deepEqual(await run(f.records.execution(issue)), before);
  }
});

test("legacy report reads diagnose corrupt embedded JSON even when its file digest matches", async (t) => {
  const { f, reports, request, path, html } = await prepare("published", "{");
  t.onTestFinished(() => run(f.close()));
  const failure = await run(Effect.flip(reports().readArtifact(issue, request.request_id)));
  assert.equal(failure.code, "REPORT_HTML");
  assert.equal(await readFile(path, "utf8"), html);
});
