/* oxlint-disable effecttsgo/unstable-api-usage -- Disposable browser/HTTP/stream fixtures exercise the shipped frontend. */

import { Effect, Exit, PubSub, Scope, Stream, Schema } from "effect";

import { WorkPageSchema } from "../../src/visibility/discovery-contracts.ts";
import { LeadEvidencePageSchema } from "../../src/visibility/lead-observation.ts";
import { WorkerHistoryPageSchema } from "../../src/web/worker-history.ts";
import { decode } from "../../src/decode.ts";
import {
  WorkDetailSchema,
  WorkDocumentSchema,
  WorkDiffSchema,
  WorkerInspectionSchema,
  FeedbackPageSchema,
  WorkReportSchema,
  ArtifactsSchema,
  DocumentArtifactSchema,
  ArtifactSummarySchema,
} from "../../src/web/wire.ts";
import { DecisionsSchema } from "../../src/web/http-api.ts";
import { requiresResponse } from "../../src/workflow/message-contracts.ts";

import { MessagesPageSchema, type WebWorkItem } from "../../src/web/wire.ts";

import { CrewError } from "../../src/domain.ts";
import { Timestamp } from "../../src/identities.ts";
import type { WebBackend, WorkReadName } from "../../src/web/contracts.ts";
import { workspaceServer } from "../../src/web/server.ts";
import { WorkspaceFixture } from "./web.ts";
import { launchReportBrowser } from "@abracode/report-export/browser";

export async function workspaceBrowserFixture() {
  const source = new WorkspaceFixture();
  const signals = await Effect.runPromise(PubSub.unbounded<void>());
  const scope = await Effect.runPromise(Scope.make());
  const calls: { name: WorkReadName; input: Record<string, string>; title?: string }[] = [];
  let retained: readonly WebWorkItem[] | undefined;
  let observationOffline = false;
  const failedReads = new Set<WorkReadName>();
  const detailOverrides = new Map<string, Record<string, unknown>>();
  const workerStates = new Map<string, Record<string, unknown>>();
  const workerPages = new Map<string, unknown>();
  const feedbackPages = new Map<number, Record<string, unknown>>();
  const leadPages = new Map<string, unknown>();
  const documentArtifacts = new Map<
    string,
    { json: string; hash: string; bytes: number; title: string }
  >();
  let communications: typeof MessagesPageSchema.Type.entries = [];
  let obligations: typeof DecisionsSchema.Type = { decisions: [], waits: [] };
  const replies: Parameters<WebBackend["replyForm"]>[0][] = [];
  const saves: Parameters<WebBackend["saveSurface"]>[0][] = [];
  const read = (name: WorkReadName, input: Record<string, string>) =>
    Effect.sync(() => {
      const work = (retained ?? source.value.work.work).find(
        (work) => work.issue_id === input.issue_id,
      )!;
      calls.push({ name, input, title: work?.title });
      switch (name) {
        case "find": {
          const offset = Number(input.offset ?? 0),
            limit = Number(input.limit ?? 50);
          const matches = (retained ?? source.value.work.work).filter(
            (work) =>
              (!input.repository_id || work.repository_id === input.repository_id) &&
              (input.state === "all" ||
                (input.state === "closed"
                  ? work.issue_status === "closed"
                  : work.issue_status !== "closed")) &&
              (!input.search ||
                `${work.title} ${work.issue_id}`
                  .toLowerCase()
                  .includes(input.search.toLowerCase())),
          );
          return {
            entries: matches.slice(offset, offset + limit),
            total: matches.length,
            offset,
            limit,
            next_offset: offset + limit < matches.length ? offset + limit : undefined,
            observed_at: source.value.work.at,
            fleet: source.value.work.fleet,
          };
        }
        case "leads":
          return (
            leadPages.get(
              `${input.lead_id ?? ""}/${input.request_offset ?? 0}/${input.proposal_offset ?? 0}`,
            ) ?? {
              issue_id: input.issue_id,
              repository_id: input.repository_id ?? "fixture",
              observed_at: source.value.at,
              entries: [],
              total: 0,
              offset: Number(input.offset ?? 0),
              diagnostics: [],
            }
          );
        case "detail":
          return {
            work,
            description: `Details for ${work.title}`,
            artifacts: [],
            errors: [],
            documents: ["proposal.md"],
            proposal: "# A coherent plan\n\nA **typed** workspace.",
            ...detailOverrides.get(input.issue_id),
          };
        case "document":
          return { path: input.path, content: "# Retained proposal\n\nReadable Markdown." };
        case "diff":
          return {
            at: Timestamp.make("2026-11-15T10:00:00Z"),
            historical: false,
            base: "abcdef012345",
            head: "fedcba987654",
            limited: false,
            file: input.file || undefined,
            files: ["source.ts", "second.ts"].map((path) => ({
              path,
              status: "modified",
              additions: 1,
              deletions: 1,
              binary: false,
              limited: false,
            })),
            patch: (input.file ? [input.file] : ["source.ts", "second.ts"])
              .map(
                (path) =>
                  `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-export const oldValue = 1;\n+export const newValue = 2;\n`,
              )
              .join(""),
          };
        case "report":
          return { content: "# Retained report" };
        case "artifacts": {
          const offset = Number(input.offset ?? 0);
          const rows = [...documentArtifacts].map(([request_id, artifact]) => ({
            request_id,
            title: artifact.title,
            hash: artifact.hash,
            bytes: artifact.bytes,
            format: "a2ui-snapshot",
            status: "published",
            generation: 2,
          }));
          return {
            artifacts: rows.slice(offset, offset + 8),
            total: rows.length,
            offset,
            limit: 8,
            ...(offset + 8 < rows.length ? { next_offset: offset + 8 } : {}),
          };
        }
        case "artifactSummary": {
          const artifact = documentArtifacts.get(input.request_id);
          return artifact?.hash === input.hash
            ? {
                request_id: input.request_id,
                title: artifact.title,
                hash: artifact.hash,
                bytes: artifact.bytes,
                format: "a2ui-snapshot",
                status: "published",
                generation: 2,
              }
            : {};
        }
        case "artifactDocument":
          return documentArtifacts.get(input.request_id);
        case "decisions":
          return obligations;
        case "messages": {
          const offset = Number(input.offset ?? 0),
            limit = 20;
          return {
            entries: communications.slice(offset, offset + limit),
            total: communications.length,
            outstanding: communications.filter(
              (entry) => entry.record.type !== "finding" && requiresResponse(entry.record),
            ).length,
            offset,
            limit,
            next_offset: offset + limit < communications.length ? offset + limit : undefined,
            observed_at: source.value.at,
          };
        }
        case "feedback":
          return {
            issue_id: input.issue_id,
            generation: 0,
            page: Number(input.page ?? 0),
            page_size: 20,
            external_history: [],
            external_history_total: 0,
            findings: [],
            history: [],
            actions: [],
            finding_total: 0,
            history_total: 0,
            action_total: 0,
            ...feedbackPages.get(Number(input.page ?? 0)),
          };
        case "worker":
          return {
            id: input.session_id,
            role: work.sessions.find((session) => session.id === input.session_id)?.role ?? "apply",
            busy: false,
            native_activity: "idle",
            observed_at: source.value.at,
            note: "Read-only native observation",
            ...workerStates.get(input.session_id),
          };
        case "worker-history":
          return (
            workerPages.get(`${input.session_id}/${input.cursor ?? ""}`) ?? {
              session_id: input.session_id,
              observed_at: source.value.at,
              messages: [],
            }
          );
      }
    }).pipe(Effect.delay(input.issue_id === "abra-slow" ? "500 millis" : "0 millis"));
  const operation =
    <S extends Schema.ConstraintDecoder<unknown>>(name: WorkReadName, schema: S) =>
    (query: object) => {
      const input = Object.fromEntries(
        Object.entries(query).flatMap(([key, value]) =>
          value === undefined ? [] : [[key, String(value)]],
        ),
      );
      const result: Effect.Effect<unknown, CrewError> = failedReads.has(name)
        ? Effect.fail(new CrewError("FIXTURE_READ", "Retained resource is temporarily unavailable"))
        : read(name, input);
      return result.pipe(Effect.flatMap((value) => decode(schema, value, "Fixture work read")));
    };
  const backend: WebBackend = {
    sessionID: source.sessionID,
    snapshot: Effect.suspend(() =>
      observationOffline
        ? Effect.fail(new CrewError("FIXTURE_OFFLINE", "Native source is offline"))
        : source.snapshot,
    ),
    observe: () => backend.snapshot,
    resolve: source.resolve,
    surface: source.surface,
    history: source.history,
    submit: source.submit,
    receipt: source.receipt,
    stop: source.stop,
    artifact: source.artifact,
    replyPermission: source.replyPermission,
    exportDocument: (input) => source.exportDocument(input),
    readExport: (input) => source.readExport(input),
    saveSurface: (input) =>
      Effect.sync(() => saves.push(input)).pipe(Effect.andThen(() => source.saveSurface(input))),
    changes: Stream.fromPubSub(signals),
    work: {
      find: operation("find", WorkPageSchema),
      leads: operation("leads", LeadEvidencePageSchema),
      detail: operation("detail", WorkDetailSchema),
      document: operation("document", WorkDocumentSchema),
      diff: operation("diff", WorkDiffSchema),
      worker: operation("worker", WorkerInspectionSchema),
      "worker-history": operation("worker-history", WorkerHistoryPageSchema),
      messages: operation("messages", MessagesPageSchema),
      feedback: operation("feedback", FeedbackPageSchema),
      report: operation("report", WorkReportSchema),
      decisions: operation("decisions", DecisionsSchema),
      artifacts: operation("artifacts", ArtifactsSchema),
      artifactDocument: operation("artifactDocument", DocumentArtifactSchema),
      artifactSummary: operation("artifactSummary", ArtifactSummarySchema),
    },
    replyForm: (input) =>
      Effect.gen(function* () {
        if (input.id === "frm_slow") yield* Effect.sleep("300 millis");
        replies.push(input);
        source.value = {
          ...source.value,
          forms: source.value.forms.filter((form) => form.form.id !== input.id),
        };
      }),
  };
  const web = await Effect.runPromise(
    workspaceServer({ port: 0, backend }).pipe(Effect.provideService(Scope.Scope, scope)),
  );
  const browser = await launchReportBrowser();
  return {
    source,
    backend,
    calls,
    replies,
    saves,
    failedReads,
    detailOverrides,
    workerStates,
    workerPages,
    feedbackPages,
    leadPages,
    documentArtifacts,
    setObservationOffline: (value: boolean) => {
      observationOffline = value;
    },
    setCommunications: (value: unknown) => {
      communications = Schema.decodeUnknownSync(
        Schema.Array(MessagesPageSchema.fields.entries.value),
      )(value);
    },
    setObligations: (value: unknown) => {
      obligations = Schema.decodeUnknownSync(DecisionsSchema)(value);
    },
    setDiscovery: (work: readonly WebWorkItem[]) => {
      retained = work;
    },
    browser,
    origin: web.origin,
    changed: () => Effect.runPromise(PubSub.publish(signals, undefined)),
    close: async () => {
      await browser.close();
      await Effect.runPromise(Scope.close(scope, Exit.void));
    },
  };
}
