import { advanceAfterIdle } from "../helpers/workspace-advance.ts";
import { DecisionsSchema } from "@abracode/contracts/web/http-api";
import { MessagesPageSchema, FeedbackPageSchema } from "@abracode/contracts/web/wire";
import { WorkerHistoryPageSchema } from "@abracode/contracts/web/worker-history";
import { DocumentArtifactSchema } from "@abracode/contracts/web/wire";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { Effect, Schema } from "effect";
import { IssueId, RequestId, ContentHash, SessionId } from "@abracode/contracts/identities";
import { NativeWebBackend } from "../../src/web/backend.ts";
import type { WorkspaceJourneyInput } from "./workspace.ts";
import type { WorkspaceBootstrap } from "./workspace-bootstrap-checks.ts";
import type { WorkspacePresentations, DiagramEvidence } from "./workspace-browser-checks.ts";
import type { WorkspaceStreaming } from "./workspace-streaming-checks.ts";
/** Keep one actual native admission/restart check; history-window UI matrices
 * belong to the browser and admission unit tests. */
async function prepareAdmissionRecovery(backend: NativeWebBackend) {
  const original = (await Effect.runPromise(backend.snapshot)).receipts.find(
    (receipt) => receipt.status === "admitted",
  );
  assert.ok(original);
  return async () => {
    assert.deepEqual(await Effect.runPromise(backend.receipt(original.request_id)), original);
    return { request_id: original.request_id, native_restart: true };
  };
}
export async function checkWorkspaceDelivery(
  input: WorkspaceJourneyInput,
  backend: NativeWebBackend,
  origin: string,
  { page, errors, commandCount, command, issue, population }: WorkspaceBootstrap,
  { openLayout, nativeFeedback }: WorkspacePresentations,
  { nativeTrace, partialBeforeRelease, observers }: WorkspaceStreaming,
  { diagramPerformance }: DiagramEvidence,
) {
  await command("abra_work_start", { issue_id: issue });
  const approved = new Set<string>();
  let savedReport: { request_id: string; hash: string; url: string } | undefined;
  let exportedReport:
    | {
        request_id: string;
        document_hash: string;
        exporter_hash: string;
        hash: string;
        bytes: number;
      }
    | undefined;
  let composedReport: { request_id: string; hash: string } | undefined;
  const deadline = Date.now() + 120000;
  let lastAdvance = 0;
  while (Date.now() < deadline) {
    const status = await input.readStatus(issue);
    const state = status.execution;
    if (state.current_phase === "completed") {
      assert.ok(
        approved.has("plan"),
        "Branch delivery must retain the browser's human plan authorization",
      );
      assert.equal(status.issue.status, "closed");
      assert.equal(status.outcome.cleanup.state, "retired");
      assert.equal(status.outcome.closure, "closed");
      assert.ok(savedReport);
      assert.ok(composedReport);
      assert.ok(exportedReport);
      const restoreAdmission = await prepareAdmissionRecovery(backend);
      await input.restart();
      const admissionRecovery = await restoreAdmission();
      await page.goto(savedReport.url);
      await page.locator(".frozen-report").waitFor();
      await page.locator('.frozen-report [data-diagram-state="ready"]').nth(31).waitFor();
      const concurrent = await Effect.runPromise(
        Effect.forEach(
          [0, 1],
          () =>
            backend.prepareDiagrams({
              kind: "report",
              issue_id: IssueId.make(issue),
              request_id: RequestId.make(savedReport!.request_id),
              hash: ContentHash.make(savedReport!.hash),
            }),
          { concurrency: 2 },
        ),
      );
      assert.ok(concurrent.every((value) => value.verified && value.metrics?.compilations === 0));
      if (diagramPerformance)
        diagramPerformance.concurrent_warm = concurrent.map((value) => value.metrics);
      const restored = Schema.decodeSync(DocumentArtifactSchema)(
        await Effect.runPromise(
          backend.work["artifactDocument"]({
            issue_id: IssueId.make(issue),
            request_id: RequestId.make(savedReport.request_id),
            hash: ContentHash.make(savedReport.hash),
          }),
        ),
      );
      assert.equal(
        JSON.parse(restored.json).data.work.find(
          (work: { issue_id: string }) => work.issue_id === issue,
        ).phase,
        "awaiting_plan_approval",
      );
      const restoredExport = await Effect.runPromise(
        backend.readExport({
          issue_id: IssueId.make(issue),
          request_id: RequestId.make(exportedReport.request_id),
          hash: ContentHash.make(exportedReport.document_hash),
          exporter_hash: ContentHash.make(exportedReport.exporter_hash),
        }),
      );
      assert.equal(restoredExport.hash, exportedReport.hash);
      assert.equal(restoredExport.bytes, exportedReport.bytes);
      await page.getByRole("button", { name: "Other reports", exact: true }).click();
      await page
        .locator(".report-revision")
        .filter({ hasText: "Native composed evidence" })
        .getByRole("button", { name: "Preview", exact: true })
        .click();
      await page.locator('[data-report-section="checks"]').waitFor();
      assert.match(await page.locator('[data-report-section="checks"]').innerText(), /not run/);
      assert.doesNotMatch(
        await page.locator('[data-report-section="checks"]').innerText(),
        /passed/,
      );
      const worker = state.apply_session_id as string;
      assert.ok(worker, "Completed work retains its implementation session identity");
      const transcript = Schema.decodeSync(WorkerHistoryPageSchema)(
        await Effect.runPromise(
          backend.work["worker-history"]({
            issue_id: IssueId.make(issue),
            session_id: SessionId.make(worker),
          }),
        ),
      );
      assert.equal(transcript.session_id, worker);
      assert.ok(transcript.messages.length > 0, "Retired native worker history remains readable");
      assert.ok(transcript.messages.length <= 8);
      if (transcript.older) {
        const earlier = Schema.decodeSync(WorkerHistoryPageSchema)(
          await Effect.runPromise(
            backend.work["worker-history"]({
              issue_id: IssueId.make(issue),
              session_id: SessionId.make(worker),
              cursor: transcript.older,
            }),
          ),
        );
        assert.equal(earlier.session_id, worker);
        assert.ok(
          !earlier.messages.some((message) =>
            transcript.messages.some((current) => current.id === message.id),
          ),
        );
      }
      await assert.rejects(
        Effect.runPromise(
          backend.work["worker-history"]({
            issue_id: IssueId.make(issue),
            session_id: SessionId.make(worker),
            cursor: "forged-history-cursor",
          }),
        ),
        /not issued/,
      );
      await assert.rejects(
        Effect.runPromise(
          backend.work["worker-history"]({
            issue_id: IssueId.make(issue),
            session_id: SessionId.make(input.session),
          }),
        ),
        /own|selection|resource/i,
      );

      const inspectionsBefore = input.providerCount();
      const decisions = Schema.decodeSync(DecisionsSchema)(
        await Effect.runPromise(backend.work["decisions"]({ issue_id: IssueId.make(issue) })),
      );
      const communication = Schema.decodeSync(MessagesPageSchema)(
        await Effect.runPromise(backend.work["messages"]({ issue_id: IssueId.make(issue) })),
      );
      const checks = Schema.decodeSync(FeedbackPageSchema)(
        await Effect.runPromise(backend.work["feedback"]({ issue_id: IssueId.make(issue) })),
      );
      assert.ok(Array.isArray(decisions.decisions));
      assert.ok(communication.total >= communication.entries.length);
      assert.ok(checks.finding_total >= checks.findings.length);
      await page
        .getByRole("tablist", { name: "Work details", exact: true })
        .getByRole("tab", { name: "Activity", exact: true })
        .click();
      await page.getByRole("heading", { name: "Worker transcript", exact: true }).waitFor();
      await page.getByLabel("Read-only worker session", { exact: true }).selectOption(worker);
      await page.getByRole("tab", { name: "Communication", exact: true }).click();
      await page.getByRole("navigation", { name: "Communication pages", exact: true }).waitFor();
      await page.getByRole("tab", { name: "Reviews & checks", exact: true }).click();
      await page.getByRole("heading", { name: "Reviews & checks", exact: true }).waitFor();
      await page.getByRole("navigation", { name: "Review and check pages", exact: true }).waitFor();
      assert.equal(
        await page.getByRole("textbox", { name: "Message Abra", exact: true }).count(),
        1,
      );
      assert.equal(
        input.providerCount(),
        inspectionsBefore,
        "Owned evidence inspection must not admit a provider turn",
      );
      if (input.evidence)
        await page.screenshot({
          path: join(input.evidence, "native-completed.png"),
          fullPage: true,
        });
      assert.deepEqual(errors, []);
      assert.deepEqual(
        observers.flatMap((observer) => observer.errors),
        [],
      );
      const streamed = observers.flatMap((observer) => observer.events);
      assert.ok(
        streamed.includes("arguments"),
        "Actual native tool arguments must reach the standard HTTP consumer",
      );
      assert.ok(
        streamed.includes("text"),
        "Actual native text must reach the standard HTTP consumer",
      );
      assert.ok(streamed.includes("result"));
      assert.deepEqual(partialBeforeRelease, { tool: true, text: true });
      const historical = await Effect.runPromise(backend.surface("workspace-board", 1));
      assert.ok(!("unavailable" in historical));
      assert.equal(
        historical.surface.createSurface.components[1]!.text,
        "Native workspace coding journey",
      );

      const recoveredReviewReceipt = await Effect.runPromise(
        backend.reviews!.receipt({
          review_id: nativeFeedback.review_id,
          revision: nativeFeedback.revision,
          hash: nativeFeedback.hash,
          request_id: nativeFeedback.request_id,
        }),
      );
      assert.deepEqual(
        recoveredReviewReceipt,
        nativeFeedback,
        "Review receipt must survive actual native restart and worktree retirement",
      );

      return {
        issue_id: issue,
        phase: state.current_phase,
        approvals_in_browser: [...approved],
        commands: commandCount(),
        interface: "copilotkit-v2/ag-ui/a2ui-1.0",
        native_session_id: input.session,
        stale_plan_reply_refused: true,
        pending_native_form_recreated_after_restart: true,
        saved_json_report: savedReport,
        composed_json_report: composedReport,
        exported_html_report: exportedReport,
        export_reopened_after_native_restart: true,
        admission_recovery: admissionRecovery,
        interactive_review: {
          review_id: nativeFeedback.review_id,
          revision: nativeFeedback.revision,
          request_id: nativeFeedback.request_id,
          receipt_after_restart: true,
          followup_published: true,
        },
        binding_coverage: {
          population: 57,
          companion: population.companion,
          off_page: population.offPage.id,
          snapshot_retained: true,
          live_resolved: true,
        },
        native_transport: {
          observers: observers.length,
          observer_errors: observers.flatMap((observer) => observer.errors),
          text_events: streamed.filter((type) => type === "text").length,
          argument_events: streamed.filter((type) => type === "arguments").length,
          result_events: streamed.filter((type) => type === "result").length,
          reconnected_without_replay: true,
          partial_before_provider_release: partialBeforeRelease,
          trace: nativeTrace.slice(-512),
        },
        typed_native_evidence_inspection: {
          decisions: decisions.decisions.length,
          communication: communication.total,
          findings: checks.finding_total,
          provider_calls: 0,
        },
      };
    }
    assert.notEqual(state.current_phase, "failed", JSON.stringify(state.error_or_recovery_reason));
    // This journey delivers a branch. Human merge authorization belongs to the
    // real PR journey; a transient awaiting_merge phase can retire automatically.
    const kind = state.current_phase === "awaiting_plan_approval" ? "plan" : undefined;
    const workersIdle =
      status.sessions?.length > 0 &&
      status.sessions.every(
        (worker: any) =>
          worker.busy === false && worker.executing !== true && worker.outcome === "succeeded",
      );
    if (kind && workersIdle && !approved.has(kind)) {
      const unpublished = await fetch(`${origin}/api/work/report?issue_id=${issue}`);
      assert.equal(unpublished.status, 200);
      assert.deepEqual(await unpublished.json(), { unavailable: "not_published" });
      const requested = await command("abra_work_approve", { issue_id: issue, kind });
      if (requested.category === "operation_in_progress") continue;
      if (kind === "plan") {
        const checkpoint = (await Effect.runPromise(backend.snapshot)).forms.find(
          (item) => item.checkpoint?.issue_id === issue && item.checkpoint.kind === kind,
        );
        assert.ok(checkpoint?.active, "The native plan form is bound to the current checkpoint");
        const proposal = join(
          state.worktree_directory,
          "openspec/changes",
          state.openspec_change,
          "proposal.md",
        );
        const captured = await readFile(proposal);
        try {
          await writeFile(
            proposal,
            Buffer.concat([captured, Buffer.from("\nChanged after approval request.\n")]),
          );
          await assert.rejects(
            Effect.runPromise(
              backend.replyForm({
                id: checkpoint.form.id,
                binding: checkpoint.binding,
                answer: {},
              }),
            ),
            /checkpoint changed/i,
          );
          assert.equal(
            (
              await input.client.session.form.get({
                sessionID: input.session,
                formID: checkpoint.form.id,
              })
            ).state.status,
            "pending",
          );
        } finally {
          await writeFile(proposal, captured);
        }
        assert.ok(
          (await Effect.runPromise(backend.snapshot)).forms.find(
            (item) => item.form.id === checkpoint.form.id,
          )?.active,
        );
        await input.restart();
        await page.reload();
        await page.getByRole("textbox", { name: "Message Abra" }).waitFor();
        await command("abra_work_approve", { issue_id: issue, kind });
        assert.ok(
          (await Effect.runPromise(backend.snapshot)).forms.find(
            (item) => item.form.id === checkpoint.form.id,
          )?.active,
          "Recreated native form keeps the current checkpoint identity",
        );
        await page
          .getByRole("tablist", { name: "Work details", exact: true })
          .getByRole("tab", { name: "Overview", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Review current plan approval", exact: true })
          .click();
        await assert.rejects(
          Effect.runPromise(
            backend.saveSurface({
              issue_id: IssueId.make(issue),
              request_id: RequestId.make("stale-surface-save"),
              surface_id: "workspace-board",
              revision: 1,
            }),
          ),
          /revision changed/i,
        );
        await openLayout(2);
        const producingView = page.locator(
          '.inspector [data-surface-reference="workspace-board/2"]',
        );
        const beforeSave = (
          await input.client.session.context({ sessionID: input.session })
        ).filter((message) => message.type === "user").length;
        const providerBeforeSave = input.providerCount();
        await producingView
          .getByLabel("Save snapshot with task", { exact: true })
          .selectOption(issue);
        const saveResponse = page.waitForResponse(
          (response) => response.url() === `${origin}/api/report/save-surface`,
        );
        await producingView.getByRole("button", { name: "Save snapshot", exact: true }).click();
        const response = await saveResponse;
        assert.equal(response.status(), 200, await response.text());
        const artifact = await response.json();
        assert.equal(artifact.format, "a2ui-snapshot");
        await producingView.getByRole("button", { name: "Open saved report", exact: true }).click();
        await page.locator(".frozen-report").waitFor();
        savedReport = { request_id: artifact.request_id, hash: artifact.hash, url: page.url() };
        const download = page.getByRole("link", {
          name: "Download selected JSON",
          exact: true,
        });
        const json = await (
          await fetch(new URL((await download.getAttribute("href"))!, origin))
        ).json();
        assert.equal(json.provenance.source_surface.revision, 2);
        assert.equal(
          json.surface.createSurface.components.filter((c: any) => c.component === "Mermaid")
            .length,
          32,
        );
        await page.locator('.frozen-report [data-diagram-state="ready"]').nth(31).waitFor();
        assert.ok(
          json.data.work.some(
            (row: { issue_id: string }) => row.issue_id === population.offPage.id,
          ),
        );
        assert.ok(
          json.data.snapshot_work.some(
            (row: { issue_id: string }) => row.issue_id === population.companion,
          ),
        );
        assert.equal(json.data.snapshot_coverage.total, 57);
        assert.equal(json.data.live_coverage.total, 2);

        assert.equal(
          json.data.work.find((work: any) => work.issue_id === issue).phase,
          "awaiting_plan_approval",
        );
        assert.equal(
          json.data.snapshot_work.find((work: any) => work.issue_id === issue).issue_status,
          "open",
        );
        assert.equal(
          (await input.client.session.context({ sessionID: input.session })).filter(
            (message) => message.type === "user",
          ).length,
          beforeSave,
          "Saving/opening a snapshot must not admit a native prompt",
        );
        await input.client.session.wait({ sessionID: input.session });
        assert.equal(
          input.providerCount(),
          providerBeforeSave,
          "Saving/opening a snapshot must not call the provider",
        );
        const exportResponse = page.waitForResponse(
          (response) => response.url() === `${origin}/api/report/export`,
        );
        await page.getByRole("button", { name: "Export offline HTML", exact: true }).click();
        const exported = await exportResponse;
        assert.equal(exported.status(), 200, await exported.text());
        const exportReceipt = await exported.json();
        exportedReport = { ...exportReceipt, request_id: artifact.request_id };
        assert.equal(exportReceipt.document_hash, artifact.hash);
        const exportDownload = page.getByRole("link", {
          name: "Download exported HTML",
          exact: true,
        });
        const downloaded = await fetch(
          new URL((await exportDownload.getAttribute("href"))!, origin),
        );
        assert.match(downloaded.headers.get("content-disposition") ?? "", /attachment/);
        const exportedHTML = await downloaded.text();
        assert.equal(Buffer.byteLength(exportedHTML), exportReceipt.bytes);
        assert.ok(exportReceipt.bytes < 8 * 1024 * 1024);
        assert.deepEqual(
          await Effect.runPromise(
            backend.exportDocument({
              issue_id: IssueId.make(issue),
              request_id: RequestId.make(artifact.request_id),
              hash: ContentHash.make(artifact.hash),
            }),
          ),
          exportReceipt,
        );
        await page.getByRole("button", { name: "Preview exported HTML", exact: true }).click();
        await page
          .frameLocator('iframe[title="Offline HTML export"]')
          .getByRole("heading", { name: json.title, exact: true })
          .waitFor();
        await page.getByRole("button", { name: "Close HTML preview", exact: true }).click();
        assert.equal(
          input.providerCount(),
          providerBeforeSave,
          "Explicit HTML export must not call the provider",
        );
        const composed = await command("abra_work_report", {
          issue_id: issue,
          action: "generate",
          request_id: "native-composed-report",
          title: "Native composed evidence",
        });
        assert.equal(composed.format, "a2ui-snapshot");
        assert.equal(composed.source_attachment, "associated");
        assert.equal(composed.notify_session, undefined);
        assert.equal(composed.notices, undefined);
        composedReport = {
          request_id: composed.request.request_id,
          hash: composed.artifact.hash,
        };
        await page.reload();
        await page.locator(".frozen-report").waitFor();
        await page.getByRole("button", { name: "Close inspector", exact: true }).click();
      }
      const dock = page.getByRole("link", { name: "Attention", exact: true });
      if (!(await dock.isVisible())) await page.getByText("Destinations", { exact: true }).click();
      await dock.click();
      const forms = page
        .locator(".attention-card")
        .filter({ has: page.getByText(new RegExp(`Authorize ${kind} for ${issue}`)) });
      await forms.getByRole("checkbox", { name: /Authorize this exact checkpoint/ }).check();
      const submit = forms.getByRole("button", { name: "Submit checkpoint decision" });
      assert.equal(await submit.isEnabled(), true, await forms.innerText());
      try {
        const [response] = await Promise.all([
          page.waitForResponse((r) => r.url() === `${origin}/api/form/reply`, {
            timeout: 5000,
          }),
          submit.click(),
        ]);
        assert.equal(response.status(), 200, await response.text());
      } catch (error) {
        throw new Error(
          `Checkpoint submit failed: ${String(error)}; ${await forms.innerText()}; ${JSON.stringify((await Effect.runPromise(backend.snapshot)).forms)}`,
        );
      }
      await command("abra_work_approve", { issue_id: issue, kind });
      approved.add(kind);
    } else if (workersIdle && Date.now() - lastAdvance > 2000) {
      await advanceAfterIdle({
        before: status,
        advance: () =>
          command("abra_work_control", {
            issue_id: issue,
            action: "advance",
            request_id: `workspace-advance-${commandCount()}`,
          }),
        readStatus: () => input.readStatus(issue),
        context: (sessionID) => input.client.session.context({ sessionID }),
      });
      lastAdvance = Date.now();
    }
    await new Promise((done) => setTimeout(done, 200));
  }
  throw new Error(
    `Browser coding journey did not complete: ${JSON.stringify(await input.readStatus(issue))}`,
  );
}
