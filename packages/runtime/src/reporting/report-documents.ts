import { verifyDiagrams, documentDiagrams } from "./diagrams.ts";
import { ReportFile } from "./report-files.ts";
import { Effect } from "effect";
import { CrewError, ensure, type Execution } from "../domain.ts";
import {
  AbsolutePath,
  ContentHash,
  IssueId,
  LockKey,
  RequestId,
  SessionId,
} from "@abracode/contracts/identities";
import type { Records } from "../storage/store.ts";
import type { Locks } from "../storage/lock.ts";
import { reportHash } from "./report-build.ts";
import { canonicalJSON } from "../presentation/identity.ts";
import {
  maximumDocumentBytes,
  validateReportDocument,
} from "@abracode/contracts/presentation/report-document";
import type { ReportSnapshot } from "@abracode/contracts/presentation/report-evidence";
import { workCatalogDocument } from "@abracode/contracts/web/catalog";
import type { VisualBuild, VisualRenderRequestSchema } from "./report-contracts.ts";

type Request = typeof VisualRenderRequestSchema.Type;
type Capture = (
  execution: Execution,
  revision: number,
) => Effect.Effect<{ document: unknown; snapshot: ReportSnapshot }, CrewError>;

/** Private artifact publication for Reports. It owns no workflow/approval transition. */
export class ReportDocuments {
  constructor(
    private home: AbsolutePath,
    private records: Records,
    private locks: Locks,
  ) {}

  private file(issue: IssueId, request: RequestId) {
    return new ReportFile(
      this.home,
      [".abracode", "reports", "generated", issue, request],
      "index.json",
      maximumDocumentBytes,
    );
  }
  private content(build: VisualBuild) {
    return Effect.gen({ self: this }, function* () {
      const a = build.artifact;
      if (a?.schema_version !== 2)
        return yield* new CrewError("REPORT_FORMAT", "An immutable JSON receipt is required");
      const file = yield* this.file(a.issue_id, a.request_id).read(a);
      if (a.path !== file.path)
        return yield* new CrewError(
          "REPORT_PATH",
          "JSON artifact path does not match its retained revision",
        );
      return { json: file.text, hash: file.hash, bytes: file.bytes };
    });
  }
  read(issue: IssueId, request: RequestId, hash: ContentHash) {
    return Effect.gen({ self: this }, function* () {
      const e = yield* this.records.execution(issue);
      const build = e?.visual_reports?.find((build) => build.request.request_id === request);
      const a = build?.artifact;
      if (
        !e ||
        build?.status !== "published" ||
        a?.schema_version !== 2 ||
        a.hash !== hash ||
        a.issue_id !== issue ||
        a.execution_id !== e.execution_id
      )
        return yield* new CrewError(
          "REPORT_UNAVAILABLE",
          "This exact JSON report revision is unavailable",
        );
      return yield* this.content(build);
    });
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
    return Effect.gen({ self: this }, function* () {
      const a = build.artifact;
      if (a?.schema_version !== 2 || build.format !== "a2ui-snapshot")
        return yield* new CrewError("REPORT_FORMAT", "JSON publication receipt required");
      if (!build.staging)
        return yield* new CrewError("REPORT_PATH", "Owned JSON staging file required");
      const publication = yield* this.file(issue, build.request.request_id).publish(
        { staging: build.staging, identity: a, expectedPath: a.path },
        this.records
          .update(issue, (current) => {
            ensure(
              current.execution_id === a.execution_id &&
                current.control_generation === build.generation,
              "REPORT_STALE",
              "Report publication generation changed",
            );
            return {
              ...current,
              visual_reports: current.visual_reports?.map((entry) =>
                entry.request.request_id === build.request.request_id
                  ? {
                      ...entry,
                      status: "published" as const,
                      document_input: undefined,
                      error: undefined,
                    }
                  : entry,
              ),
            };
          })
          .pipe(
            Effect.map((current) =>
              current.visual_reports!.find(
                (entry) => entry.request.request_id === build.request.request_id,
              )!,
            ),
          ),
      );
      return publication.result!;
    });
  }
  /** Caller already checked Supervisor/current Research authority. A retry never recaptures. */
  save(issue: IssueId, session: SessionId, request: Request, capture: Capture, recovery = false) {
    return this.locks.with(
      LockKey.make(`report-documents-${issue}`),
      () =>
        Effect.gen({ self: this }, function* () {
          const e = yield* this.records.execution(issue);
          if (!e)
            return yield* new CrewError(
              "EXECUTION_MISSING",
              "Retained execution required for a saved report",
            );
          let build = e.visual_reports?.find(
            (build) => build.request.request_id === request.request_id,
          );
          if (build) {
            if (canonicalJSON(build.request) !== canonicalJSON(request))
              return yield* new CrewError(
                "REPORT_REBIND",
                "Report request is bound to different input",
              );
            if (build.status === "published") {
              yield* this.content(build);
              return build;
            }
            if (build.artifact) return yield* this.publish(issue, build);
          } else {
            if (!((e.visual_reports?.length ?? 0) < 16))
              return yield* new CrewError("REPORT_LIMIT", "Report revision limit reached");
            const captured = yield* capture(e, (e.visual_reports?.length ?? 0) + 1);
            const document = yield* Effect.try({
              try: () => validateReportDocument(captured.document),
              catch: CrewError.from,
            });
            if (
              document.document_id !== request.request_id ||
              document.provenance.issue_id !== issue ||
              document.provenance.execution_id !== e.execution_id ||
              document.provenance.generation !== e.control_generation
            )
              return yield* new CrewError(
                "REPORT_IDENTITY",
                "Captured document belongs to another request or execution",
              );
            yield* verifyDiagrams(documentDiagrams(document));
            const hash = reportHash(canonicalJSON(document));
            build = {
              request,
              format: "a2ui-snapshot",
              requested_by: session,
              notify_session:
                request.surface || document.provenance.source_call
                  ? undefined
                  : (e.supervisor_session_id ?? (yield* this.records.supervisor)),
              producing_call: document.provenance.source_call,
              generation: e.control_generation,
              snapshot: captured.snapshot,
              input_hash: hash,
              document_hash: hash,
              template_hash: reportHash(
                canonicalJSON(workCatalogDocument) + document.renderer_compatibility,
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
          if (
            !build.document_input ||
            build.document_hash !== reportHash(canonicalJSON(build.document_input))
          )
            return yield* new CrewError(
              "REPORT_IDENTITY",
              "Captured document reservation is missing or changed",
            );
          const document = build.document_input;
          const json = canonicalJSON(document);
          const file = this.file(issue, request.request_id);
          const { staging, path } = yield* file.stage(json, {
            hash: build.document_hash!,
            bytes: Buffer.byteLength(json),
          });
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
      { waitSeconds: recovery ? 0 : 30 },
    );
  }
}
