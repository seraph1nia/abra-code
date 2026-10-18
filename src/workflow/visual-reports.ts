import { Clock, Effect } from "effect";
import { randomUUID } from "node:crypto";
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
import { lstat, open, pathExists, readFile, realpath, rm, link } from "../filesystem.ts";
import { VisualRenderRequestSchema, type VisualBuild } from "./report-contracts.ts";
import { isActiveWorker } from "./worker-assignment.ts";
import { captureReportSnapshot } from "./report-snapshot.ts";
import {
  reportDirectory,
  reportHash,
  maximumHTMLBytes,
  validateReportHTML,
  type ReportRenderer,
} from "./report-build.ts";
const digest = reportHash;
/** Private Reports implementation for optional HTML attachments. No workflow,
 * approval or Markdown acceptance transition is owned here. */
export class VisualReports {
  constructor(
    private home: AbsolutePath,
    private records: Records,
    private locks: Locks,
    private work: WorkGraph,
    private notify: Runtime["notify"],
    private renderer: ReportRenderer,
    private readReport: (e: Execution) => Effect.Effect<string, CrewError>,
  ) {}
  /** Explicit artifact authority, independent of workflow advancement. */
  generate = Effect.fn("Reports.generate")(
    function* (
      this: VisualReports,
      session: SessionId,
      issue: IssueId,
      request: typeof VisualRenderRequestSchema.Type,
    ) {
      ensure(
        (yield* this.records.supervisor()) === session,
        "ABRA_REQUIRED",
        "Retained Abra required for report generation",
      );
      const result = yield* Effect.result(this.generateOwned(issue, session, request));
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
  private withBuildSlot<A>(action: () => Effect.Effect<A, CrewError>) {
    let first = false,
      second = false;
    return this.locks
      .with(
        LockKey.make("report-build-slot-0"),
        () => {
          first = true;
          return action();
        },
        { waitSeconds: 0 },
      )
      .pipe(
        Effect.catchIf(
          (error) => !first && error.code === "LOCKED",
          () =>
            this.locks
              .with(
                LockKey.make("report-build-slot-1"),
                () => {
                  second = true;
                  return action();
                },
                { waitSeconds: 0 },
              )
              .pipe(
                Effect.catchIf(
                  (error) => !second && error.code === "LOCKED",
                  () =>
                    Effect.fail(new CrewError("REPORT_CAPACITY", "Report build capacity occupied")),
                ),
              ),
        ),
      );
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
  private artifactContent(build: VisualBuild) {
    return domainEffect(
      Effect.gen({ self: this }, function* () {
        const a = build.artifact;
        ensure(a, "REPORT_ARTIFACT", "Validated visual artifact receipt required");
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
    ) {
      const request = yield* decode(VisualRenderRequestSchema, raw, "Visual report request");
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
              let build = e.visual_reports?.find(
                (b) => b.request.request_id === request.request_id,
              );
              if (build)
                ensure(
                  JSON.stringify(build.request) === JSON.stringify(request),
                  "REPORT_REBIND",
                  "Visual report request is bound to different input",
                );
              else {
                ensure(
                  (e.visual_reports?.length ?? 0) < 16,
                  "REPORT_LIMIT",
                  "Visual report revision limit reached",
                );
                const content = e.report_receipt ? yield* this.readReport(e) : undefined;
                const snapshot = yield* captureReportSnapshot(
                  this.work,
                  e,
                  content,
                  request.title,
                  request.diagrams,
                );
                const template_hash = yield* this.renderer.fingerprint;
                const captured: VisualBuild = {
                  request,
                  requested_by: session,
                  notify_session: e.supervisor_session_id ?? (yield* this.records.supervisor()),
                  generation: e.control_generation,
                  source_report: e.report_receipt
                    ? { report_id: e.report_receipt.report_id, hash: e.report_receipt.hash }
                    : undefined,
                  snapshot,
                  input_hash: reportHash(JSON.stringify(snapshot)),
                  template_hash,
                  status: "pending",
                };
                const updated = yield* this.records.update(issue, (current) => {
                  if (workerGeneration !== undefined)
                    ensure(
                      isActiveWorker(current, session, {
                        role: "research",
                        generation: workerGeneration,
                      }),
                      "RESEARCH_ROLE",
                      "Research render request was superseded",
                    );
                  ensure(
                    current.control_generation === captured.generation &&
                      current.execution_id === captured.snapshot.execution_id,
                    "REPORT_STALE",
                    "Report source changed during capture",
                  );
                  return {
                    ...current,
                    visual_reports: [...(current.visual_reports ?? []), captured],
                  };
                });
                build = updated.visual_reports!.find(
                  (b) => b.request.request_id === request.request_id,
                )!;
              }
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
              yield* this.sourceCurrent(issue, build);
              if (
                build.status === "building" &&
                build.deadline_at! > (yield* Clock.currentTimeMillis)
              )
                return build;
              const owned = build;
              const attempt = yield* Effect.result(
                this.withBuildSlot(() =>
                  domainEffect(
                    Effect.gen({ self: this }, function* () {
                      build = yield* this.records.coordinateCommit(() =>
                        domainEffect(
                          Effect.gen({ self: this }, function* () {
                            const now = yield* Clock.currentTimeMillis;
                            const active = (yield* this.records.executions())
                              .flatMap((record) => record.visual_reports ?? [])
                              .filter(
                                (b) => b.status === "building" && (b.deadline_at ?? Infinity) > now,
                              );
                            ensure(
                              active.length < 2,
                              "REPORT_CAPACITY",
                              "Retained compiler reservations occupy capacity until their deadline",
                            );
                            return yield* this.updateVisual(
                              issue,
                              request.request_id,
                              (current) => ({
                                ...current,
                                status: "building",
                                deadline_at: now + 45000,
                                error: undefined,
                              }),
                            );
                          }),
                        ),
                      );
                      const html = yield* this.renderer.render(owned.snapshot, owned.template_hash);
                      validateReportHTML(html, owned.snapshot);
                      yield* this.sourceCurrent(issue, owned);
                      const directory = yield* reportDirectory(this.home, [
                        ".abracode",
                        "reports",
                        "generated",
                        issue,
                        request.request_id,
                      ]);
                      const path = AbsolutePath.make(join(directory, "index.html"));
                      ensure(
                        !(yield* pathExists(path)),
                        "REPORT_OCCUPIED",
                        "Visual revision destination is occupied; preserve it and inspect retained evidence",
                      );
                      const staging = AbsolutePath.make(
                        join(directory, `.stage-${randomUUID()}.html`),
                      );
                      yield* Effect.acquireUseRelease(
                        open(staging, "wx"),
                        (file) =>
                          Effect.tryPromise({
                            try: async () => {
                              await file.chmod(0o600);
                              await file.writeFile(html, "utf8");
                              await file.sync();
                            },
                            catch: CrewError.from,
                          }).pipe(Effect.uninterruptible),
                        (file) =>
                          Effect.tryPromise({
                            try: () => file.close(),
                            catch: CrewError.from,
                          }).pipe(Effect.orDie),
                      );
                      build = yield* this.updateVisual(issue, request.request_id, (current) => ({
                        ...current,
                        status: "validated",
                        staging,
                        artifact: {
                          schema_version: 1,
                          request_id: request.request_id,
                          issue_id: issue,
                          execution_id: e.execution_id,
                          generation: current.generation,
                          input_hash: current.input_hash,
                          template_hash: current.template_hash,
                          hash: reportHash(html),
                          bytes: Buffer.byteLength(html),
                          path,
                          observed_at: Timestamp.make(current.snapshot.observed_at),
                          source_report: current.source_report,
                        },
                      }));
                      return yield* this.publishVisual(issue, build);
                    }),
                  ),
                ),
              );
              if (attempt._tag === "Success") return attempt.success;
              if (attempt.failure.code === "REPORT_CAPACITY")
                return yield* this.updateVisual(issue, request.request_id, (current) => ({
                  ...current,
                  status: "pending",
                  error: "Report build capacity is occupied; retry the same request.",
                }));
              yield* this.updateVisual(issue, request.request_id, (current) => ({
                ...current,
                status: current.artifact ? "validated" : "failed",
                error: attempt.failure.message.slice(0, 8192),
              }));
              return yield* attempt.failure;
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
        for (const notice of current.notices ?? [])
          if (!notice.delivered) {
            yield* this.notify(current.notify_session!, notice.text, notice.message_id);
            current = yield* this.updateVisual(issue, build.request.request_id, (b) => ({
              ...b,
              notices: b.notices?.map((n) =>
                n.message_id === notice.message_id ? { ...n, delivered: true } : n,
              ),
            }));
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
            (b.notify_session &&
              !(b.notices ?? []).some((n) => n.phase === b.status && n.delivered)),
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
                      yield* this.noticeResult(e.issue_id, build).pipe(Effect.ignore);
                      continue;
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
