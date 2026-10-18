import { WorkerInspectionSchema } from "../../../src/visibility/worker.ts";
import { configurationReport } from "../../../src/config/declarations.ts";
import { configuration } from "../../../src/config/protocol.ts";
import { CrewError } from "../../../src/domain.ts";
import { installRoleProfiles } from "../../../src/opencode/role-policy.ts";
import { FeedbackPageSchema } from "../../../src/workflow/feedback-contracts.ts";
import { observerRequest } from "../../../src/observability.ts";
import { Invalidations } from "../../../src/visibility/invalidations.ts";
import { observerResult } from "../../../src/visibility/errors.ts";
import { decodeJSON } from "../../../src/decode.ts";
import {
  WorkSnapshotSchema,
  WorkDetailSchema,
  WorkDiffSchema,
  WorkDocumentSchema,
  WorkReportSchema,
  visibility,
} from "../../../src/visibility/protocol.ts";
import { AbsolutePath, LockKey } from "../../../src/identities.ts";
import { Plugin } from "@opencode/plugin/effect";
import { Context, Effect, Layer, Schema } from "effect";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { realpath } from "../../../src/filesystem.ts";
import { FileLocks } from "../../../src/storage/lock.ts";
import { Crew, applicationLayer } from "../../../src/opencode/application.ts";
import { installGuards } from "../../../src/opencode/guards.ts";
import { registerTools } from "../../../src/opencode/tools.ts";
import { registerSkills } from "../../../src/opencode/skills.ts";
import { monitor } from "../../../src/recovery/monitor.ts";

import { Visibility } from "../../../src/visibility/read-model.ts";

export default Plugin.define({
  id: "abracode",
  effect: (ctx) => {
    const home = process.env.ABRACODE_HOME ?? fileURLToPath(new URL("../../../", import.meta.url));
    return Effect.gen(function* () {
      if (ctx.app.version !== "2.0.28")
        return yield* Effect.die(
          new Error(`AbraCode requires OpenCode 2.0.28; got ${ctx.app.version}`),
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
      const observer = new Visibility(c);
      const json =
        <S extends Schema.Constraint>(schema: S) =>
        (value: S["Type"]) =>
          decodeJSON(schema, JSON.stringify(value), "Observer response");
      // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- OpenCode declares unknown here; the adapter maps it to CrewError or a plugin defect.
      const registration = yield* ctx.rpc.register(visibility, {
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
      // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- Native publication exposes unknown; publication failure cannot fail a committed mutation.
      const emitChanged = registration.events.emit("changed", { home: config.home }).pipe(
        Effect.mapError(() => new Error("Invalidation publication failed")),
        Effect.ignore,
      );
      yield* invalidations.take.pipe(
        Effect.andThen(c.queries.afterCommit()),
        Effect.andThen(emitChanged),
        Effect.forever,
        Effect.forkScoped,
      );
      if (central) yield* monitor(ctx, c, application.scheduler).pipe(provide);
    }).pipe(Effect.orDie);
  },
});
