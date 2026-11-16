import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { Effect } from "effect";
import { mkdir, readFile, writeFile, rm, lstat, symlink } from "node:fs/promises";
import { join } from "node:path";
import { fixture, planned } from "../fixtures.ts";
import { run } from "../effects.ts";
import { reportDocument } from "../helpers/report-document.ts";
import { RequestId, SessionId, ContentHash, MessageId } from "../../src/identities.ts";
import { SurfacePublications } from "../../src/web/surface-publications.ts";
import { validateSurface, catalogId } from "../../src/web/surfaces.ts";
import { Visibility } from "../../src/visibility/read-model.ts";
import { PresentationAssociations } from "../../src/presentation/associations.ts";
import { CrewError } from "../../src/domain.ts";
import { ReportDocuments } from "../../src/workflow/report-documents.ts";
import { validateReportDocument } from "../../src/presentation/report-document.ts";
import { reportHash } from "../../src/workflow/report-build.ts";

async function prepare() {
  const f = await run(fixture);
  const execution = await run(planned(f));
  const session = SessionId.make("ses_report-capture");
  const documents = () => new ReportDocuments(f.config.home, f.records, f.locks);
  let captures = 0;
  const save = (id = "first-document", title = "Original captured title") =>
    documents().save(
      execution.issue_id,
      session,
      { request_id: RequestId.make(id) },
      (current, revision) =>
        Effect.sync(() => {
          captures++;
          const original = reportDocument();
          const document = validateReportDocument({
            ...original,
            document_id: id,
            revision,
            title,
            provenance: {
              ...original.provenance,
              issue_id: current.issue_id,
              execution_id: current.execution_id,
              generation: current.control_generation,
            },
            surface: {
              ...original.surface,
              createSurface: {
                ...original.surface.createSurface,
                components: original.surface.createSurface.components.map((component) =>
                  component.component === "WorkTable"
                    ? { ...component, issueIds: [current.issue_id] }
                    : component,
                ),
              },
            },
            data: {
              ...original.data,
              work: original.data.work.map((work) => ({ ...work, issue_id: current.issue_id })),
              snapshot_work: original.data.snapshot_work?.map((work) => ({
                ...work,
                issue_id: current.issue_id,
              })),
              evidence: {
                ...original.data.evidence!,
                issue_id: current.issue_id,
                execution_id: current.execution_id,
              },
            },
          });
          return { document, snapshot: document.data.evidence! };
        }),
    );
  return { f, execution, save, documents, captures: () => captures };
}

test("JSON publication freezes immutable bytes across concurrent requests, retries and a new owner", async (t) => {
  const f = await prepare();
  t.onTestFinished(() => run(f.f.close()));
  const before = await run(f.f.records.execution(f.execution.issue_id));
  const [first, retry] = await Promise.all([run(f.save()), run(f.save())]);
  assert.deepEqual(first, retry);
  assert.equal(f.captures(), 1);
  await assert.rejects(
    run(
      f
        .documents()
        .save(
          f.execution.issue_id,
          SessionId.make("ses_report-capture"),
          { request_id: first.request.request_id, title: "Changed request input" },
          () => Effect.fail(new CrewError("TEST", "Must not recapture")),
        ),
    ),
    /different input/,
  );
  assert.equal(first.status, "published");
  assert.equal(first.document_input, undefined);
  assert.equal(first.artifact?.schema_version, 2);
  const read = await run(
    f.documents().read(f.execution.issue_id, first.request.request_id, first.artifact!.hash),
  );
  assert.equal(read.json, await readFile(first.artifact!.path, "utf8"));
  assert.equal(reportHash(read.json), read.hash);
  assert.equal(JSON.parse(read.json).title, "Original captured title");
  await run(f.save("first-document", "Later live title must not be captured"));
  assert.equal(f.captures(), 1);
  const [second, third] = await Promise.all([
    run(f.save("second-document", "Later capture")),
    run(f.save("third-document")),
  ]);
  assert.deepEqual(
    [second.artifact, third.artifact]
      .map((a) => (a?.schema_version === 2 ? a.revision : 0))
      .sort((a, b) => a - b),
    [2, 3],
  );
  assert.equal(
    (
      await run(
        f.documents().read(f.execution.issue_id, first.request.request_id, first.artifact!.hash),
      )
    ).json,
    read.json,
  );
  await assert.rejects(
    run(
      f
        .documents()
        .read(f.execution.issue_id, first.request.request_id, ContentHash.make("f".repeat(64))),
    ),
    /unavailable/,
  );
  const after = await run(f.f.records.execution(f.execution.issue_id));
  assert.equal(after!.current_phase, before!.current_phase);
  assert.deepEqual(after!.approval_receipts, before!.approval_receipts);
});

test("validated JSON staging and lost publication receipts reconcile without recapture", async (t) => {
  const f = await prepare();
  t.onTestFinished(() => run(f.f.close()));
  const set = f.f.records.store.set.bind(f.f.records.store);
  let fail = "validated";
  f.f.records.store.set = (key, value) =>
    set(key, value).pipe(
      Effect.andThen(
        Effect.suspend(() => {
          if (
            key === `execution/${f.execution.issue_id}` &&
            fail &&
            JSON.stringify(value).includes(`"status":"${fail}"`)
          ) {
            const phase = fail;
            fail = "";
            return Effect.fail(new CrewError("STORAGE", `Lost ${phase} response`));
          }
          return Effect.void;
        }),
      ),
    );
  await assert.rejects(run(f.save()), /Lost validated/);
  const staged = (await run(f.f.records.execution(f.execution.issue_id)))!.visual_reports![0];
  assert.ok(staged.staging);
  assert.equal(f.captures(), 1);
  fail = "published";
  await assert.rejects(run(f.save()), /Lost published/);
  const inode = await lstat(staged.artifact!.path);
  const recovered = await run(f.save());
  assert.equal(recovered.status, "published");
  assert.equal((await lstat(staged.artifact!.path)).ino, inode.ino);
  assert.equal(f.captures(), 1);
  await rm(staged.artifact!.path);
  await assert.rejects(run(f.save()), /ENOENT/);
  assert.equal(f.captures(), 1);
});

test("occupied JSON paths and corrupted artifacts preserve prior publications and unrelated files", async (t) => {
  const f = await prepare();
  t.onTestFinished(() => run(f.f.close()));
  const first = await run(f.save());
  const bytes = await readFile(first.artifact!.path, "utf8");
  const directory = join(
    f.f.config.home,
    ".abracode/reports/generated",
    f.execution.issue_id,
    "occupied-document",
  );
  await mkdir(directory);
  await writeFile(join(directory, "index.json"), "Unrelated bytes");
  await assert.rejects(run(f.save("occupied-document")), /occupied/);
  assert.equal(await readFile(join(directory, "index.json"), "utf8"), "Unrelated bytes");
  assert.equal(await readFile(first.artifact!.path, "utf8"), bytes);
  await writeFile(first.artifact!.path, bytes + " ");
  await assert.rejects(run(f.save()), /digest/);
  const unrelated = join(f.f.root, "unrelated-document.json");
  await writeFile(unrelated, bytes);
  await rm(first.artifact!.path);
  await symlink(unrelated, first.artifact!.path);
  await assert.rejects(
    run(f.documents().read(f.execution.issue_id, first.request.request_id, first.artifact!.hash)),
    /owned regular file/,
  );
  assert.equal(await readFile(unrelated, "utf8"), bytes);
});

test("the report owner saves the exact observed surface without a research receipt or provider turn", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const execution = await run(planned(f));
  const session = SessionId.make("ses_saved-surface");
  await run(f.controller.recordSupervisor(session));
  const publications = new SurfacePublications(f.records.store, f.locks);
  const surface = validateSurface({
    version: "1.0",
    createSurface: {
      surfaceId: "owned-surface",
      catalogId,
      components: [
        { id: "root", component: "WorkTable", issueIds: [execution.issue_id], mode: "live" },
      ],
    },
  });
  const observe = new Visibility(f.controller).snapshot();
  await run(
    publications.publish(
      {
        session_id: session,
        message_id: MessageId.make("msg_surface"),
        call_id: "surface-call",
        surface,
      },
      observe,
    ),
  );
  const request = {
    request_id: RequestId.make("saved-surface"),
    surface: { surface_id: "owned-surface", revision: 1 },
  };
  const before = await run(f.records.execution(execution.issue_id));
  await assert.rejects(
    run(f.controller.saveVisualSurface(SessionId.make("ses_foreign"), execution.issue_id, request)),
    /Abra/,
  );
  const saved = await run(f.controller.saveVisualSurface(session, execution.issue_id, request));
  assert.equal(saved.status, "published");
  assert.equal(saved.source_attachment, "associated");
  assert.equal(saved.notify_session, undefined);
  assert.equal(saved.notices, undefined);
  const read = await run(
    f.controller.visualDocument(execution.issue_id, request.request_id, saved.artifact!.hash),
  );
  const captured = JSON.parse(read.json);
  assert.equal(captured.provenance.source_surface.revision, 1);
  assert.equal(captured.provenance.source_report, undefined);
  assert.equal(
    captured.data.work.find((work: { issue_id: string }) => work.issue_id === execution.issue_id)
      .phase,
    "awaiting_plan_approval",
  );
  f.work.issues.get(execution.issue_id)!.title = "Later live title";
  await run(f.controller.saveVisualSurface(session, execution.issue_id, request));
  assert.equal(
    (
      await run(
        f.controller.visualDocument(execution.issue_id, request.request_id, saved.artifact!.hash),
      )
    ).json,
    read.json,
  );
  await run(
    publications.publish(
      {
        session_id: session,
        message_id: MessageId.make("msg_later"),
        call_id: "later-call",
        surface,
      },
      observe,
    ),
  );
  await assert.rejects(
    run(
      f.controller.saveVisualSurface(session, execution.issue_id, {
        ...request,
        request_id: RequestId.make("stale-source"),
      }),
    ),
    /revision changed/,
  );
  const after = await run(f.records.execution(execution.issue_id));
  assert.equal(after!.current_phase, before!.current_phase);
  assert.deepEqual(after!.approval_receipts, before!.approval_receipts);
  assert.equal(after!.visual_reports!.length, 1);
  const set = f.records.store.set.bind(f.records.store);
  let failAssociation = true;
  f.records.store.set = (key, value) =>
    key.startsWith("web/presentation/") &&
    failAssociation &&
    JSON.stringify(value).includes('"kind":"artifact"')
      ? ((failAssociation = false),
        Effect.fail(new CrewError("STORAGE", "Association write interrupted")))
      : set(key, value);
  const repairedRequest = {
    request_id: RequestId.make("association-recovery"),
    surface: { surface_id: "owned-surface", revision: 2 },
  };
  const interrupted = await run(
    f.controller.saveVisualSurface(session, execution.issue_id, repairedRequest),
  );
  assert.equal(interrupted.status, "published");
  assert.equal(interrupted.source_attachment, undefined);
  const artifactStat = await lstat(interrupted.artifact!.path);
  await run(f.controller.reconcileReports());
  const repaired = (await run(f.records.execution(execution.issue_id)))!.visual_reports!.find(
    (build) => build.request.request_id === repairedRequest.request_id,
  )!;
  assert.equal(repaired.source_attachment, "associated");
  assert.equal(repaired.notices, undefined);
  assert.equal((await lstat(repaired.artifact!.path)).ino, artifactStat.ino);
  const associations = await run(
    new PresentationAssociations(f.records.store, f.locks).read(session, [
      MessageId.make("msg_later"),
    ]),
  );
  assert.ok(
    associations.entries.some(
      (entry) => entry.target.kind === "artifact" && entry.target.hash === repaired.artifact!.hash,
    ),
  );
});

test("authorized report composition captures structured evidence through the existing report owner", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const execution = await run(planned(f));
  const session = SessionId.make("ses_composed-report");
  await run(f.controller.recordSupervisor(session));
  const request = {
    format: "a2ui-snapshot" as const,
    request_id: RequestId.make("composed-report"),
  };
  await assert.rejects(
    run(f.controller.visualReport(SessionId.make("ses_foreign"), execution.issue_id, request)),
    /Abra/,
  );
  const before = await run(f.records.execution(execution.issue_id));
  const producer = {
    session_id: session,
    message_id: MessageId.make("msg_composed"),
    tool_call_id: "composed-call",
  };
  const result = await run(
    f.controller.visualReport(session, execution.issue_id, request, producer),
  );
  assert.equal(result.format, "a2ui-snapshot");
  assert.equal(result.artifact?.schema_version, 2);
  assert.equal(result.source_attachment, "associated");
  assert.equal(result.notify_session, undefined);
  const original = await run(
    f.controller.visualDocument(execution.issue_id, request.request_id, result.artifact!.hash),
  );
  const document = JSON.parse(original.json);
  assert.equal(document.data.evidence.issue_id, execution.issue_id);
  assert.equal(
    document.surface.createSurface.components.filter(
      (component: { component: string }) => component.component === "ReportEvidence",
    ).length,
    7,
  );
  assert.ok(
    document.data.evidence.checks.every((check: { status: string }) => check.status !== "passed"),
  );
  f.work.issues.get(execution.issue_id)!.title = "Later current work";
  await run(f.controller.visualReport(session, execution.issue_id, request));
  assert.equal(
    (
      await run(
        f.controller.visualDocument(execution.issue_id, request.request_id, result.artifact!.hash),
      )
    ).json,
    original.json,
  );
  const next = await run(
    f.controller.visualReport(session, execution.issue_id, {
      ...request,
      request_id: RequestId.make("another-composition"),
    }),
  );
  assert.notEqual(next.artifact!.hash, result.artifact!.hash);
  const after = await run(f.records.execution(execution.issue_id));
  assert.equal(after!.current_phase, before!.current_phase);
  assert.deepEqual(after!.approval_receipts, before!.approval_receipts);
});
