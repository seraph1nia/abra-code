import { writeReportStaging, linkReportStaging } from "./report-files.ts";
import { Effect } from "effect";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { CrewError, ensure, type Execution } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import {
  AbsolutePath,
  ContentHash,
  IssueId,
  LockKey,
  RequestId,
  SessionId,
} from "../identities.ts";
import type { Records } from "../storage/store.ts";
import type { Locks } from "../storage/lock.ts";
import { lstat, realpath, readFile, pathExists, rm } from "../filesystem.ts";
import { reportDirectory, reportHash } from "./report-build.ts";
import { canonicalJSON } from "../presentation/identity.ts";
import {
  maximumDocumentBytes,
  reportRendererVersion,
  validateReportDocument,
  type ReportDocument,
} from "../presentation/report-document.ts";
import type { ReportSnapshot } from "../presentation/report-evidence.ts";
import { workCatalogDocument } from "../web/catalog.ts";
import type { VisualBuild, VisualRenderRequestSchema } from "./report-contracts.ts";

type Request = typeof VisualRenderRequestSchema.Type;
type Capture = (
  execution: Execution,
  revision: number,
) => Effect.Effect<{ document: ReportDocument; snapshot: ReportSnapshot }, CrewError>;

/** Private artifact publication for Reports. It owns no workflow/approval transition. */
export class ReportDocuments {
  constructor(
    private home: AbsolutePath,
    private records: Records,
    private locks: Locks,
  ) {}

  private content(build: VisualBuild) {
    return domainEffect(
      Effect.gen({ self: this }, function* () {
        const a = build.artifact;
        ensure(a?.schema_version === 2, "REPORT_FORMAT", "An immutable JSON receipt is required");
        const expected = join(
          yield* realpath(this.home),
          ".abracode/reports/generated",
          a.issue_id,
          a.request_id,
          "index.json",
        );
        ensure(
          a.path === expected,
          "REPORT_PATH",
          "JSON artifact path does not match its retained revision",
        );
        const stat = yield* lstat(a.path);
        ensure(
          stat.isFile() &&
            !stat.isSymbolicLink() &&
            stat.size <= maximumDocumentBytes &&
            (yield* realpath(a.path)) === expected,
          "REPORT_PATH",
          "JSON artifact must be a bounded owned regular file",
        );
        const json = yield* readFile(a.path, "utf8");
        ensure(
          reportHash(json) === a.hash && Buffer.byteLength(json) === a.bytes,
          "REPORT_TAMPERED",
          "JSON artifact no longer matches its retained digest",
        );
        return { json, hash: a.hash, bytes: a.bytes };
      }),
    );
  }
  read(issue: IssueId, request: RequestId, hash: ContentHash) {
    return domainEffect(
      Effect.gen({ self: this }, function* () {
        const e = yield* this.records.execution(issue);
        const build = e?.visual_reports?.find((build) => build.request.request_id === request);
        const a = build?.artifact;
        ensure(
          e &&
            build?.status === "published" &&
            a?.schema_version === 2 &&
            a.hash === hash &&
            a.issue_id === issue &&
            a.execution_id === e.execution_id,
          "REPORT_UNAVAILABLE",
          "This exact JSON report revision is unavailable",
        );
        return yield* this.content(build);
      }),
    );
  }
  private update(issue: IssueId, request: RequestId, change: (build: VisualBuild) => VisualBuild) {
    return this.records
      .update(issue, (execution) => ({
        ...execution,
        visual_reports: execution.visual_reports?.map((build) =>
          build.request.request_id === request ? change(build) : build,
        ),
      }))
      .pipe(
        Effect.map((execution) =>
          execution.visual_reports!.find((build) => build.request.request_id === request)!,
        ),
      );
  }
  private publish(issue: IssueId, build: VisualBuild) {
    return domainEffect(
      Effect.gen({ self: this }, function* () {
        const a = build.artifact;
        ensure(
          a?.schema_version === 2 && build.format === "a2ui-snapshot",
          "REPORT_FORMAT",
          "JSON publication receipt required",
        );
        const directory = yield* reportDirectory(this.home, [
          ".abracode",
          "reports",
          "generated",
          issue,
          build.request.request_id,
        ]);
        ensure(
          a.path === join(directory, "index.json"),
          "REPORT_PATH",
          "JSON revision destination changed",
        );
        if (!(yield* pathExists(a.path))) {
          const staging = build.staging;
          ensure(
            staging &&
              staging.startsWith(directory + "/.stage-") &&
              !staging.slice(directory.length + 1).includes("/"),
            "REPORT_PATH",
            "Owned JSON staging file required",
          );
          const stat = yield* lstat(staging);
          ensure(
            stat.isFile() &&
              !stat.isSymbolicLink() &&
              stat.size <= maximumDocumentBytes &&
              (yield* realpath(staging)) === staging,
            "REPORT_PATH",
            "JSON staging ownership changed",
          );
          const json = yield* readFile(staging, "utf8");
          ensure(
            reportHash(json) === a.hash && Buffer.byteLength(json) === a.bytes,
            "REPORT_TAMPERED",
            "JSON staging digest changed",
          );
          yield* linkReportStaging(staging, a.path);
        }
        yield* this.content(build);
        const published = yield* this.update(issue, build.request.request_id, (current) => ({
          ...current,
          status: "published",
          document_input: undefined,
          error: undefined,
        }));
        if (build.staging && (yield* pathExists(build.staging))) {
          const stat = yield* lstat(build.staging);
          if (
            stat.isFile() &&
            !stat.isSymbolicLink() &&
            (yield* realpath(build.staging)) === build.staging &&
            reportHash(yield* readFile(build.staging, "utf8")) === a.hash
          )
            yield* rm(build.staging);
        }
        return published;
      }),
    );
  }
  /** Caller already checked Supervisor/current Research authority. A retry never recaptures. */
  save(issue: IssueId, session: SessionId, request: Request, capture: Capture, recovery = false) {
    return this.locks.with(
      LockKey.make(
        `report-html-${reportHash(JSON.stringify([issue, request.request_id])).slice(0, 40)}`,
      ),
      () =>
        this.locks.with(
          LockKey.make(`report-documents-${issue}`),
          () =>
            domainEffect(
              Effect.gen({ self: this }, function* () {
                const e = yield* this.records.execution(issue);
                ensure(e, "EXECUTION_MISSING", "Retained execution required for a saved report");
                let build = e.visual_reports?.find(
                  (build) => build.request.request_id === request.request_id,
                );
                if (build) {
                  ensure(
                    build.format === "a2ui-snapshot" &&
                      canonicalJSON(build.request) === canonicalJSON(request),
                    "REPORT_REBIND",
                    "Report request is bound to different input or a retained legacy artifact",
                  );
                  if (build.status === "published") {
                    yield* this.content(build);
                    return build;
                  }
                  if (build.artifact) return yield* this.publish(issue, build);
                } else {
                  ensure(
                    (e.visual_reports?.length ?? 0) < 16,
                    "REPORT_LIMIT",
                    "Report revision limit reached",
                  );
                  const captured = yield* capture(e, (e.visual_reports?.length ?? 0) + 1);
                  const document = yield* Effect.try({
                    try: () => validateReportDocument(captured.document),
                    catch: CrewError.from,
                  });
                  ensure(
                    document.document_id === request.request_id &&
                      document.provenance.issue_id === issue &&
                      document.provenance.execution_id === e.execution_id &&
                      document.provenance.generation === e.control_generation,
                    "REPORT_IDENTITY",
                    "Captured document belongs to another request or execution",
                  );
                  const hash = reportHash(canonicalJSON(document));
                  build = {
                    request,
                    format: "a2ui-snapshot",
                    requested_by: session,
                    notify_session:
                      request.surface || document.provenance.source_call
                        ? undefined
                        : (e.supervisor_session_id ?? (yield* this.records.supervisor())),
                    producing_call: document.provenance.source_call,
                    generation: e.control_generation,
                    snapshot: captured.snapshot,
                    input_hash: hash,
                    document_hash: hash,
                    template_hash: reportHash(
                      canonicalJSON(workCatalogDocument) + reportRendererVersion,
                    ),
                    document_input: document,
                    status: "pending",
                    source_report: document.provenance.source_report,
                  };
                  const reserved = build;
                  yield* this.records.update(issue, (current) => {
                    ensure(
                      current.execution_id === e.execution_id &&
                        current.control_generation === e.control_generation,
                      "REPORT_STALE",
                      "Report source changed during capture",
                    );
                    return {
                      ...current,
                      visual_reports: [...(current.visual_reports ?? []), reserved],
                    };
                  });
                }
                ensure(
                  build.document_input &&
                    build.document_hash === reportHash(canonicalJSON(build.document_input)),
                  "REPORT_IDENTITY",
                  "Captured document reservation is missing or changed",
                );
                const document = yield* Effect.try({
                  try: () => validateReportDocument(build!.document_input),
                  catch: CrewError.from,
                });
                const json = canonicalJSON(document);
                const directory = yield* reportDirectory(this.home, [
                  ".abracode",
                  "reports",
                  "generated",
                  issue,
                  request.request_id,
                ]);
                const path = AbsolutePath.make(join(directory, "index.json"));
                ensure(
                  !(yield* pathExists(path)),
                  "REPORT_OCCUPIED",
                  "Report destination is occupied; preserve it for inspection",
                );
                const staging = AbsolutePath.make(join(directory, `.stage-${randomUUID()}.json`));
                yield* writeReportStaging(staging, json);
                const reserved = build;
                build = yield* this.update(issue, request.request_id, (current) => ({
                  ...current,
                  status: "validated",
                  staging,
                  artifact: {
                    schema_version: 2,
                    format: "a2ui-snapshot",
                    document_id: document.document_id,
                    revision: document.revision,
                    catalog_id: document.catalog_id,
                    catalog_version: document.catalog_version,
                    renderer_compatibility: document.renderer_compatibility,
                    request_id: request.request_id,
                    issue_id: issue,
                    execution_id: e.execution_id,
                    generation: reserved.generation,
                    input_hash: reserved.input_hash,
                    template_hash: reserved.template_hash,
                    hash: reserved.document_hash!,
                    bytes: Buffer.byteLength(json),
                    path,
                    observed_at: document.captured_at,
                    source_report: reserved.source_report,
                  },
                }));
                return yield* this.publish(issue, build);
              }),
            ),
          { waitSeconds: recovery ? 0 : 30 },
        ),
      { waitSeconds: recovery ? 0 : 30 },
    );
  }
}
