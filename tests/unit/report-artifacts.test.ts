import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { Effect } from "effect";
import { join } from "node:path";
import { mkdir, readFile, writeFile, symlink, lstat, readdir } from "node:fs/promises";
import * as Id from "../../src/identities.ts";
import { CrewError } from "../../src/domain.ts";
import { Reports } from "../../src/workflow/reports.ts";
import {
  reportHash,
  type ReportRenderer,
  validateReportHTML,
} from "../../src/workflow/report-build.ts";
import { type ReportSnapshot, snapshotJSON } from "../../templates/reporter/src/snapshot-data.ts";
import { fixture } from "../fixtures.ts";
import { run } from "../effects.ts";
const parent = Id.SessionId.make("ses_report-parent");
const issue = Id.IssueId.make("visual-issue");
const request = { request_id: Id.RequestId.make("visual-first") };
function html(snapshot: ReportSnapshot) {
  return `<!doctype html><html><body><script id="abracode-report-data" type="application/json">${snapshotJSON(snapshot)}</script><script id="abracode-license-notices" type="application/json">{}</script><script type="module">document.body.dataset.ready="true"</script></body></html>`;
}
async function prepare() {
  const f = await run(fixture);
  f.work.add(issue);
  await run(f.controller.start(issue, parent));
  await run(f.controller.recordSupervisor(parent));
  let builds = 0;
  const renderer: ReportRenderer = {
    fingerprint: Effect.succeed(reportHash("trusted-template")),
    render: (snapshot) =>
      Effect.sync(() => {
        builds++;
        return html(snapshot);
      }),
  };
  const reports = () =>
    new Reports(
      f.config.home,
      f.records,
      f.git,
      f.locks,
      f.work,
      (...args) => f.runtime.notify(...args),
      renderer,
    );
  return { f, renderer, reports, builds: () => builds };
}

test("visual artifacts retain snapshot/provenance and independent immutable identity without advancing work", async (t) => {
  const { f, reports, builds } = await prepare();
  t.onTestFinished(() => run(f.close()));
  const before = await run(f.controller.get(issue));
  const result = await run(reports().generate(parent, issue, request));
  assert.equal(result.status, "published");
  assert.equal(result.artifact!.hash, reportHash(await readFile(result.artifact!.path, "utf8")));
  assert.equal(
    result.snapshot.status,
    `${before.current_phase} · generation ${before.control_generation}`,
  );
  assert.ok(result.snapshot.checks.every((c) => c.status !== "passed"));
  assert.equal(
    result.artifact!.path,
    join(f.config.home, ".abracode/reports/generated", issue, request.request_id, "index.html"),
  );
  assert.deepEqual(await run(reports().generate(parent, issue, request)), result);
  assert.equal(builds(), 1);
  await assert.rejects(
    run(reports().generate(parent, issue, { ...request, title: "Different input" })),
    /different input/,
  );
  await assert.rejects(
    run(reports().generate(Id.SessionId.make("ses_wrong"), issue, request)),
    /Abra/,
  );
  const after = await run(f.controller.get(issue));
  assert.equal(after.current_phase, before.current_phase);
  assert.equal(after.control_generation, before.control_generation);
  assert.deepEqual(after.approval_receipts, before.approval_receipts);
  assert.deepEqual(after.configuration_snapshot, before.configuration_snapshot);
  const stale = { ...before, progress: before.progress };
  await run(f.records.save(stale));
  assert.equal(
    (await run(f.controller.get(issue))).visual_reports![0]!.artifact!.hash,
    result.artifact!.hash,
  );
  const rebound = await run(f.controller.get(issue));
  rebound.visual_reports = [
    { ...rebound.visual_reports![0]!, snapshot: { ...result.snapshot, summary: "Rebound" } },
  ];
  await assert.rejects(run(f.records.save(rebound)), /cannot be rebound/);
  await writeFile(result.artifact!.path, "tampered");
  await assert.rejects(run(reports().generate(parent, issue, request)), /digest/);
  assert.equal(builds(), 1);
});

test("failed, occupied and redirected revisions preserve a prior artifact and unrelated files", async (t) => {
  const { f, reports, renderer } = await prepare();
  t.onTestFinished(() => run(f.close()));
  const first = await run(reports().generate(parent, issue, request)),
    bytes = await readFile(first.artifact!.path, "utf8");
  const render = renderer.render.bind(renderer);
  renderer.render = () => Effect.succeed("invalid HTML");
  await assert.rejects(
    run(reports().generate(parent, issue, { request_id: Id.RequestId.make("invalid") })),
    /HTML/,
  );
  assert.equal(await readFile(first.artifact!.path, "utf8"), bytes);
  renderer.render = render;
  const occupied = join(f.config.home, ".abracode/reports/generated", issue, "occupied");
  await mkdir(occupied);
  await writeFile(join(occupied, "index.html"), "unrelated");
  await assert.rejects(
    run(reports().generate(parent, issue, { request_id: Id.RequestId.make("occupied") })),
    /occupied/,
  );
  assert.equal(await readFile(join(occupied, "index.html"), "utf8"), "unrelated");
  const outside = join(f.root, "unrelated-artifacts");
  await mkdir(outside);
  await symlink(
    outside,
    join(f.config.home, ".abracode/reports/generated", issue, "redirect"),
    "dir",
  );
  await assert.rejects(
    run(reports().generate(parent, issue, { request_id: Id.RequestId.make("redirect") })),
    /real directories/,
  );
  assert.deepEqual(await readdir(outside), []);
  assert.equal(
    (
      await lstat(join(f.config.home, ".abracode/reports/generated", issue, "redirect"))
    ).isSymbolicLink(),
    true,
  );
  assert.equal(await readFile(first.artifact!.path, "utf8"), bytes);
});

test("publication receipt loss after the atomic link is reconciled without a rebuild or replacement", async (t) => {
  const { f, reports, builds } = await prepare();
  t.onTestFinished(() => run(f.close()));
  const set = f.records.store.set.bind(f.records.store);
  let fail = true;
  f.records.store.set = (key, value) =>
    key === `execution/${issue}` && fail && JSON.stringify(value).includes('"status":"published"')
      ? ((fail = false), Effect.fail(new CrewError("STORAGE", "lost final receipt")))
      : set(key, value);
  await assert.rejects(run(reports().generate(parent, issue, request)), /lost final receipt/);
  const retained = (await run(f.controller.get(issue))).visual_reports![0]!;
  assert.equal(retained.status, "validated");
  assert.equal(builds(), 1);
  const stat = await lstat(retained.artifact!.path);
  const recovered = await run(reports().generate(parent, issue, request));
  assert.equal(recovered.status, "published");
  assert.equal(recovered.artifact!.hash, retained.artifact!.hash);
  assert.equal((await lstat(retained.artifact!.path)).ino, stat.ino);
  assert.equal(builds(), 1);
});

test("validated staging recovers before publication; uncertain missing output never silently rebuilds", async (t) => {
  const { f, reports, builds } = await prepare();
  t.onTestFinished(() => run(f.close()));
  const set = f.records.store.set.bind(f.records.store);
  let fail = true;
  f.records.store.set = (key, value) =>
    set(key, value).pipe(
      Effect.andThen(
        Effect.suspend(() =>
          key === `execution/${issue}` &&
          fail &&
          JSON.stringify(value).includes('"status":"validated"')
            ? ((fail = false), Effect.fail(new CrewError("STORAGE", "lost validation response")))
            : Effect.void,
        ),
      ),
    );
  await assert.rejects(run(reports().generate(parent, issue, request)), /lost validation/);
  const before = (await run(f.controller.get(issue))).visual_reports![0]!;
  assert.ok(before.staging);
  assert.equal(builds(), 1);
  const recovered = await run(reports().generate(parent, issue, request));
  assert.equal(recovered.status, "published");
  assert.equal(builds(), 1);
  await import("node:fs/promises").then((fs) => fs.rm(recovered.artifact!.path));
  await assert.rejects(run(reports().generate(parent, issue, request)), /ENOENT/);
  assert.equal(builds(), 1);
});

test("renderer failures retain captured input and genuine capacity contention leaves a retryable pending intent", async (t) => {
  const { f, reports, renderer } = await prepare();
  t.onTestFinished(() => run(f.close()));
  const render = renderer.render.bind(renderer);
  renderer.render = () => Effect.fail(new CrewError("LOCKED", "helper failed while owning slot"));
  await assert.rejects(run(reports().generate(parent, issue, request)), /helper failed/);
  assert.equal((await run(f.controller.get(issue))).visual_reports![0]!.status, "failed");
  renderer.render = render;
  let release!: () => void;
  const held = new Promise<void>((r) => {
    release = r;
  });
  let ready!: () => void;
  const acquired = new Promise<void>((r) => {
    ready = r;
  });
  const owner = run(
    f.locks.with(Id.LockKey.make("report-build-slot-0"), () =>
      f.locks.with(Id.LockKey.make("report-build-slot-1"), () =>
        Effect.tryPromise({
          try: async () => {
            ready();
            await held;
          },
          catch: CrewError.from,
        }),
      ),
    ),
  );
  await acquired;
  const pending = await run(reports().generate(parent, issue, request));
  assert.equal(pending.status, "pending");
  const observed = pending.snapshot.observed_at;
  release();
  await owner;
  const done = await run(reports().generate(parent, issue, request));
  assert.equal(done.status, "published");
  assert.equal(done.snapshot.observed_at, observed);
  const snapshot = done.snapshot;
  assert.throws(
    () =>
      validateReportHTML(
        html(snapshot).replace("</body>", '<img src="https://example.invalid/asset"></body>'),
        snapshot,
      ),
    /self-contained/,
  );
});

test("restart keeps uncertain compiler reservations until their deadline and the existing recovery path finishes original requests", async (t) => {
  const { Clock } = await import("effect");
  const { TestClock } = await import("effect/testing");
  const { f, reports, builds } = await prepare();
  t.onTestFinished(() => run(f.close()));
  const clock = await run(TestClock.make());
  const call = <A, E>(effect: Effect.Effect<A, E>) =>
    run(effect.pipe(Effect.provideService(Clock.Clock, clock)));
  const set = f.records.store.set.bind(f.records.store);
  const interrupted = new Set<string>();
  f.records.store.set = (key, value) =>
    set(key, value).pipe(
      Effect.andThen(
        Effect.suspend(() => {
          if (key !== `execution/${issue}`) return Effect.void;
          const builds =
            (
              value as {
                visual_reports?: Array<{ status: string; request: { request_id: string } }>;
              }
            ).visual_reports ?? [];
          const live = builds.find(
            (b) => b.status === "building" && !interrupted.has(b.request.request_id),
          );
          if (!live) return Effect.void;
          interrupted.add(live.request.request_id);
          return Effect.interrupt;
        }),
      ),
    );
  for (const id of ["interrupted-one", "interrupted-two"])
    await assert.rejects(
      call(reports().generate(parent, issue, { request_id: Id.RequestId.make(id) })),
      /interrupt/i,
    );
  f.records.store.set = set;
  const retained = (await run(f.controller.get(issue))).visual_reports!;
  assert.equal(retained.length, 2);
  assert.ok(retained.every((b) => b.status === "building" && b.deadline_at === 45000));
  await call(reports().recover());
  assert.equal(builds(), 0);
  const pending = await call(
    reports().generate(parent, issue, { request_id: Id.RequestId.make("waiting-third") }),
  );
  assert.equal(pending.status, "pending");
  assert.equal(builds(), 0);
  await call(clock.setTime(45001));
  for (let n = 0; n < 3; n++) await call(reports().recover());
  const completed = (await run(f.controller.get(issue))).visual_reports!;
  assert.equal(builds(), 3);
  assert.ok(completed.every((b) => b.status === "published"));
  for (const original of retained)
    assert.equal(
      completed.find((b) => b.request.request_id === original.request.request_id)!.input_hash,
      original.input_hash,
    );
});

test("publication result notices survive a lost native response without changing report or notification identity", async (t) => {
  const { f, reports, builds } = await prepare();
  t.onTestFinished(() => run(f.close()));
  const received = new Map<Id.MessageId, string>();
  let attempts = 0;
  f.runtime.notify = (target, text, id) =>
    Effect.suspend(() => {
      assert.equal(target, parent);
      assert.ok(id);
      attempts++;
      const prior = received.get(id);
      if (prior) assert.equal(prior, text);
      received.set(id, text);
      return attempts === 1
        ? Effect.fail(new CrewError("TRANSPORT", "lost native detail response"))
        : Effect.void;
    });
  const first = await run(reports().generate(parent, issue, request));
  assert.equal(first.status, "published");
  assert.equal(first.notices![0]!.delivered, false);
  await run(reports().recover());
  const current = (await run(f.controller.get(issue))).visual_reports![0]!;
  assert.equal(current.notices![0]!.message_id, first.notices![0]!.message_id);
  assert.equal(current.notices![0]!.delivered, true);
  assert.equal(attempts, 2);
  assert.equal(received.size, 1);
  assert.equal(builds(), 1);
  assert.equal(current.artifact!.hash, first.artifact!.hash);
});

test("a Research render request cannot capture a new generation after its Markdown publication was paused", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const project = (await run(f.records.project(Id.RepositoryId.make("frontend"))))!;
  project.plan_approval = false;
  await run(f.records.saveProject(project));
  const created = (
    await run(
      f.controller.createWork(
        {
          repository_id: Id.RepositoryId.make("frontend"),
          request_id: Id.RequestId.make("research-render-authority"),
          title: "Read source",
          description: "Retain findings",
          workflow_policy: "research-only",
          scope: {
            goal: "Read source",
            acceptance: ["Retain findings"],
            constraints: ["Read only"],
          },
        },
        parent,
      ),
    )
  ).issue;
  const e = await run(f.controller.start(created.id, parent));
  assert.ok(e.research_session_id);
  let builds = 0;
  const renderer: ReportRenderer = {
    fingerprint: f.controller
      .control(created.id, "pause")
      .pipe(Effect.as(reportHash("trusted-template"))),
    render: () =>
      Effect.sync(() => {
        builds++;
        return "unreachable";
      }),
  };
  const reports = new Reports(
    f.config.home,
    f.records,
    f.git,
    f.locks,
    f.work,
    (...args) => f.runtime.notify(...args),
    renderer,
  );
  await assert.rejects(
    run(
      reports.submit(e.research_session_id!, {
        report_id: Id.ReportId.make("authority-findings"),
        generation: e.control_generation,
        conclusions: "Source remained unchanged",
        findings: [
          {
            finding: "Original source",
            evidence: [{ base: e.base_commit!, path: Id.RelativePath.make("source.txt"), line: 1 }],
          },
        ],
        acceptance: [{ criterion: "Retain findings", met: true, evidence: "Read source.txt" }],
        limitations: [],
        render: { request_id: Id.RequestId.make("stale-render") },
      }),
    ),
    /superseded|generation/,
  );
  const current = await run(f.controller.get(created.id));
  assert.ok(current.report_receipt);
  assert.equal(current.visual_reports, undefined);
  assert.equal(builds, 0);
  assert.deepEqual(current.approval_receipts, []);
});
