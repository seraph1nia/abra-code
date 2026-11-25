import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { Effect } from "effect";
import { rm } from "node:fs/promises";
import * as Id from "@abracode/contracts/identities";
import { Reports } from "../../src/reporting/reports.ts";
import { reportHash } from "../../src/reporting/report-build.ts";
import type { VisualBuild } from "../../src/reporting/report-contracts.ts";
import { fixture } from "../fixtures.ts";
import { run } from "../effects.ts";
const parent = Id.SessionId.make("ses_legacy-parent"),
  issue = Id.IssueId.make("legacy-report");
async function prepare() {
  const f = await run(fixture);
  f.seed.named(issue);
  await run(f.controller.start(issue, parent));
  await run(f.controller.recordSupervisor(parent));
  const reports = new Reports(f.config.home, f.records, f.git, f.locks, f.work, (...args) =>
    f.runtime.notify(...args),
  );
  const request = { request_id: Id.RequestId.make("evidence-report"), title: "Evidence report" };
  const build = await run(reports.generate(parent, issue, request));
  return { f, build, path: build.artifact!.path };
}

test("report discovery keeps equally titled published revisions separate when artifact bytes are offline", async (t) => {
  const { f, build, path } = await prepare();
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

test("record writes allow report progress and preserve the prior record on history violations", async (t) => {
  const { f, build } = await prepare();
  t.onTestFinished(() => run(f.close()));
  const update = (visual_reports: VisualBuild[] | undefined) =>
    f.records.update(issue, (e) => ({ ...e, visual_reports }));
  const published = build;
  const before = await run(f.records.execution(issue));
  const violations: (VisualBuild[] | undefined)[] = [
    undefined,
    [],
    [{ ...published, request: { ...build.request, title: "Rebound" } }],
    [{ ...published, artifact: undefined }],
    [{ ...published, status: "validated" }],
    [{ ...published, notices: [] }],
  ];
  for (const reports of violations) {
    assert.equal((await run(Effect.flip(update(reports)))).code, "REPORT_HISTORY");
    assert.deepEqual(await run(f.records.execution(issue)), before);
  }
});
