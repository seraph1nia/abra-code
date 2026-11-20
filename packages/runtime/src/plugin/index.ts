import { EvidenceDataSchema } from "@abracode/contracts/web/worker-evidence";
import { VerificationViewSchema } from "@abracode/contracts/web/verification";
import { BindingReadSchema } from "@abracode/contracts/web/bindings";
import { LeadEvidencePageSchema } from "../visibility/lead-observation.ts";
import { registerWebGateway } from "../web/gateway.ts";
import { readAgentCatalog } from "../web/agent-settings.ts";
import { nativeReviews } from "../web/review-tool.ts";
import { WorkPageSchema } from "../visibility/discovery-contracts.ts";
import { WorkerInspectionSchema } from "../visibility/worker.ts";
import { configurationReport } from "../config/declarations.ts";
import { configuration } from "../config/protocol.ts";
import { CrewError } from "../domain.ts";
import { FeedbackPageSchema } from "../workflow/feedback-contracts.ts";
import { MessagesPageSchema } from "../workflow/message-contracts.ts";
import { observerRequest } from "../observability.ts";
import { Invalidations } from "../visibility/invalidations.ts";
import { observerResult } from "../visibility/errors.ts";
import { decodeJSON } from "../decode.ts";
import {
  WorkSnapshotSchema,
  WorkOverviewSchema,
  WorkDetailSchema,
  WorkDiffSchema,
  WorkDocumentSchema,
  WorkReportSchema,
  visibility,
} from "../visibility/protocol.ts";
import { AbsolutePath, LockKey } from "../identities.ts";
import { Plugin } from "@opencode/plugin/effect";
import type { Context as PluginContext } from "@opencode/plugin/effect/plugin";
import { Context, Effect, Layer, Queue, Schedule, Schema } from "effect";
import { resolve } from "node:path";
import { sourceInstallationRoot } from "../installation.ts";
import { realpath } from "../filesystem.ts";
import { FileLocks } from "../storage/lock.ts";
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
        if (ctx.app.version !== "2.3.0")
          return yield* Effect.die(
            new Error(`AbraCode requires OpenCode 2.3.0; got ${ctx.app.version}`),
          );
        // Callbacks outlive registration: retain layer resources in the host plugin scope.
        const services = yield* Layer.build(applicationLayer(ctx, home, catalog?.(ctx, home)));
        const application = Context.get(services, Crew);
        const provide = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
          effect.pipe(Effect.provide(services));
        const c = application.controller;
        const config = application.config;
        const central = (yield* realpath(ctx.location.directory)) === config.home;
        const reviews = central ? nativeReviews(ctx, c) : undefined;
        if (central)
          yield* new FileLocks(AbsolutePath.make(resolve(config.home, ".abracode/locks"))).acquire(
            LockKey.make("scheduler-leader"),
          );
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
          // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- Native RPC registration exposes an open handler-error channel.
          yield* ctx.rpc.register(configuration, {
            // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- Native RPC uses an open handler-error channel; domain errors are mapped to refused below.
            reconcile: ({ session_id, action, page, config_path }, { error }) =>
              Effect.gen(function* () {
                if (config_path && config_path !== config.config_path)
                  return yield* Effect.fail(
                    error(
                      "refused",
                      "The running service uses another configuration file. Restart with the selected ABRACODE_CONFIG before applying it.",
                      { code: "CONFIG_RESTART" },
                    ),
                  );
                const session = yield* application.controller.queries.session(session_id);
                if (
                  session.agent !== "abra" ||
                  session.directory !== config.home ||
                  (yield* c.queries.assignment(session_id))
                )
                  return yield* Effect.fail(
                    error("refused", "Use the central Abra session", { code: "ABRA_REQUIRED" }),
                  );
                if (action === "apply" && session.busy)
                  return yield* Effect.fail(
                    error(
                      "refused",
                      "Wait until Abra is idle before applying configuration from the CLI",
                      { code: "ABRA_BUSY" },
                    ),
                  );
                const outcomes = yield* action === "apply"
                  ? application.configuration.apply()
                  : application.configuration.status();
                return configurationReport(outcomes, page, config);
              }).pipe(
                Effect.mapError((failure) =>
                  failure instanceof CrewError
                    ? error("refused", failure.message, { code: failure.code })
                    : failure,
                ),
                provide,
              ),
          });
        if (reviews)
          // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- Native RPC registration declares an open handler-error channel; handlers map domain errors to refused.
          yield* registerWebGateway(
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
                  decodeJSON(schema, JSON.stringify(value), "Observer response"),
                ),
              ),
              error,
            ).pipe(provide);
        // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- Native RPC registration exposes an open error channel.
        const registration = yield* ctx.rpc.register(visibility, {
          binding: read(BindingReadSchema, (query) => observer.binding(query)),
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
            ({ issue_id, page }) => observer.feedback(issue_id, page),
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
        yield* invalidations.take.pipe(
          Effect.flatMap((scope) =>
            observer.invalidateFinder(scope).pipe(
              Effect.andThen(c.queries.afterCommit()),
              Effect.andThen(
                // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- Native emit declares unknown errors; immediate mapping/ignore isolates publication from commits.
                registration.events.emit("changed", { home: config.home, scope }).pipe(
                  Effect.mapError(() => new Error("Invalidation publication failed")),
                  Effect.ignore,
                ),
              ),
            ),
          ),
          Effect.forever,
          Effect.forkScoped,
        );
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
