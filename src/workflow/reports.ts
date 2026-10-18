import { VisualReports } from "./visual-reports.ts";
import { LockKey, ContentHash, AbsolutePath, ReportId, SessionId } from "../identities.ts";
import { synchronizeExecution, type Records } from "../storage/store.ts";

import { Effect } from "effect";
import { type Runtime } from "../opencode/runtime.ts";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { CrewError, type Execution } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { decode } from "../decode.ts";
import { mkdir, lstat, open, pathExists, readFile, realpath, rename, rm } from "../filesystem.ts";

import { type Git } from "../git/repository.ts";
import { type Locks } from "../storage/lock.ts";
import {
  ReportEvidenceSchema,
  researchMarkdown,
  ReportInputSchema,
  type ReportReceiptSchema,
} from "./report-contracts.ts";
import { isActiveWorker } from "./worker-assignment.ts";
const digest = reportHash;
import { type WorkGraph } from "../work/graph.ts";
import { reportHash, ViteReportRenderer, type ReportRenderer } from "./report-build.ts";
export class Reports {
  private visual: VisualReports;
  constructor(
    private home: AbsolutePath,
    private records: Records,
    private git: Git,
    private locks: Locks,
    work: WorkGraph,
    notify: Runtime["notify"],
    renderer?: ReportRenderer,
  ) {
    this.visual = new VisualReports(
      home,
      records,
      locks,
      work,
      notify,
      renderer ?? new ViteReportRenderer(home, git.runner),
      (e) => this.read(e),
    );
  }
  private path(e: Execution, id: ReportId) {
    return AbsolutePath.make(join(this.home, ".abracode/reports", e.issue_id, `${id}.md`));
  }
  private unchanged = Effect.fn("Reports.unchanged")(
    function* (this: Reports, e: Execution) {
      if (
        !(
          (yield* this.git.head(e.worktree_directory!)) === e.base_commit &&
          !(yield* this.git.dirty(e.worktree_directory!))
        )
      )
        return yield* new CrewError(
          "RESEARCH_CHANGED",
          "Research worktree must remain unchanged at its retained base",
        );
    }.bind(this),
    domainEffect,
  );
  submit = Effect.fn("Reports.submit")(
    function* (this: Reports, session: SessionId, input: typeof ReportInputSchema.Type) {
      const a = yield* decode(ReportInputSchema, input, "research report");
      const assigned = (yield* this.records.executions()).find(
        (e) => e.research_session_id === session,
      );
      if (!assigned)
        return yield* new CrewError("RESEARCH_ROLE", "Assigned Research session required");
      return yield* this.locks.with(
        LockKey.make(`report-${digest(assigned.execution_id).slice(0, 40)}`),
        () =>
          domainEffect(
            Effect.gen({ self: this }, function* () {
              const e = (yield* this.records.execution(assigned.issue_id))!;
              if (
                !(
                  e.workflow_policy === "research-only" &&
                  isActiveWorker(e, session, { role: "research", generation: a.generation }) &&
                  e.scope
                )
              )
                return yield* new CrewError(
                  "RESEARCH_ROLE",
                  "Current Research assignment and generation required",
                );
              yield* this.unchanged(e);
              if (
                !(
                  a.acceptance.length === e.scope.contract.acceptance.length &&
                  a.acceptance.every((r, i) => r.criterion === e.scope!.contract.acceptance[i])
                )
              )
                return yield* new CrewError(
                  "REPORT_ACCEPTANCE",
                  "Report must address every scoped acceptance criterion in order",
                );
              for (const finding of a.findings)
                for (const reference of finding.evidence) {
                  if (!(!reference.path || reference.base === e.base_commit))
                    return yield* new CrewError(
                      "REPORT_BASE",
                      "File evidence must use the retained research base",
                    );
                }
              const evidence = yield* decode(ReportEvidenceSchema, a, "Research publication input");
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
                  !(
                    current.execution_id === e.execution_id &&
                    current.base_commit === receipt.base_commit &&
                    current.scope?.fingerprint === receipt.scope_fingerprint &&
                    isActiveWorker(current, session, { role: "research", generation: a.generation })
                  )
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
              const published = yield* this.publish(current);
              if (!a.render) return published;
              const visual = yield* this.visual.attach(
                session,
                current.issue_id,
                a.generation,
                a.render,
              );
              return { ...published, visual };
            }),
          ),
      );
    }.bind(this),
    domainEffect,
  );
  publish = Effect.fn("Reports.publish")(
    function* (this: Reports, e: Execution) {
      const intent = e.report_intent;
      if (!intent)
        return yield* new CrewError(
          "REPORT_REQUIRED",
          "No retained research report publication intent",
        );
      const { receipt, content } = intent;
      if (
        !(
          receipt.path === this.path(e, receipt.report_id) &&
          digest(content) === receipt.hash &&
          Buffer.byteLength(content) === receipt.bytes
        )
      )
        return yield* new CrewError("REPORT_IDENTITY", "Report publication identity changed");
      let dir = this.home;
      const home = yield* realpath(this.home);
      for (const part of [".abracode", "reports", e.issue_id]) {
        dir = AbsolutePath.make(join(dir, part));
        yield* mkdir(dir, { recursive: true, mode: 0o700 });
        const stat = yield* lstat(dir);
        if (
          !(
            stat.isDirectory() &&
            !stat.isSymbolicLink() &&
            (yield* realpath(dir)) === resolve(home, "." + dir.slice(this.home.length))
          )
        )
          return yield* new CrewError(
            "REPORT_PATH",
            "Report storage must be owned real directories",
          );
      }
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
              Effect.orDie,
            ),
        );
        yield* rename(temporary, receipt.path).pipe(
          Effect.onError(() => rm(temporary, { force: true }).pipe(Effect.ignore)),
        );
      }
      yield* this.readReceipt(e, receipt);
      const current = yield* this.records.update(e.issue_id, (current) => {
        if (
          !(
            current.execution_id === e.execution_id &&
            current.control_generation === e.control_generation &&
            current.research_session_id === receipt.session_id &&
            current.scope?.fingerprint === receipt.scope_fingerprint &&
            current.report_intent?.receipt.hash === receipt.hash
          )
        )
          throw new CrewError("REPORT_STALE", "Report publication was superseded");
        return { ...current, report_receipt: receipt };
      });
      synchronizeExecution(e, current);
      return receipt;
    }.bind(this),
    domainEffect,
  );

  generate = (...args: Parameters<VisualReports["generate"]>) => this.visual.generate(...args);
  recover = () => this.visual.recover();
  private readReceipt = Effect.fn("Reports.readReceipt")(
    function* (this: Reports, e: Execution, receipt: typeof ReportReceiptSchema.Type) {
      if (
        !(
          receipt.path === this.path(e, receipt.report_id) &&
          receipt.issue_id === e.issue_id &&
          receipt.execution_id === e.execution_id &&
          receipt.base_commit === e.base_commit &&
          receipt.session_id === e.research_session_id &&
          receipt.scope_fingerprint === e.scope?.fingerprint
        )
      )
        return yield* new CrewError(
          "REPORT_IDENTITY",
          "Report receipt does not match the execution",
        );
      const stat = yield* lstat(receipt.path);
      if (!(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 65536))
        return yield* new CrewError("REPORT_PATH", "Report must be a bounded regular file");
      if (
        !(
          (yield* realpath(receipt.path)) ===
          resolve(
            yield* realpath(this.home),
            ".abracode/reports",
            e.issue_id,
            `${receipt.report_id}.md`,
          )
        )
      )
        return yield* new CrewError("REPORT_PATH", "Report storage traverses a symbolic link");
      const content = yield* readFile(receipt.path, "utf8");
      if (!(digest(content) === receipt.hash && Buffer.byteLength(content) === receipt.bytes))
        return yield* new CrewError(
          "REPORT_TAMPERED",
          "Report content no longer matches its retained hash",
        );
      return content;
    }.bind(this),
    domainEffect,
  );
  read = (e: Execution) =>
    e.report_receipt
      ? this.readReceipt(e, e.report_receipt)
      : Effect.fail(new CrewError("REPORT_REQUIRED", "Research report is not published"));
  verify = Effect.fn("Reports.verify")(
    function* (this: Reports, e: Execution) {
      if (!e.report_receipt && e.report_intent) yield* this.publish(e);
      if (!(e.report_receipt && e.report_acceptance_met))
        return yield* new CrewError(
          "REPORT_REQUIRED",
          "A valid report meeting the scoped acceptance criteria is required",
        );
      yield* this.read(e);
    }.bind(this),
    domainEffect,
  );
}
