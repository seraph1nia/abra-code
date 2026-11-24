import {
  bindingRequirements,
  selectBindingRows,
  type BindingSelection,
  type BindingRead,
} from "@abracode/contracts/web/bindings";
import { Clock, Effect, Schema } from "effect";
import { WorkSummarySchema } from "@abracode/contracts/visibility/work-summary";
import { validateSurface } from "@abracode/contracts/web/surfaces";
import { catalogId } from "@abracode/contracts/web/catalog";
import {
  reportCatalogs,
  validateReportDocument,
  readReportDocument,
  type ReportProducer,
} from "@abracode/contracts/presentation/report-document";
import { SessionMessage } from "@opencode/client/effect";
import {
  IssueId,
  SessionId,
  RequestId,
  LockKey,
  AbsolutePath,
  Timestamp,
} from "@abracode/contracts/identities";
import { type Runtime } from "../opencode/runtime.ts";
import { CrewError, ensure, type Execution } from "../domain.ts";
import { type Records } from "../storage/store.ts";
import { type Locks } from "../storage/lock.ts";
import { type WorkGraph } from "../work/graph.ts";
import { domainEffect } from "../effect.ts";
import { decode } from "../decode.ts";
import { SurfacePublications } from "../web/surface-publications.ts";
import { presentationHash } from "../presentation/identity.ts";
import { PresentationAssociations } from "../presentation/associations.ts";
import { isActiveWorker } from "../workflow/worker-assignment.ts";
import { ReportDocuments } from "./report-documents.ts";
import { VisualRenderRequestSchema, type VisualBuild } from "./report-contracts.ts";
import { captureReportSnapshot } from "./report-snapshot.ts";
import { reportHash } from "./report-build.ts";
import { readLegacyHtmlArtifact, reconcileLegacyHtmlBuild } from "./legacy-html.ts";

const digest = reportHash;

function isTerminalBuild(build: VisualBuild): boolean {
  return build.status === "published" || build.status === "failed";
}

function hasPendingNotice(build: VisualBuild): boolean {
  if (build.request.surface || build.producing_call) {
    return (
      build.format === "a2ui-snapshot" && build.status === "published" && !build.source_attachment
    );
  }
  return Boolean(
    build.notify_session &&
    !(build.notices ?? []).some(
      (notice) =>
        notice.phase === build.status &&
        notice.delivered &&
        (build.status !== "published" || notice.associated),
    ),
  );
}

function needsRecovery(build: VisualBuild): boolean {
  return !isTerminalBuild(build) || hasPendingNotice(build);
}

/** Private Reports implementation for immutable reports and retained HTML. No workflow,
 * approval or Markdown acceptance transition is owned here. */
export class VisualReports {
  private documents: ReportDocuments;
  private surfaces: SurfacePublications;
  private associations: PresentationAssociations;
  constructor(
    private home: AbsolutePath,
    private records: Records,
    private locks: Locks,
    private work: WorkGraph,
    private notify: Runtime["notify"],
    private readReport: (e: Execution) => Effect.Effect<string, CrewError>,
  ) {
    this.documents = new ReportDocuments(home, records, locks);
    this.surfaces = new SurfacePublications(records.store, locks);
    this.associations = new PresentationAssociations(records.store, locks);
  }

  private deliverNoticeBestEffort(issue: IssueId, build: VisualBuild) {
    return this.noticeResult(issue, build).pipe(
      Effect.catch((error) => Effect.logWarning("Report result notice deferred", error.code)),
    );
  }

  /** Explicit artifact authority, independent of workflow advancement. */
  saveSurface = (
    session: SessionId,
    issue: IssueId,
    raw: typeof VisualRenderRequestSchema.Type,
    observe: (selection: BindingSelection) => Effect.Effect<BindingRead, CrewError>,
  ) =>
    domainEffect(
      Effect.gen({ self: this }, function* () {
        ensure(
          (yield* this.records.supervisor()) === session,
          "ABRA_REQUIRED",
          "Retained Abra required to save a report",
        );
        const request = yield* decode(VisualRenderRequestSchema, raw, "Saved report request");
        ensure(request.surface, "REPORT_SOURCE", "An exact observed surface revision is required");
        const selection = request.surface;
        const result = yield* this.documents.save(issue, session, request, (e, revision) =>
          Effect.gen({ self: this }, function* () {
            const source = yield* this.surfaces.readCurrent(
              session,
              selection.surface_id,
              selection.revision,
            );
            const requirements = bindingRequirements(source.surface, "live");
            const current = yield* observe(requirements);
            const live = selectBindingRows(requirements, current.work, current.coverage.total);
            const captured = selectBindingRows(
              bindingRequirements(source.surface, "snapshot"),
              source.snapshot,
              source.coverage?.total,
            );
            ensure(
              !live.coverage.unavailable_ids.length &&
                !captured.coverage.unavailable_ids.length &&
                !current.results.some(
                  (result) =>
                    requirements.ids.includes(result.issue_id) && result.status !== "available",
                ),
              "REPORT_SOURCE",
              "Required explicit work is unavailable; report was not published",
            );
            const capturedWork = yield* Schema.decodeEffect(Schema.Array(WorkSummarySchema))(
              live.rows,
            ).pipe(Effect.mapError(CrewError.from));
            const markdown = e.report_receipt ? yield* this.readReport(e) : undefined;
            const snapshot = yield* captureReportSnapshot(this.work, e, markdown, request.title);
            const document = yield* Effect.try({
              try: () =>
                validateReportDocument({
                  format: "a2ui-snapshot",
                  format_version: 1,
                  document_id: request.request_id,
                  revision,
                  title: request.title ?? snapshot.title,
                  captured_at: Timestamp.make(current.observed_at),
                  catalog_id: source.surface.createSurface.catalogId,
                  ...reportCatalogs[source.surface.createSurface.catalogId],
                  provenance: {
                    issue_id: issue,
                    execution_id: e.execution_id,
                    generation: e.control_generation,
                    ...(e.delivered_commit || e.base_commit
                      ? { source_commit: e.delivered_commit ?? e.base_commit }
                      : {}),
                    ...(e.report_receipt
                      ? {
                          source_report: {
                            report_id: e.report_receipt.report_id,
                            hash: e.report_receipt.hash,
                          },
                        }
                      : {}),
                    source_surface: {
                      session_id: session,
                      surface_id: selection.surface_id,
                      revision: selection.revision,
                      hash: presentationHash(source),
                    },
                  },
                  surface: source.surface,
                  data: {
                    work: capturedWork,
                    snapshot_work: source.snapshot,
                    live_coverage: { ...live.coverage, status: current.coverage.status },
                    ...(source.coverage ? { snapshot_coverage: source.coverage } : {}),
                  },
                  limitations: [
                    "Saved live and snapshot bindings are immutable; links inspect separately labeled current app resources.",
                    "The original generated surface had no captured report evidence; report-evidence components remain unavailable.",
                    ...(live.coverage.truncated || current.coverage.status !== "observed"
                      ? [
                          `Live work capture is partial: ${live.rows.length} of ${live.coverage.total ?? "unknown"} retained tasks; ${current.coverage.status}.`,
                        ]
                      : []),
                    ...(!source.coverage
                      ? ["Historical snapshot coverage is unknown."]
                      : source.coverage.truncated
                        ? ["Original snapshot coverage is partial."]
                        : []),
                  ],
                }),
              catch: CrewError.from,
            });
            return { document, snapshot };
          }),
        );
        yield* this.deliverNoticeBestEffort(issue, result);
        return (yield* this.records.execution(issue))!.visual_reports!.find(
          (build) => build.request.request_id === request.request_id,
        )!;
      }),
    );

  generate = Effect.fn("Reports.generate")(
    function* (
      this: VisualReports,
      session: SessionId,
      issue: IssueId,
      request: typeof VisualRenderRequestSchema.Type,
      producer?: ReportProducer,
    ) {
      ensure(
        (yield* this.records.supervisor()) === session,
        "ABRA_REQUIRED",
        "Retained Abra required for report generation",
      );
      const result = yield* Effect.result(
        this.generateOwned(issue, session, request, false, undefined, producer),
      );
      const retained = (yield* this.records.execution(issue))?.visual_reports?.find(
        (b) => b.request.request_id === request.request_id,
      );
      if (retained) yield* this.deliverNoticeBestEffort(issue, retained);
      if (result._tag === "Failure") return yield* result.failure;
      return (yield* this.records.execution(issue))!.visual_reports!.find(
        (b) => b.request.request_id === request.request_id,
      )!;
    }.bind(this),
    domainEffect,
  );

  attach = Effect.fn("VisualReports.attach")(
    function* (
      this: VisualReports,
      session: SessionId,
      issue: IssueId,
      generation: number,
      request: typeof VisualRenderRequestSchema.Type,
    ) {
      const result = yield* Effect.result(
        this.generateOwned(issue, session, request, false, generation),
      );
      const current = (yield* this.records.execution(issue))?.visual_reports?.find(
        (b) => b.request.request_id === request.request_id,
      );
      if (current) yield* this.deliverNoticeBestEffort(issue, current);
      if (result._tag === "Failure") return yield* result.failure;
      return (yield* this.records.execution(issue))!.visual_reports!.find(
        (b) => b.request.request_id === request.request_id,
      )!;
    }.bind(this),
    domainEffect,
  );

  private updateVisual = (issue: IssueId, id: RequestId, update: (b: VisualBuild) => VisualBuild) =>
    this.records
      .update(issue, (e) => ({
        ...e,
        visual_reports: e.visual_reports?.map((b) => (b.request.request_id === id ? update(b) : b)),
      }))
      .pipe(Effect.map((e) => e.visual_reports!.find((b) => b.request.request_id === id)!));

  /** Read only a retained published revision through the existing containment/hash checks. */
  readDocument = (...args: Parameters<ReportDocuments["read"]>) => this.documents.read(...args);

  readArtifact = (issue: IssueId, request: RequestId) =>
    domainEffect(
      Effect.gen({ self: this }, function* () {
        const e = yield* this.records.execution(issue);
        const build = e?.visual_reports?.find((b) => b.request.request_id === request);
        ensure(
          e && build?.status === "published" && build.artifact,
          "REPORT_UNAVAILABLE",
          "Published visual report is unavailable",
        );
        ensure(
          build.artifact.issue_id === issue && build.artifact.execution_id === e.execution_id,
          "REPORT_IDENTITY",
          "Visual report belongs to another execution",
        );
        return {
          html: yield* readLegacyHtmlArtifact(this.home, build),
          hash: build.artifact.hash,
          bytes: build.artifact.bytes,
        };
      }),
    );

  private generateOwned = Effect.fn("Reports.generateOwned")(
    function* (
      this: VisualReports,
      issue: IssueId,
      session: SessionId,
      raw: typeof VisualRenderRequestSchema.Type,
      recovery = false,
      workerGeneration?: number,
      producer?: ReportProducer,
    ) {
      const request = yield* decode(VisualRenderRequestSchema, raw, "Visual report request");
      const retained = (yield* this.records.execution(issue))?.visual_reports?.find(
        (build) => build.request.request_id === request.request_id,
      );
      if (!retained) {
        if (request.surface)
          return yield* this.saveSurface(session, issue, request, () =>
            Effect.fail(
              new CrewError(
                "REPORT_SOURCE",
                "Surface capture requires its workspace observation adapter",
              ),
            ),
          );
        return yield* this.documents.save(
          issue,
          session,
          request,
          (e, revision) =>
            Effect.gen({ self: this }, function* () {
              if (workerGeneration !== undefined)
                ensure(
                  isActiveWorker(e, session, { role: "research", generation: workerGeneration }),
                  "RESEARCH_ROLE",
                  "Current Research generation required for report capture",
                );
              const markdown = e.report_receipt ? yield* this.readReport(e) : undefined;
              const snapshot = yield* captureReportSnapshot(
                this.work,
                e,
                markdown,
                request.title,
                request.diagrams,
              );
              const sections = [
                "summary",
                "findings",
                "checks",
                "events",
                "excerpts",
                "limitations",
                "diagrams",
              ];
              const surface = validateSurface({
                version: "1.0",
                createSurface: {
                  surfaceId: `report-${digest(request.request_id).slice(0, 20)}`,
                  catalogId,
                  components: [
                    { id: "root", component: "Column", children: sections },
                    ...sections.map((section) => ({
                      id: section,
                      component: "ReportEvidence",
                      section,
                    })),
                  ],
                },
              });
              const document = yield* Effect.try({
                try: () =>
                  validateReportDocument({
                    format: "a2ui-snapshot",
                    format_version: 1,
                    document_id: request.request_id,
                    revision,
                    title: snapshot.title,
                    captured_at: snapshot.observed_at,
                    catalog_id: catalogId,
                    ...reportCatalogs[catalogId],
                    provenance: {
                      issue_id: issue,
                      execution_id: e.execution_id,
                      generation: e.control_generation,
                      ...(producer ? { source_call: producer } : {}),
                      ...(e.delivered_commit || e.base_commit
                        ? { source_commit: e.delivered_commit ?? e.base_commit }
                        : {}),
                      ...(e.report_receipt
                        ? {
                            source_report: {
                              report_id: e.report_receipt.report_id,
                              hash: e.report_receipt.hash,
                            },
                          }
                        : {}),
                    },
                    surface,
                    data: { work: [], evidence: snapshot },
                    limitations: snapshot.limitations,
                  }),
                catch: CrewError.from,
              });
              return { document, snapshot };
            }),
          recovery,
        );
      }
      if (retained.format === "a2ui-snapshot") {
        if (workerGeneration !== undefined) {
          const e = (yield* this.records.execution(issue))!;
          ensure(
            isActiveWorker(e, session, { role: "research", generation: workerGeneration }),
            "RESEARCH_ROLE",
            "Current Research generation required for a report request",
          );
        }
        return yield* this.documents.save(
          issue,
          session,
          request,
          () =>
            Effect.fail(
              new CrewError(
                "REPORT_IDENTITY",
                "Captured document reservation is unavailable; preserve retained evidence",
              ),
            ),
          recovery,
        );
      }
      return yield* reconcileLegacyHtmlBuild({
        home: this.home,
        records: this.records,
        locks: this.locks,
        issue,
        session,
        request,
        recovery,
        workerGeneration,
        updateVisual: this.updateVisual,
      });
    }.bind(this),
    domainEffect,
  );

  private noticeResult(issue: IssueId, build: VisualBuild) {
    return domainEffect(
      Effect.gen({ self: this }, function* () {
        if (build.format === "a2ui-snapshot" && build.producing_call) {
          if (build.status !== "published" || !build.artifact || build.source_attachment) return;
          const producer = build.producing_call;
          yield* this.associations.associate({
            ...producer,
            source: "tool",
            target: {
              kind: "artifact",
              issue_id: issue,
              request_id: build.request.request_id,
              hash: build.artifact.hash,
            },
          });
          yield* this.updateVisual(issue, build.request.request_id, (current) => ({
            ...current,
            source_attachment: "associated",
          }));
          return;
        }
        if (build.format === "a2ui-snapshot" && build.request.surface) {
          if (build.status !== "published" || !build.artifact || build.source_attachment) return;
          const read = yield* this.documents.read(
            issue,
            build.request.request_id,
            build.artifact.hash,
          );
          const loaded = yield* Effect.try({
            try: () => readReportDocument(read.json),
            catch: CrewError.from,
          });
          const provenance = loaded.supported
            ? loaded.document.provenance.source_surface
            : undefined;
          let associated = false;
          if (provenance) {
            const source = yield* this.surfaces.read(
              provenance.session_id,
              provenance.surface_id,
              provenance.revision,
            );
            ensure(
              provenance.hash === presentationHash(source),
              "REPORT_IDENTITY",
              "Saved surface provenance no longer matches its original revision",
            );
            if (source.message_id && source.tool_call_id.startsWith(`${source.message_id}/`)) {
              yield* this.associations.associate({
                session_id: provenance.session_id,
                message_id: source.message_id,
                tool_call_id: source.tool_call_id.slice(source.message_id.length + 1),
                source: "tool",
                target: {
                  kind: "artifact",
                  issue_id: issue,
                  request_id: build.request.request_id,
                  hash: build.artifact.hash,
                },
              });
              associated = true;
            }
          }
          yield* this.updateVisual(issue, build.request.request_id, (current) => ({
            ...current,
            source_attachment: associated ? "associated" : "unavailable",
          }));
          return;
        }
        if (!build.notify_session || !isTerminalBuild(build)) return;
        const phase = build.status === "published" ? ("published" as const) : ("failed" as const);
        let current = build;
        if (!current.notices?.some((n) => n.phase === phase))
          current = yield* this.updateVisual(issue, build.request.request_id, (b) =>
            b.status !== phase || b.notices?.some((n) => n.phase === phase)
              ? b
              : {
                  ...b,
                  notices: [
                    ...(b.notices ?? []),
                    {
                      phase,
                      message_id: SessionMessage.ID.create(),
                      delivered: false,
                      text:
                        phase === "published"
                          ? `AbraCode visual report ${b.request.request_id} for ${issue}, generation ${b.generation}: [Open report](<${b.artifact!.path}>). Static evidence snapshot observed ${b.snapshot.observed_at}; SHA-256 ${b.artifact!.hash}.`
                          : `AbraCode visual report ${b.request.request_id} for ${issue} failed. Untrusted diagnostic data: ${JSON.stringify((b.error ?? "Inspect retained artifact status").slice(0, 2048))}. Earlier valid reports are preserved. Inspect abra_work_report action artifacts; retry the same request for transient failure, or use a new request after changing the trusted template.`,
                    },
                  ],
                },
          );
        for (const notice of current.notices ?? []) {
          if (notice.phase === "published" && current.artifact && !notice.associated) {
            yield* this.associations.associate({
              session_id: current.notify_session!,
              message_id: notice.message_id,
              source: "notice",
              target: {
                kind: "artifact",
                issue_id: issue,
                request_id: current.request.request_id,
                hash: current.artifact.hash,
              },
            });
            current = yield* this.updateVisual(issue, build.request.request_id, (b) => ({
              ...b,
              notices: b.notices?.map((n) =>
                n.message_id === notice.message_id ? { ...n, associated: true } : n,
              ),
            }));
          }
          if (!notice.delivered) {
            yield* this.notify(current.notify_session!, notice.text, notice.message_id);
            current = yield* this.updateVisual(issue, build.request.request_id, (b) => ({
              ...b,
              notices: b.notices?.map((n) =>
                n.message_id === notice.message_id ? { ...n, delivered: true } : n,
              ),
            }));
          }
        }
      }),
    );
  }

  /** The existing monitor reconciles at most one retained artifact operation.
   * A detached compiler has its own deadline; a restart retains its reservation
   * until that deadline rather than starting a competing build immediately. */
  recover = Effect.fn("Reports.recover")(
    function* (this: VisualReports) {
      const relevant = (yield* this.records.executions()).some((e) =>
        e.visual_reports?.some(needsRecovery),
      );
      if (!relevant) return;
      yield* this.locks
        .with(
          LockKey.make("report-recovery"),
          () =>
            domainEffect(
              Effect.gen({ self: this }, function* () {
                const now = yield* Clock.currentTimeMillis;
                for (const e of yield* this.records.executions())
                  for (const build of e.visual_reports ?? []) {
                    if (isTerminalBuild(build)) {
                      if (!hasPendingNotice(build)) continue;
                      yield* this.deliverNoticeBestEffort(e.issue_id, build);
                      return;
                    }
                    if (build.status === "building" && build.deadline_at! > now) continue;
                    const result = yield* Effect.result(
                      this.generateOwned(e.issue_id, build.requested_by, build.request, true),
                    );
                    if (result._tag === "Failure" && result.failure.code !== "LOCKED") {
                      const error = result.failure;
                      yield* this.updateVisual(e.issue_id, build.request.request_id, (b) => ({
                        ...b,
                        status: "failed",
                        error: error.message.slice(0, 8192),
                      }));
                    }
                    const current = (yield* this.records.execution(
                      e.issue_id,
                    ))?.visual_reports?.find(
                      (b) => b.request.request_id === build.request.request_id,
                    );
                    if (current) yield* this.deliverNoticeBestEffort(e.issue_id, current);
                    return;
                  }
              }),
            ),
          { waitSeconds: 0 },
        )
        .pipe(
          Effect.catchIf(
            (error) => error.code === "LOCKED",
            () => Effect.void,
          ),
        );
    }.bind(this),
    domainEffect,
  );
}
