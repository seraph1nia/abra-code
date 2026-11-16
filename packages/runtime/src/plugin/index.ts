import { BindingReadSchema } from "@abracode/contracts/web/bindings";
import { LeadEvidencePageSchema } from "../visibility/lead-observation.ts";
import { registerWebGateway } from "../web/gateway.ts";
import { WorkPageSchema } from "../visibility/discovery-contracts.ts";
import { WorkerInspectionSchema } from "../visibility/worker.ts";
import { configurationReport } from "../config/declarations.ts";
import { configuration } from "../config/protocol.ts";
import { CrewError } from "../domain.ts";
import { installRoleProfiles } from "../opencode/role-policy.ts";
import { FeedbackPageSchema } from "../workflow/feedback-contracts.ts";
import { MessagesPageSchema } from "../workflow/message-contracts.ts";
import { observerRequest } from "../observability.ts";
import { Invalidations } from "../visibility/invalidations.ts";
import { observerResult } from "../visibility/errors.ts";
import { decodeJSON } from "../decode.ts";
import {
  WorkSnapshotSchema,
  WorkDetailSchema,
  WorkDiffSchema,
  WorkDocumentSchema,
  WorkReportSchema,
  visibility,
} from "../visibility/protocol.ts";
import { AbsolutePath, LockKey } from "../identities.ts";
import { Plugin } from "@opencode/plugin/effect";
import { Context, Effect, Layer, Schema } from "effect";
import { resolve } from "node:path";
import { sourceInstallationRoot } from "../installation.ts";
import { realpath } from "../filesystem.ts";
import { FileLocks } from "../storage/lock.ts";
import { Crew, applicationLayer } from "../opencode/application.ts";
import { installGuards } from "../opencode/guards.ts";
import { registerTools } from "../opencode/tools.ts";
import { registerSkills } from "../opencode/skills.ts";
import { monitor } from "../recovery/monitor.ts";

import { Visibility } from "../visibility/read-model.ts";

export default Plugin.define({
  id: "abracode",
  effect: (ctx) => {
    const home = process.env.ABRACODE_HOME ?? sourceInstallationRoot();
    return Effect.gen(function* () {
      if (ctx.app.version !== "2.3.0")
        return yield* Effect.die(
          new Error(`AbraCode requires OpenCode 2.3.0; got ${ctx.app.version}`),
        );
      // Callbacks outlive registration: retain layer resources in the host plugin scope.
      const services = yield* Layer.build(applicationLayer(ctx, home));
      const application = Context.get(services, Crew);
      const provide = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        effect.pipe(Effect.provide(services));
      const c = application.controller;
      const config = application.config;
      const central = (yield* realpath(ctx.location.directory)) === config.home;
      if (central)
        yield* new FileLocks(AbsolutePath.make(resolve(config.home, ".abracode/locks"))).acquire(
          LockKey.make("scheduler-leader"),
        );
      yield* installRoleProfiles(ctx, central);
      yield* registerSkills(ctx, config.home, central);
      yield* installGuards(ctx, c, provide);
      yield* registerTools(
        ctx,
        c,
        application.onboarding,
        central,
        application.setup,
        provide,
        application.configuration,
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
      // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- Native RPC registration declares an open handler-error channel; handlers map domain errors to refused.
      if (central) yield* registerWebGateway(ctx, config, c, provide);
      const observer = new Visibility(c);
      const json =
        <S extends Schema.Constraint>(schema: S) =>
        (value: S["Type"]) =>
          decodeJSON(schema, JSON.stringify(value), "Observer response");
      // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- OpenCode declares unknown here; the adapter maps it to CrewError or a plugin defect.
      const registration = yield* ctx.rpc.register(visibility, {
        binding: (query, { error }) =>
          observerResult(
            observer.binding(query).pipe(Effect.flatMap(json(BindingReadSchema))),
            error,
          ).pipe(provide),
        find: (query, { error }) =>
          observerResult(
            observer.find(query).pipe(Effect.flatMap(json(WorkPageSchema))),
            error,
          ).pipe(provide),
        leads: (query, { error }) =>
          observerResult(
            c.queries.leadEvidence(query).pipe(Effect.flatMap(json(LeadEvidencePageSchema))),
            error,
          ).pipe(provide),
        messages: ({ issue_id, offset }, { error }) =>
          observerResult(
            observerRequest("messages").pipe(
              Effect.andThen(
                c.queries.messages(issue_id, offset).pipe(Effect.flatMap(json(MessagesPageSchema))),
              ),
            ),
            error,
          ).pipe(provide),
        worker: ({ issue_id, session_id }, { error }) =>
          observerResult(
            c.queries
              .inspectWorker(issue_id, session_id)
              .pipe(Effect.flatMap(json(WorkerInspectionSchema))),
            error,
          ).pipe(provide),
        feedback: ({ issue_id, page }, { error }) =>
          observerResult(
            observerRequest("feedback").pipe(
              Effect.andThen(
                observer.feedback(issue_id, page).pipe(Effect.flatMap(json(FeedbackPageSchema))),
              ),
            ),
            error,
          ).pipe(provide),
        report: ({ issue_id }, { error }) =>
          observerResult(
            observerRequest("report").pipe(
              Effect.andThen(
                observer.report(issue_id).pipe(Effect.flatMap(json(WorkReportSchema))),
              ),
            ),
            error,
          ).pipe(provide),
        snapshot: ({ closed_page }, { error }) =>
          observerResult(
            observerRequest("snapshot").pipe(
              Effect.andThen(
                observer.snapshot(closed_page).pipe(Effect.flatMap(json(WorkSnapshotSchema))),
              ),
            ),
            error,
          ).pipe(provide),
        diff: ({ issue_id, scope, file }, { error }) =>
          observerResult(
            observerRequest("diff").pipe(
              Effect.andThen(
                observer.diff(issue_id, scope, file).pipe(Effect.flatMap(json(WorkDiffSchema))),
              ),
            ),
            error,
          ).pipe(provide),
        document: ({ issue_id, path }, { error }) =>
          observerResult(
            observerRequest("document").pipe(
              Effect.andThen(
                observer.document(issue_id, path).pipe(Effect.flatMap(json(WorkDocumentSchema))),
              ),
            ),
            error,
          ).pipe(provide),
        detail: ({ issue_id }, { error }) =>
          observerResult(
            observerRequest("detail").pipe(
              Effect.andThen(
                observer.detail(issue_id).pipe(Effect.flatMap(json(WorkDetailSchema))),
              ),
            ),
            error,
          ).pipe(provide),
      });
      const invalidations = Context.get(services, Invalidations);
      yield* invalidations.take.pipe(
        Effect.flatMap((scope) =>
          c.queries.afterCommit().pipe(
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
      if (central) yield* monitor(ctx, c, application.scheduler).pipe(provide);
    }).pipe(Effect.orDie);
  },
});
