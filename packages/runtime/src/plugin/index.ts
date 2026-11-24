import {
  EvidenceSearchPage,
  SessionPage,
} from "@abracode/contracts/visibility/discovery-contracts";
import { ThoughtWorkPage } from "@abracode/contracts/visibility/thoughts";
import { ThoughtPage, ThoughtDetail } from "@abracode/contracts/visibility/thoughts";
import { InboxPage, InboxDetail } from "@abracode/contracts/visibility/github-inbox";
import { EvidenceDataSchema } from "@abracode/contracts/web/worker-evidence";
import { VerificationViewSchema } from "@abracode/contracts/web/verification";
import { BindingReadSchema } from "@abracode/contracts/web/bindings";
import { LeadEvidencePageSchema } from "@abracode/contracts/visibility/lead-observation";
import { registerWebGateway } from "../web/gateway.ts";
import { readAgentCatalog } from "../web/agent-settings.ts";
import { nativeReviews } from "../web/review-tool.ts";
import { WorkPageSchema } from "@abracode/contracts/visibility/discovery-contracts";
import { WorkerInspectionSchema } from "@abracode/contracts/visibility/worker";
import { configurationReport } from "../config/declarations.ts";
import { configuration } from "../config/protocol.ts";
import { CrewError } from "../domain.ts";
import { FeedbackPageSchema } from "@abracode/contracts/workflow/feedback-contracts";
import { MessagesPageSchema } from "@abracode/contracts/workflow/message-contracts";
import { observerRequest } from "../observability.ts";
import { Invalidations, publishInvalidations } from "../visibility/invalidations.ts";
import { observerResult } from "../visibility/errors.ts";
import { OPENCODE_VERSION } from "../opencode/client.ts";
import { nativeInvoke, nativeRpcRegister } from "../opencode/native-call.ts";
import { assertSupervisor } from "../opencode/session-authority.ts";
import { stripUndefined } from "../opencode/tool-definition.ts";
import {
  WorkSnapshotSchema,
  WorkOverviewSchema,
  WorkDetailSchema,
  WorkDiffSchema,
  WorkDocumentSchema,
  WorkReportSchema,
  visibility,
} from "../visibility/protocol.ts";
import { LockKey } from "@abracode/contracts/identities";
import { Plugin } from "@opencode/plugin/effect";
import type { Context as PluginContext } from "@opencode/plugin/effect/plugin";
import { Context, Effect, Layer, Queue, Schedule, Schema } from "effect";
import { sourceInstallationRoot } from "../installation.ts";
import { Crew, applicationLayer } from "../opencode/application.ts";
import { installGuards } from "../opencode/guards.ts";
import { registerTools } from "../opencode/tools.ts";
import { monitor } from "../recovery/monitor.ts";

import { Visibility } from "../visibility/read-model.ts";

/** Programmatic catalogs are supplied by trusted application code, never loaded from YAML. */
export const createPlugin = (
  catalog?: (ctx: PluginContext, home: string) => Parameters<typeof applicationLayer>[2],
) =>
  Plugin.define({
    id: "abracode",
    effect: (ctx) => {
      const home = process.env.ABRACODE_HOME ?? sourceInstallationRoot();
      return Effect.gen(function* () {
        if (ctx.app.version !== OPENCODE_VERSION)
          return yield* Effect.die(
            new Error(`AbraCode requires OpenCode ${OPENCODE_VERSION}; got ${ctx.app.version}`),
          );
        // Callbacks outlive registration: retain layer resources in the host plugin scope.
        const services = yield* Layer.build(applicationLayer(ctx, home, catalog?.(ctx, home)));
        const application = Context.get(services, Crew);
        const provide = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
          effect.pipe(Effect.provide(services));
        const c = application.controller;
        const { config, central, locks } = application;
        const reviews = central ? nativeReviews(ctx, c) : undefined;
        if (central) yield* locks.acquire(LockKey.make("scheduler-leader"));
        yield* installGuards(ctx, c, provide);
        yield* registerTools(
          ctx,
          c,
          application.onboarding,
          central,
          application.setup,
          provide,
          application.configuration,
          reviews,
        );
        if (central)
          yield* nativeRpcRegister(ctx, configuration, {
            reconcile: ({ session_id, action, page, config_path }, { error }) =>
              Effect.gen(function* () {
                if (config_path && config_path !== config.config_path)
                  return yield* new CrewError(
                    "CONFIG_RESTART",
                    "The running service uses another configuration file. Restart with the selected ABRACODE_CONFIG before applying it.",
                  );
                const session = yield* assertSupervisor(c, session_id, {
                  verifyNative: true,
                  code: "ABRA_REQUIRED",
                  message: "Use the central Abra session",
                });
                if (action === "apply" && session.busy)
                  return yield* new CrewError(
                    "ABRA_BUSY",
                    "Wait until Abra is idle before applying configuration from the CLI",
                  );
                const outcomes = yield* action === "apply"
                  ? application.configuration.apply()
                  : application.configuration.status();
                return configurationReport(outcomes, page, config);
              }).pipe(
                Effect.mapError((failure) =>
                  error("refused", failure.message, { code: failure.code }),
                ),
                provide,
              ),
          });
        if (reviews)
          yield* nativeInvoke(
            registerWebGateway,
            ctx,
            config,
            c,
            reviews.reviews,
            provide(readAgentCatalog),
            provide,
          );
        const finderRequests = yield* Effect.acquireRelease(
          Queue.dropping<void>(1),
          Queue.shutdown,
        );
        const observer = new Visibility(c, finderRequests);
        const read =
          <I, S extends Schema.Constraint, R>(
            schema: S,
            handler: (input: I) => Effect.Effect<NoInfer<S["Type"]>, CrewError, R>,
            method?: Parameters<typeof observerRequest>[0],
          ) =>
          (input: I, { error }: { error: Parameters<typeof observerResult>[1] }) =>
            observerResult(
              (method ? observerRequest(method) : Effect.void).pipe(
                Effect.andThen(() => handler(input)),
                Effect.flatMap((value) =>
                  Schema.decodeUnknownEffect(Schema.toType(schema), { reportInput: false })(
                    stripUndefined(value),
                  ).pipe(
                    Effect.mapError(
                      (err) =>
                        new CrewError(
                          "INVALID_DATA",
                          `Observer response: ${err.message.slice(0, 2048)}`,
                        ),
                    ),
                    Effect.orDie,
                  ),
                ),
              ),
              error,
              method === "githubInbox" || method === "githubItem",
            ).pipe(provide);
        const registration = yield* nativeRpcRegister(ctx, visibility, {
          binding: read(BindingReadSchema, (query) => observer.binding(query)),
          evidenceSearch: read(EvidenceSearchPage, (q) =>
            central
              ? c.queries.discoverEvidence(q)
              : Effect.fail(new CrewError("ABRA_REQUIRED", "Use the central workspace")),
          ),
          sessions: read(SessionPage, (q) =>
            central
              ? observer.sessionSearch(q)
              : Effect.fail(new CrewError("ABRA_REQUIRED", "Use the central workspace")),
          ),
          thoughtWork: read(ThoughtWorkPage, (q) =>
            central
              ? c.thoughts.get(q, "http").pipe(Effect.andThen(() => c.queries.thoughtWork(q)))
              : Effect.fail(new CrewError("ABRA_REQUIRED", "Use the central workspace")),
          ),
          thoughtList: read(ThoughtPage, (q) =>
            central
              ? c.thoughts.list(q, "http")
              : Effect.fail(new CrewError("ABRA_REQUIRED", "Use the central Thoughts view")),
          ),
          thoughtDetail: read(ThoughtDetail, (q) =>
            central
              ? c.thoughts.get(q, "http")
              : Effect.fail(new CrewError("ABRA_REQUIRED", "Use the central Thoughts view")),
          ),
          githubInbox: read(
            InboxPage,
            (query) =>
              central
                ? c.inbox.list(query)
                : Effect.fail(new CrewError("ABRA_REQUIRED", "Use the central work inbox")),
            "githubInbox",
          ),
          githubItem: read(
            InboxDetail,
            (query) =>
              central
                ? c.inbox.detail(query)
                : Effect.fail(new CrewError("ABRA_REQUIRED", "Use the central work inbox")),
            "githubItem",
          ),
          find: read(WorkPageSchema, (query) => observer.find(query)),
          leads: read(LeadEvidencePageSchema, (query) => c.queries.leadEvidence(query)),
          messages: read(
            MessagesPageSchema,
            ({ issue_id, offset }) => c.queries.messages(issue_id, offset),
            "messages",
          ),
          worker: read(WorkerInspectionSchema, ({ issue_id, session_id }) =>
            c.queries.inspectWorker(issue_id, session_id),
          ),
          feedback: read(
            FeedbackPageSchema,
            ({ issue_id, page, finding_id, revision }) =>
              observer.feedback(issue_id, page, finding_id, revision),
            "feedback",
          ),
          report: read(WorkReportSchema, ({ issue_id }) => observer.report(issue_id), "report"),
          snapshot: read(
            WorkSnapshotSchema,
            ({ closed_page }) => observer.snapshot(closed_page),
            "snapshot",
          ),
          diff: read(
            WorkDiffSchema,
            ({ issue_id, scope, file }) => observer.diff(issue_id, scope, file),
            "diff",
          ),
          document: read(
            WorkDocumentSchema,
            ({ issue_id, path }) => observer.document(issue_id, path),
            "document",
          ),
          evidence: read(EvidenceDataSchema, (query) => c.queries.evidence(query)),
          verification: read(VerificationViewSchema, ({ issue_id }) =>
            c.queries.verification(issue_id),
          ),
          overview: read(
            WorkOverviewSchema,
            ({ issue_id }) => observer.overview(issue_id),
            "overview",
          ),
          detail: read(WorkDetailSchema, ({ issue_id }) => observer.detail(issue_id), "detail"),
        });
        const invalidations = Context.get(services, Invalidations);
        yield* publishInvalidations(invalidations, c.queries.afterCommit(), (scope) =>
          observer
            .invalidateFinder(scope)
            .pipe(
              Effect.andThen(
                registration.events
                  .emit("changed", { home: config.home, scope })
                  .pipe(Effect.ignore),
              ),
            ),
        ).pipe(Effect.forkScoped);
        yield* Queue.take(finderRequests).pipe(
          Effect.andThen(observer.refreshFinder),
          Effect.forever,
          provide,
          Effect.forkScoped,
        );
        yield* observer.requestFinderRefresh.pipe(
          Effect.repeat(Schedule.spaced(config.reconcile_interval_ms)),
          Effect.forkScoped,
        );
        if (central) yield* monitor(ctx, c, application.scheduler).pipe(provide);
      }).pipe(Effect.orDie);
    },
  });
export default createPlugin();
