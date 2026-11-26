import { captureText } from "@abracode/report-export/renderer-cache";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { Effect } from "effect";
import {
  AbsolutePath,
  ContentHash,
  IssueId,
  LockKey,
  ReportId,
  RequestId,
  SessionId,
} from "@abracode/contracts/identities";
import { CrewError, type Execution } from "../domain.ts";
import { decode } from "../decode.ts";
import { open, pathExists, realpath, rename, rm } from "../filesystem.ts";
import { type Git } from "../git/repository.ts";
import { type Runtime } from "../opencode/runtime.ts";
import { type Locks } from "../storage/lock.ts";
import { type Records } from "../storage/store.ts";
import { type WorkGraph } from "../work/graph.ts";
import { isActiveWorker } from "../workflow/worker-assignment.ts";
import { verifyDiagrams } from "./diagrams.ts";
import { reportDirectory, reportHash } from "./report-build.ts";
import {
  ReportEvidenceSchema,
  ReportInputSchema,
  researchMarkdown,
  type ReportReceiptSchema,
} from "./report-contracts.ts";
import { ReactDocumentRenderer } from "./report-export.ts";
import { ReportExports } from "./report-exports.ts";
import { SurfacePublications } from "../web/surface-publications.ts";
import { VisualReports } from "./visual-reports.ts";

const digest = reportHash;

export class Reports {
  readonly surfaces: SurfacePublications;
  private visual: VisualReports;
  private exports: ReportExports;
  constructor(
    private home: AbsolutePath,
    private records: Records,
    private git: Git,
    private locks: Locks,
    work: WorkGraph,
    notify: Runtime["notify"],
  ) {
    this.exports = new ReportExports(home, locks, new ReactDocumentRenderer(home, git.runner));
    this.surfaces = new SurfacePublications(records.store, locks);
    this.visual = new VisualReports(
      home,
      records,
      locks,
      work,
      notify,
      (e) => this.read(e),
      this.surfaces,
    );
  }
  private path(e: Execution, id: ReportId) {
    return AbsolutePath.make(join(this.home, ".abracode/reports", e.issue_id, `${id}.md`));
  }
  private unchanged = Effect.fn("Reports.unchanged")({ self: this }, function* (e: Execution) {
    if (
      (yield* this.git.head(e.worktree_directory!)) !== e.base_commit ||
      (yield* this.git.dirty(e.worktree_directory!))
    )
      return yield* new CrewError(
        "RESEARCH_CHANGED",
        "Research worktree must remain unchanged at its retained base",
      );
  });
  submit = Effect.fn("Reports.submit")(
    { self: this },
    function* (session: SessionId, input: typeof ReportInputSchema.Type) {
      const a = yield* decode(ReportInputSchema, input, "research report");
      const assigned = yield* this.records.workerAssignment(session);
      if (!assigned || assigned.research_session_id !== session)
        return yield* new CrewError("RESEARCH_ROLE", "Assigned Research session required");
      return yield* this.locks.with(
        LockKey.make(`report-${digest(assigned.execution_id).slice(0, 40)}`),
        () =>
          Effect.gen({ self: this }, function* () {
            const e = (yield* this.records.execution(assigned.issue_id))!;
            if (
              e.workflow_policy !== "research-only" ||
              !isActiveWorker(e, session, { role: "research", generation: a.generation }) ||
              !e.scope
            )
              return yield* new CrewError(
                "RESEARCH_ROLE",
                "Current Research assignment and generation required",
              );
            yield* this.unchanged(e);
            if (
              a.acceptance.length !== e.scope.contract.acceptance.length ||
              !a.acceptance.every((r, i) => r.criterion === e.scope!.contract.acceptance[i])
            )
              return yield* new CrewError(
                "REPORT_ACCEPTANCE",
                "Report must address every scoped acceptance criterion in order",
              );
            for (const finding of a.findings)
              for (const reference of finding.evidence) {
                if (reference.path && reference.base !== e.base_commit)
                  return yield* new CrewError(
                    "REPORT_BASE",
                    "File evidence must use the retained research base",
                  );
              }
            const evidence = yield* decode(ReportEvidenceSchema, a, "Research publication input");
            if (!e.report_receipt && !e.report_intent)
              yield* verifyDiagrams(
                (evidence.diagrams ?? []).map((d, i) => ({
                  id: `research-${i}`,
                  source: d.source,
                })),
              );
            const content = researchMarkdown(e, a.report_id, evidence);
            const bytes = Buffer.byteLength(content);
            if (!(bytes <= 65536))
              return yield* new CrewError("REPORT_LIMIT", "Report exceeds 64 KiB");
            const receipt: typeof ReportReceiptSchema.Type = {
              schema_version: 1,
              issue_id: e.issue_id,
              execution_id: e.execution_id,
              report_id: a.report_id,
              session_id: session,
              base_commit: e.base_commit!,
              scope_fingerprint: e.scope.fingerprint,
              hash: ContentHash.make(digest(content)),
              bytes,
              path: this.path(e, a.report_id),
            };
            const current = yield* this.records.update(e.issue_id, (current) => {
              if (
                current.execution_id !== e.execution_id ||
                current.base_commit !== receipt.base_commit ||
                current.scope?.fingerprint !== receipt.scope_fingerprint ||
                !isActiveWorker(current, session, { role: "research", generation: a.generation })
              )
                throw new CrewError(
                  "REPORT_STALE",
                  "Research assignment changed during report validation",
                );
              if (current.report_intent && current.report_intent.receipt.hash !== receipt.hash)
                throw new CrewError(
                  "REPORT_REBIND",
                  "Report publication already identifies different content",
                );
              if (current.report_receipt && current.report_receipt.hash !== receipt.hash)
                throw new CrewError("REPORT_IMMUTABLE", "Published report is immutable");
              return {
                ...current,
                report_intent: { receipt, content, evidence },
                report_acceptance_met: a.acceptance.every((r) => r.met),
              };
            });
            const { receipt: published } = yield* this.publish(current);
            if (!a.render) return published;
            const visual = yield* this.visual.attach(
              session,
              current.issue_id,
              a.generation,
              a.render,
            );
            return { ...published, visual };
          }),
      );
    },
  );
  private publish = Effect.fn("Reports.publish")({ self: this }, function* (e: Execution) {
    const intent = e.report_intent;
    if (!intent)
      return yield* new CrewError(
        "REPORT_REQUIRED",
        "No retained research report publication intent",
      );
    const { receipt, content } = intent;
    if (
      receipt.path !== this.path(e, receipt.report_id) ||
      digest(content) !== receipt.hash ||
      Buffer.byteLength(content) !== receipt.bytes
    )
      return yield* new CrewError("REPORT_IDENTITY", "Report publication identity changed");
    const dir = yield* reportDirectory(this.home, [".abracode", "reports", e.issue_id]);
    if (!(yield* pathExists(receipt.path))) {
      const temporary = join(dir, `.${receipt.report_id}-${randomUUID()}.tmp`);
      yield* Effect.acquireUseRelease(
        open(temporary, "wx"),
        (file) =>
          Effect.tryPromise({
            try: async () => {
              await file.chmod(0o600);
              await file.writeFile(content, "utf8");
              await file.sync();
            },
            catch: CrewError.from,
          }).pipe(Effect.uninterruptible),
        (file) =>
          Effect.tryPromise({ try: () => file.close(), catch: CrewError.from }).pipe(
            Effect.catch((error) => Effect.logWarning("Resource cleanup failed", error)),
          ),
      );
      yield* rename(temporary, receipt.path).pipe(
        Effect.onError(() =>
          rm(temporary, { force: true }).pipe(
            Effect.catch((error) =>
              Effect.logWarning("Temporary report file preserved", error.code),
            ),
          ),
        ),
      );
    }
    yield* this.readReceipt(e, receipt);
    const current = yield* this.records.update(e.issue_id, (current) => {
      if (
        current.execution_id !== e.execution_id ||
        current.control_generation !== e.control_generation ||
        current.research_session_id !== receipt.session_id ||
        current.scope?.fingerprint !== receipt.scope_fingerprint ||
        current.report_intent?.receipt.hash !== receipt.hash
      )
        throw new CrewError("REPORT_STALE", "Report publication was superseded");
      return { ...current, report_receipt: receipt };
    });
    return { execution: current, receipt };
  });

  generate = (...args: Parameters<VisualReports["generate"]>) => this.visual.generate(...args);
  saveSurface = (...args: Parameters<VisualReports["saveSurface"]>) =>
    this.visual.saveSurface(...args);
  exportDocument = (issue: IssueId, request: RequestId, hash: ContentHash) =>
    this.visual.readDocument(issue, request, hash).pipe(
      Effect.flatMap((a) => this.exports.create(a.json, hash)),
      Effect.map(({ html: _html, ...receipt }) => receipt),
    );
  readExport = (issue: IssueId, request: RequestId, hash: ContentHash, exporter: ContentHash) =>
    this.visual
      .readDocument(issue, request, hash)
      .pipe(Effect.andThen(this.exports.read(hash, exporter)));
  readonly reconcile = Effect.suspend(() => this.visual.recover());
  recover = () => this.visual.recover();
  readDocument = (...args: Parameters<VisualReports["readDocument"]>) =>
    this.visual.readDocument(...args);
  private readReceipt = Effect.fn("Reports.readReceipt")(
    { self: this },
    function* (e: Execution, receipt: typeof ReportReceiptSchema.Type) {
      if (
        receipt.path !== this.path(e, receipt.report_id) ||
        receipt.issue_id !== e.issue_id ||
        receipt.execution_id !== e.execution_id ||
        receipt.base_commit !== e.base_commit ||
        receipt.session_id !== e.research_session_id ||
        receipt.scope_fingerprint !== e.scope?.fingerprint
      )
        return yield* new CrewError(
          "REPORT_IDENTITY",
          "Report receipt does not match the execution",
        );
      if (
        (yield* realpath(receipt.path)) !==
        resolve(
          yield* realpath(this.home),
          ".abracode/reports",
          e.issue_id,
          `${receipt.report_id}.md`,
        )
      )
        return yield* new CrewError("REPORT_PATH", "Report storage traverses a symbolic link");
      const content = yield* Effect.tryPromise({
        try: () => captureText(receipt.path, 65536),
        catch: CrewError.from,
      });
      if (digest(content) !== receipt.hash || Buffer.byteLength(content) !== receipt.bytes)
        return yield* new CrewError(
          "REPORT_TAMPERED",
          "Report content no longer matches its retained hash",
        );
      return content;
    },
  );
  read = (e: Execution) =>
    e.report_receipt
      ? this.readReceipt(e, e.report_receipt)
      : Effect.fail(new CrewError("REPORT_REQUIRED", "Research report is not published"));
  verify = Effect.fn("Reports.verify")({ self: this }, function* (e: Execution) {
    if (!e.report_receipt && e.report_intent) e = (yield* this.publish(e)).execution;
    if (!(e.report_receipt && e.report_acceptance_met))
      return yield* new CrewError(
        "REPORT_REQUIRED",
        "A valid report meeting the scoped acceptance criteria is required",
      );
    yield* this.read(e);
    return e;
  });
}
