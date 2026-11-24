import { join } from "node:path";
import { Effect } from "effect";
import {
  type AbsolutePath,
  type IssueId,
  LockKey,
  type RequestId,
  type SessionId,
} from "@abracode/contracts/identities";
import { CrewError, ensure } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { link, lstat, pathExists, readFile, realpath, rm } from "../filesystem.ts";
import type { Locks } from "../storage/lock.ts";
import type { Records } from "../storage/store.ts";
import { isActiveWorker } from "../workflow/worker-assignment.ts";
import {
  maximumHTMLBytes,
  reportDirectory,
  reportHash,
  validateReportHTML,
} from "./report-build.ts";
import type { VisualBuild, VisualRenderRequestSchema } from "./report-contracts.ts";

/** Read-only and reconciliation compatibility for historical v1 ("legacy-html") artifacts.
 * The v1 HTML compiler itself is retired; no new legacy HTML builds can be executed. */
export function readLegacyHtmlArtifact(home: AbsolutePath, build: VisualBuild) {
  return domainEffect(
    Effect.gen(function* () {
      const a = build.artifact;
      ensure(a, "REPORT_ARTIFACT", "Validated visual artifact receipt required");
      ensure(
        a.schema_version === 1,
        "REPORT_FORMAT",
        "This artifact is a JSON report; use its document reader",
      );
      const expected = join(
        yield* realpath(home),
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

function sourceCurrent(records: Records, issue: IssueId, build: VisualBuild) {
  return domainEffect(
    Effect.gen(function* () {
      const e = yield* records.execution(issue);
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

function publishLegacyHtmlArtifact(
  home: AbsolutePath,
  records: Records,
  issue: IssueId,
  build: VisualBuild,
  updateVisual: (
    issue: IssueId,
    id: RequestId,
    update: (b: VisualBuild) => VisualBuild,
  ) => Effect.Effect<VisualBuild, CrewError>,
) {
  return domainEffect(
    Effect.gen(function* () {
      const a = build.artifact;
      ensure(a, "REPORT_ARTIFACT", "Validated visual artifact required");
      yield* sourceCurrent(records, issue, build);
      const directory = yield* reportDirectory(home, [
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
      yield* readLegacyHtmlArtifact(home, build);
      const published = yield* records.coordinateCommit(() =>
        domainEffect(
          Effect.gen(function* () {
            yield* sourceCurrent(records, issue, build);
            return yield* updateVisual(issue, build.request.request_id, (current) => ({
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

/** Reconcile a retained legacy v1 HTML record without invoking any compiler. */
export function reconcileLegacyHtmlBuild(params: {
  home: AbsolutePath;
  records: Records;
  locks: Locks;
  issue: IssueId;
  session: SessionId;
  request: typeof VisualRenderRequestSchema.Type;
  recovery: boolean;
  workerGeneration?: number;
  updateVisual: (
    issue: IssueId,
    id: RequestId,
    update: (b: VisualBuild) => VisualBuild,
  ) => Effect.Effect<VisualBuild, CrewError>;
}) {
  const {
    home,
    records,
    locks,
    issue,
    session,
    request,
    recovery,
    workerGeneration,
    updateVisual,
  } = params;
  return locks.with(
    LockKey.make(
      `report-html-${reportHash(JSON.stringify([issue, request.request_id])).slice(0, 40)}`,
    ),
    () =>
      domainEffect(
        Effect.gen(function* () {
          const e = yield* records.execution(issue);
          ensure(e, "EXECUTION_MISSING", "Retained execution required for report generation");
          if (workerGeneration !== undefined)
            ensure(
              isActiveWorker(e, session, { role: "research", generation: workerGeneration }),
              "RESEARCH_ROLE",
              "Current Research generation required for visual render request",
            );
          const build = e.visual_reports?.find((b) => b.request.request_id === request.request_id);
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
            yield* readLegacyHtmlArtifact(home, build);
            return build;
          }
          if (build.artifact) {
            // Reconcile already-validated legacy staging without rebuilding.
            return yield* publishLegacyHtmlArtifact(home, records, issue, build, updateVisual);
          }
          // The retired compiler cannot resume captured legacy inputs. Keep their
          // original identity, snapshot, hashes and any staged evidence intact.
          return yield* updateVisual(issue, request.request_id, (current) => ({
            ...current,
            status: "failed",
            error:
              "Legacy HTML compiler is retired. Retained build evidence is unavailable for resumption; create a new request to save JSON and explicitly export it.",
          }));
        }),
      ),
    { waitSeconds: recovery ? 0 : 30 },
  );
}
