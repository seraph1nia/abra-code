import { EvidenceDataSchema } from "@abracode/contracts/web/worker-evidence";
import { VerificationViewSchema } from "@abracode/contracts/web/verification";
import { selectBindingRows } from "@abracode/contracts/web/bindings";
/* oxlint-disable effecttsgo/unstable-api-usage -- Disposable browser/HTTP/stream fixtures exercise the shipped frontend. */

import { Effect, Exit, PubSub, Scope, Stream, Schema } from "effect";

import { WorkPageSchema } from "../../src/visibility/discovery-contracts.ts";
import { LeadEvidencePageSchema } from "../../src/visibility/lead-observation.ts";
import { WorkerHistoryPageSchema } from "../../src/web/worker-history.ts";
import { decode } from "../../src/decode.ts";
import {
  WorkOverviewSchema,
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

type Browser = Awaited<ReturnType<typeof launchReportBrowser>>;
export async function workspaceBrowserFixture(sharedBrowser?: Browser) {
  const source = new WorkspaceFixture();
  const signals = await Effect.runPromise(PubSub.unbounded<void>());
  const scope = await Effect.runPromise(Scope.make());
  const calls: { name: WorkReadName; input: Record<string, string>; title?: string }[] = [];
  let retained: readonly WebWorkItem[] | undefined;
  let fleetObservation: typeof WorkPageSchema.Type.fleet_observation;
  let observationOffline = false;
  const failedReads = new Set<WorkReadName>();
  const detailOverrides = new Map<string, Record<string, unknown>>();
  const workerStates = new Map<string, Record<string, unknown>>();
  const workerPages = new Map<string, unknown>();
  const feedbackPages = new Map<number, Record<string, unknown>>();
  const leadPages = new Map<string, unknown>();
  const documentArtifacts = new Map<
    string,
    { json: string; hash: string; bytes: number; title: string; legacy?: boolean }
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
            capacity: { workers: 0, worker_limit: 2, retained: 1, retained_limit: 4 },
            ...(input.repository_id && {
              project_capacity: { workers: 0, worker_limit: 1, retained: 1, retained_limit: 2 },
            }),
            entries: matches.slice(offset, offset + limit),
            total: matches.length,
            offset,
            limit,
            next_offset: offset + limit < matches.length ? offset + limit : undefined,
            observed_at: source.value.work.at,
            fleet: source.value.work.fleet,
            fleet_observation: fleetObservation,
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
        case "evidence":
          return detailOverrides.get(input.issue_id)?.evidence;
        case "verification":
          return { checks: [], ...(detailOverrides.get(input.issue_id)?.verification as object) };
        case "overview":
          return {
            work,
            description: `Details for ${work.title}`,
            errors: [],
            ...detailOverrides.get(input.issue_id),
          };
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
          return {
            path: input.path,
            content: "# Retained proposal\n\nReadable Markdown.",
            hash: "a".repeat(64),
            generation: 0,
            ...(detailOverrides.get(input.issue_id)?.document as object),
          };
        case "diff":
          return {
            at: Timestamp.make("2026-11-15T10:00:00Z"),
            historical: false,
            base: "abcdef012345",
            head: "f".repeat(40),
            limited: false,
            file: input.file || undefined,
            files: ["source.ts", "second.ts"].map((path) => ({
              path,
              patch_id: (path === "source.ts" ? "a" : "b").repeat(64),
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
            format: artifact.legacy ? "legacy-html" : "a2ui-snapshot",
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
                format: artifact.legacy ? "legacy-html" : "a2ui-snapshot",
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
    repositories: Effect.suspend(() => source.repositories),
    agents: Effect.suspend(() => source.agents),
    get reviews() {
      return source.reviews;
    },
    prepareDiagrams: source.prepareDiagrams,
    sessionID: source.sessionID,
    snapshot: Effect.suspend(() =>
      observationOffline
        ? Effect.fail(new CrewError("FIXTURE_OFFLINE", "Native source is offline"))
        : source.snapshot,
    ),
    observe: () => backend.snapshot,
    resolve: source.resolve,
    publications: (q) => source.publications(q),
    surface: source.surface,
    history: source.history,
    submit: source.submit,
    receipt: source.receipt,
    stop: source.stop,
    completionEvidence: source.completionEvidence,
    artifact: source.artifact,
    replyPermission: source.replyPermission,
    exportDocument: (input) => source.exportDocument(input),
    readExport: (input) => source.readExport(input),
    saveSurface: (input) =>
      Effect.sync(() => saves.push(input)).pipe(Effect.andThen(() => source.saveSurface(input))),
    changes: Stream.fromPubSub(signals),
    work: {
      binding: (input) =>
        Effect.gen(function* () {
          calls.push({
            name: "binding",
            input: {
              issue_ids: input.issue_ids.join(","),
              include_population: String(input.include_population ?? false),
            },
          });
          if (failedReads.has("binding"))
            return yield* new CrewError("FIXTURE_READ", "Binding refresh unavailable");
          const rows = retained ?? source.value.work.work;
          const selected = selectBindingRows(
            { ids: input.issue_ids, unfiltered: !!input.include_population },
            rows,
            rows.length,
          );
          return {
            work: selected.rows,
            coverage: selected.coverage,
            results: input.issue_ids.map((issue_id) => ({
              issue_id,
              status: rows.some((row) => row.issue_id === issue_id)
                ? ("available" as const)
                : ("missing" as const),
            })),
            observed_at: source.value.at,
          };
        }),
      evidenceSearch: (q) => source.work.evidenceSearch(q),
      sessions: (q) => source.work.sessions(q),
      thoughtWork: (q) => source.work.thoughtWork(q),
      thoughtList: (q) => source.work.thoughtList(q),
      thoughtDetail: (q) => source.work.thoughtDetail(q),
      githubInbox: source.work.githubInbox,
      githubItem: source.work.githubItem,
      find: operation("find", WorkPageSchema),
      leads: operation("leads", LeadEvidencePageSchema),
      evidence: operation("evidence", EvidenceDataSchema),
      verification: operation("verification", VerificationViewSchema),
      overview: operation("overview", WorkOverviewSchema),
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
  source.work.artifactDocument = (input) =>
    Effect.sync(() => {
      const artifact = documentArtifacts.get(input.request_id);
      if (
        !artifact ||
        artifact.hash !== input.hash ||
        JSON.parse(artifact.json).provenance?.issue_id !== input.issue_id
      )
        throw new CrewError("FIXTURE_READ", "Selected diagram document is unavailable");
      return {
        json: artifact.json,
        hash: artifact.hash as typeof input.hash,
        bytes: artifact.bytes,
      };
    });
  const web = await Effect.runPromise(
    workspaceServer({ port: 0, backend }).pipe(Effect.provideService(Scope.Scope, scope)),
  );
  const owner = sharedBrowser ?? (await launchReportBrowser());
  const contexts = new Set<Awaited<ReturnType<Browser["newContext"]>>>();
  const newContext = async (options?: Parameters<Browser["newContext"]>[0]) => {
    const context = await owner.newContext(options);
    contexts.add(context);
    return context;
  };
  const browser = {
    newContext,
    newPage: async (options?: Parameters<Browser["newPage"]>[0]) =>
      (await newContext(options)).newPage(),
    close: async () => {
      await Promise.all([...contexts].map((context) => context.close()));
      if (!sharedBrowser) await owner.close();
    },
  };
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
    setFleetObservation: (observation: typeof WorkPageSchema.Type.fleet_observation) => {
      fleetObservation = observation;
    },
    browser,
    origin: web.origin,
    changed: () => Effect.runPromise(PubSub.publish(signals, undefined)),
    close: async () => {
      try {
        await browser.close();
      } finally {
        await Effect.runPromise(Scope.close(scope, Exit.void));
      }
    },
  };
}

export async function chooseAppearance(
  page: Awaited<ReturnType<Browser["newPage"]>>,
  theme: string,
) {
  const phone = (page.viewportSize()?.width ?? 0) <= 760;
  if (phone) await page.getByRole("link", { name: "More", exact: true }).click();
  else if ((page.viewportSize()?.width ?? 1440) <= 1250)
    await page.getByText("Destinations", { exact: true }).click();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("link", { name: "Appearance", exact: true }).click();
  await page.getByLabel("Color theme", { exact: true }).selectOption(theme);
  await page.goBack();
  await page.goBack();
  if (phone) await page.goBack();
}
