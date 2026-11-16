import {
  bindingRequirements,
  selectBindingRows,
  type BindingSelection,
  type BindingRead,
} from "@abracode/contracts/web/bindings";
import { Clock, Effect, Schema } from "effect";
import { WorkSummarySchema } from "../visibility/work-summary.ts";
import { ReportDocuments } from "./report-documents.ts";
import { SurfacePublications } from "../web/surface-publications.ts";
import { validateSurface } from "../web/surfaces.ts";
import { presentationHash } from "../presentation/identity.ts";
import { catalogId } from "../web/catalog.ts";
import {
  reportRendererVersion,
  validateReportDocument,
  readReportDocument,
  type ReportProducer,
} from "../presentation/report-document.ts";
import { join } from "node:path";
import { SessionMessage } from "@opencode/client/effect";
import { type Runtime } from "../opencode/runtime.ts";
import { IssueId, SessionId, RequestId, LockKey, AbsolutePath, Timestamp } from "../identities.ts";
import { CrewError, ensure, type Execution } from "../domain.ts";
import { type Records } from "../storage/store.ts";
import { type Locks } from "../storage/lock.ts";
import { type WorkGraph } from "../work/graph.ts";
import { domainEffect } from "../effect.ts";
import { decode } from "../decode.ts";
import { lstat, pathExists, readFile, realpath, rm, link } from "../filesystem.ts";
import { VisualRenderRequestSchema, type VisualBuild } from "./report-contracts.ts";
import { isActiveWorker } from "./worker-assignment.ts";
import { captureReportSnapshot } from "./report-snapshot.ts";
import { PresentationAssociations } from "../presentation/associations.ts";
import {
  reportDirectory,
  reportHash,
  maximumHTMLBytes,
  validateReportHTML,
} from "./report-build.ts";
const digest = reportHash;
/** Private Reports implementation for immutable reports and retained HTML. No workflow,
 * approval or Markdown acceptance transition is owned here. */
export class VisualReports {
  private documents: ReportDocuments;
  constructor(
    private home: AbsolutePath,
    private records: Records,
    private locks: Locks,
    private work: WorkGraph,
    private notify: Runtime["notify"],
    private readReport: (e: Execution) => Effect.Effect<string, CrewError>,
  ) {
    this.documents = new ReportDocuments(home, records, locks);
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
            const source = yield* new SurfacePublications(
              this.records.store,
              this.locks,
            ).readCurrent(session, selection.surface_id, selection.revision);
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
                  catalog_id: catalogId,
                  catalog_version: 1,
                  renderer_compatibility: reportRendererVersion,
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
        yield* this.noticeResult(issue, result).pipe(Effect.ignore);
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
      if (retained) yield* this.noticeResult(issue, retained).pipe(Effect.ignore);
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
      if (current) yield* this.noticeResult(issue, current).pipe(Effect.ignore);
      if (result._tag === "Failure") return yield* result.failure;
      return (yield* this.records.execution(issue))!.visual_reports!.find(
        (b) => b.request.request_id === request.request_id,
      )!;
    }.bind(this),
    domainEffect,
  );
  private updateVisual(issue: IssueId, id: RequestId, update: (b: VisualBuild) => VisualBuild) {
    return this.records
      .update(issue, (e) => ({
        ...e,
        visual_reports: e.visual_reports?.map((b) => (b.request.request_id === id ? update(b) : b)),
      }))
      .pipe(Effect.map((e) => e.visual_reports!.find((b) => b.request.request_id === id)!));
  }
  private sourceCurrent(issue: IssueId, build: VisualBuild) {
    return domainEffect(
      Effect.gen({ self: this }, function* () {
        const e = yield* this.records.execution(issue);
        ensure(
          e &&
            e.execution_id === build.snapshot.execution_id &&
            e.control_generation === build.generation &&
            (!build.source_report || e.report_receipt?.hash === build.source_report.hash),
          "REPORT_STALE",
          "Captured report source was superseded; use a new report request",
        );
        return e;
      }),
    );
  }
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
          html: yield* this.artifactContent(build),
          hash: build.artifact.hash,
          bytes: build.artifact.bytes,
        };
      }),
    );
  private artifactContent(build: VisualBuild) {
    return domainEffect(
      Effect.gen({ self: this }, function* () {
        const a = build.artifact;
        ensure(a, "REPORT_ARTIFACT", "Validated visual artifact receipt required");
        ensure(
          a.schema_version === 1,
          "REPORT_FORMAT",
          "This artifact is a JSON report; use its document reader",
        );
        const expected = join(
          yield* realpath(this.home),
          ".abracode/reports/generated",
          a.issue_id,
          a.request_id,
          "index.html",
        );
        ensure(
          a.path === expected,
          "REPORT_PATH",
          "Visual artifact path does not match its retained revision",
        );
        const stat = yield* lstat(a.path);
        ensure(
          stat.isFile() &&
            !stat.isSymbolicLink() &&
            stat.size <= maximumHTMLBytes &&
            (yield* realpath(a.path)) === expected,
          "REPORT_PATH",
          "Visual artifact must be a bounded owned regular file",
        );
        const html = yield* readFile(a.path, "utf8");
        ensure(
          reportHash(html) === a.hash && Buffer.byteLength(html) === a.bytes,
          "REPORT_TAMPERED",
          "Visual artifact no longer matches its retained digest",
        );
        validateReportHTML(html, build.snapshot);
        return html;
      }),
    );
  }
  private publishVisual(issue: IssueId, build: VisualBuild) {
    return domainEffect(
      Effect.gen({ self: this }, function* () {
        const a = build.artifact;
        ensure(a, "REPORT_ARTIFACT", "Validated visual artifact required");
        yield* this.sourceCurrent(issue, build);
        const directory = yield* reportDirectory(this.home, [
          ".abracode",
          "reports",
          "generated",
          issue,
          build.request.request_id,
        ]);
        ensure(
          a.path === join(directory, "index.html"),
          "REPORT_PATH",
          "Visual revision path changed",
        );
        if (!(yield* pathExists(a.path))) {
          ensure(
            build.staging &&
              build.staging.startsWith(directory + "/.stage-") &&
              !build.staging.slice(directory.length + 1).includes("/"),
            "REPORT_PATH",
            "Owned staged artifact required",
          );
          const stat = yield* lstat(build.staging);
          ensure(
            stat.isFile() &&
              !stat.isSymbolicLink() &&
              (yield* realpath(build.staging)) === build.staging &&
              stat.size <= maximumHTMLBytes,
            "REPORT_PATH",
            "Staged report ownership changed",
          );
          const html = yield* readFile(build.staging, "utf8");
          ensure(
            reportHash(html) === a.hash && Buffer.byteLength(html) === a.bytes,
            "REPORT_TAMPERED",
            "Staged report digest changed",
          );
          validateReportHTML(html, build.snapshot);
          // Atomic same-filesystem publication without replacing an occupied path.
          // A replacing rename would silently destroy an unrelated revision file.
          yield* link(build.staging, a.path).pipe(
            Effect.catchIf(
              (error) => error.code === "EEXIST",
              () => Effect.void,
            ),
          );
        }
        yield* this.artifactContent(build);
        const published = yield* this.records.coordinateCommit(() =>
          domainEffect(
            Effect.gen({ self: this }, function* () {
              yield* this.sourceCurrent(issue, build);
              return yield* this.updateVisual(issue, build.request.request_id, (current) => ({
                ...current,
                status: "published",
                error: undefined,
              }));
            }),
          ),
        );
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
                    catalog_version: 1,
                    renderer_compatibility: reportRendererVersion,
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
      if (retained?.format === "a2ui-snapshot") {
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
      return yield* this.locks.with(
        LockKey.make(
          `report-html-${digest(JSON.stringify([issue, request.request_id])).slice(0, 40)}`,
        ),
        () =>
          domainEffect(
            Effect.gen({ self: this }, function* () {
              const e = yield* this.records.execution(issue);
              ensure(e, "EXECUTION_MISSING", "Retained execution required for report generation");
              if (workerGeneration !== undefined)
                ensure(
                  isActiveWorker(e, session, { role: "research", generation: workerGeneration }),
                  "RESEARCH_ROLE",
                  "Current Research generation required for visual render request",
                );
              const build = e.visual_reports?.find(
                (b) => b.request.request_id === request.request_id,
              );
              ensure(
                build && JSON.stringify(build.request) === JSON.stringify(request),
                "REPORT_REBIND",
                "Legacy report request is bound to different input",
              );
              ensure(
                reportHash(JSON.stringify(build.snapshot)) === build.input_hash,
                "REPORT_IDENTITY",
                "Captured report input digest changed",
              );
              if (build.status === "published") {
                yield* this.artifactContent(build);
                return build;
              }
              if (build.artifact) {
                // Reconcile publication before considering another build. Missing or
                // conflicting retained output is not evidence that rebuilding is safe.
                return yield* this.publishVisual(issue, build);
              }
              // The retired compiler cannot resume captured legacy inputs. Keep their
              // original identity, snapshot, hashes and any staged evidence intact.
              return yield* this.updateVisual(issue, request.request_id, (current) => ({
                ...current,
                status: "failed",
                error:
                  "Legacy HTML compiler is retired. Retained build evidence is unavailable for resumption; create a new request to save JSON and explicitly export it.",
              }));
            }),
          ),
        { waitSeconds: recovery ? 0 : 30 },
      );
    }.bind(this),
    domainEffect,
  );
  private noticeResult(issue: IssueId, build: VisualBuild) {
    return domainEffect(
      Effect.gen({ self: this }, function* () {
        if (build.format === "a2ui-snapshot" && build.producing_call) {
          if (build.status !== "published" || !build.artifact || build.source_attachment) return;
          const producer = build.producing_call;
          yield* new PresentationAssociations(this.records.store, this.locks).associate({
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
            const source = yield* new SurfacePublications(this.records.store, this.locks).read(
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
              yield* new PresentationAssociations(this.records.store, this.locks).associate({
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
        if (!build.notify_session || !["published", "failed"].includes(build.status)) return;
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
            yield* new PresentationAssociations(this.records.store, this.locks).associate({
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
        e.visual_reports?.some(
          (b) =>
            !["published", "failed"].includes(b.status) ||
            (b.format === "a2ui-snapshot" &&
              (b.request.surface || b.producing_call) &&
              b.status === "published" &&
              !b.source_attachment) ||
            (b.notify_session &&
              !b.request.surface &&
              !b.producing_call &&
              !(b.notices ?? []).some(
                (n) =>
                  n.phase === b.status && n.delivered && (b.status !== "published" || n.associated),
              )),
        ),
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
                    if (["published", "failed"].includes(build.status)) {
                      const pending =
                        build.request.surface || build.producing_call
                          ? build.status === "published" && !build.source_attachment
                          : build.notify_session &&
                            !(build.notices ?? []).some(
                              (notice) =>
                                notice.phase === build.status &&
                                notice.delivered &&
                                (build.status !== "published" || notice.associated),
                            );
                      if (!pending) continue;
                      yield* this.noticeResult(e.issue_id, build).pipe(Effect.ignore);
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
                    if (current) yield* this.noticeResult(e.issue_id, current).pipe(Effect.ignore);
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
