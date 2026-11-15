import { Git } from "../git/repository.ts";
import { ProcessRunner } from "../process.ts";
import { fullPlanFingerprint } from "../workflow/planning.ts";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import type { Context } from "@opencode/plugin/effect/plugin";
import { SessionMessage } from "@opencode/schema/session-message";
import { AbsolutePath, LockKey, SessionId, StorageKey, StoragePrefix } from "../identities.ts";
import { CrewError, type Config } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { NativeStore, type Store } from "../storage/store.ts";
import { FileLocks, type Locks } from "../storage/lock.ts";
import { NativeRuntime } from "../opencode/runtime.ts";
import { type Controller } from "../workflow/controller.ts";
import { decode } from "../decode.ts";
import { webGateway } from "./protocol.ts";

import { ReceiptSchema, type SubmissionReceipt } from "./http-api.ts";
export type { SubmissionReceipt } from "./http-api.ts";

/** Admission is separate from controller effects. A receipt never authorizes work. */
export class WebAdmissions {
  constructor(
    private store: Store,
    private runtime: Pick<NativeRuntime, "promptAdmission" | "prompt">,
    private locks: Locks,
  ) {}
  submit(
    session: SessionId,
    input: { request_id: string; text: string; delivery: "queue" | "steer" },
  ) {
    return this.locks.with(LockKey.make("web-admission"), () =>
      domainEffect(
        Effect.gen({ self: this }, function* () {
          if (
            !/^[a-zA-Z0-9_-]{1,100}$/.test(input.request_id) ||
            !input.text.trim() ||
            input.text.length > 32768
          )
            return yield* new CrewError("WEB_INPUT", "Invalid submission identity or text");
          const key = StorageKey.make(`web/receipt/${session}/${input.request_id}`);
          const raw = yield* this.store.get(key);
          const prior = raw === undefined ? undefined : yield* decode(ReceiptSchema, raw, key);
          if (prior && (prior.text !== input.text || prior.delivery !== input.delivery))
            return yield* new CrewError(
              "WEB_CONFLICT",
              "Submission identity is already bound to different input",
            );
          const receipt: SubmissionReceipt = prior ?? {
            ...input,
            message_id: SessionMessage.ID.create(),
            status: "submitted",
            at: new Date().toISOString(),
          };
          if (receipt.status === "admitted") return receipt;
          if (prior) {
            const observation = yield* this.runtime.promptAdmission(
              session,
              receipt.message_id,
              receipt.text,
            );
            if (observation !== "absent") {
              const admitted = { ...receipt, status: "admitted" as const };
              yield* this.store.set(key, admitted);
              return admitted;
            }
            // Absence after a lost response cannot prove that a native turn never ran.
            // Preserve the ID and input; never submit another message on its behalf.
            const uncertain = { ...receipt, status: "uncertain" as const };
            yield* this.store.set(key, uncertain);
            return uncertain;
          }
          yield* this.store.set(key, receipt);
          const admission = yield* this.runtime
            .prompt(session, receipt.text, receipt.message_id, receipt.delivery === "steer")
            .pipe(Effect.result);
          const next = {
            ...receipt,
            status: admission._tag === "Success" ? ("admitted" as const) : ("uncertain" as const),
          };
          yield* this.store.set(key, next);
          return next;
        }),
      ).pipe(Effect.uninterruptible),
    );
  }
}

/** Register only at the installation's central location. */
export function registerWebGateway(
  ctx: Context,
  config: Config,
  controller: Controller,
  provide: <A, E>(effect: Effect.Effect<A, E>) => Effect.Effect<A, E>,
) {
  const store = new NativeStore(ctx.storage);
  const admissions = new WebAdmissions(
    store,
    new NativeRuntime(ctx, config),
    new FileLocks(AbsolutePath.make(join(config.home, ".abracode/locks"))),
  );
  const assertSupervisor = (id: SessionId) =>
    Effect.gen(function* () {
      const session = yield* controller.queries.session(id);
      if (
        session.agent !== "abra" ||
        session.directory !== config.home ||
        (yield* controller.queries.assignment(id)) ||
        session.metadata?.abracode_supervisor_home !== config.home
      )
        return yield* new CrewError("ABRA_REQUIRED", "Use the single central Abra session");
    });
  const json = <A>(value: A) => JSON.parse(JSON.stringify(value)) as Schema.Json;
  // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- Native RPC handler errors are mapped at the boundary.
  return ctx.rpc.register(webGateway, {
    submit: (input, { error }) =>
      assertSupervisor(input.session_id).pipe(
        Effect.andThen(admissions.submit(input.session_id, input)),
        Effect.map(json),
        Effect.mapError((e) => error("refused", e.message, { code: e.code })),
        provide,
      ),
    receipts: ({ session_id }, { error }) =>
      assertSupervisor(session_id).pipe(
        Effect.andThen(store.entries(StoragePrefix.make(`web/receipt/${session_id}/`))),
        Effect.flatMap((rows) =>
          Effect.forEach(rows, (r) => decode(ReceiptSchema, r.value, r.key)),
        ),
        Effect.map((rows) => json(rows.slice(-100))),
        Effect.mapError((e) => error("refused", e.message, { code: e.code })),
        provide,
      ),
    surfaces: ({ session_id }, { error }) =>
      assertSupervisor(session_id).pipe(
        Effect.andThen(store.entries(StoragePrefix.make(`web/surface/${session_id}/`))),
        Effect.map((rows) => json(rows.map((r) => r.value))),
        Effect.mapError((e) => error("refused", e.message, { code: e.code })),
        provide,
      ),
    projects: ({ session_id }, { error }) =>
      assertSupervisor(session_id).pipe(
        Effect.andThen(controller.queries.projects()),
        Effect.map((projects) =>
          json(projects.map((p) => ({ id: p.id, name: p.id, path: p.path }))),
        ),
        Effect.mapError((e) => error("refused", e.message, { code: e.code })),
        provide,
      ),
    history: ({ session_id, issue_id }, { error }) =>
      assertSupervisor(session_id).pipe(
        Effect.andThen(controller.queries.execution(issue_id)),
        Effect.map((e) =>
          json({
            decisions: e?.decisions ?? [],
            waits: e?.waits ?? [],
            artifacts: (e?.visual_reports ?? []).map((b) => ({
              request_id: b.request.request_id,
              title: b.request.title,
              status: b.status,
              generation: b.generation,
              hash: b.artifact?.hash,
              bytes: b.artifact?.bytes,
              error: b.error,
            })),
          }),
        ),
        Effect.mapError((e) => error("refused", e.message, { code: e.code })),
        provide,
      ),
    artifact: ({ session_id, issue_id, request_id }, { error }) =>
      assertSupervisor(session_id).pipe(
        Effect.andThen(controller.visualArtifact(issue_id, request_id)),
        Effect.map(json),
        Effect.mapError((e) => error("refused", e.message, { code: e.code })),
        provide,
      ),
    checkpoint: ({ session_id, form_id }, { error }) =>
      assertSupervisor(session_id).pipe(
        Effect.andThen(
          Effect.gen(function* () {
            for (const e of yield* controller.queries.executions()) {
              const approval = e.approval_receipts.find(
                (a) => a.session_id === session_id && a.form_id === form_id,
              );
              if (approval) {
                let active =
                  !approval.rejected_at &&
                  !approval.authorized_at &&
                  e.current_phase ===
                    (approval.kind === "plan" ? "awaiting_plan_approval" : "awaiting_merge") &&
                  approval.fingerprint ===
                    (approval.kind === "plan" ? e.plan_fingerprint : e.delivered_commit);
                if (active && approval.kind === "plan" && e.workflow_policy === "full-openspec") {
                  const observed = yield* fullPlanFingerprint(new Git(new ProcessRunner()), e).pipe(
                    Effect.result,
                  );
                  active = observed._tag === "Success" && observed.success === approval.fingerprint;
                }
                return json({
                  active,
                  issue_id: e.issue_id,
                  kind: approval.kind,
                  fingerprint: approval.fingerprint,
                  generation: e.control_generation,
                });
              }
              const decision = e.decisions?.find(
                (d) => d.form_session === session_id && d.form_id === form_id,
              );
              if (decision)
                return json({
                  active:
                    decision.status === "open" && decision.generation === e.control_generation,
                  issue_id: e.issue_id,
                  kind: "decision",
                  identity: `${e.issue_id}:${decision.generation}:${decision.key}`,
                  generation: e.control_generation,
                  ...(decision.finishing_target
                    ? {
                        finishing_target: createHash("sha256")
                          .update(JSON.stringify(decision.finishing_target))
                          .digest("hex"),
                      }
                    : {}),
                });
            }
            return json({ active: false });
          }),
        ),
        Effect.mapError((e) => error("refused", e.message, { code: e.code })),
        provide,
      ),
  });
}
