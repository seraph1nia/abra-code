import { nativeReviews } from "./review-tool.ts";
import { prepareDiagrams, documentDiagrams } from "../workflow/diagrams.ts";
import { collectDiagrams } from "@abracode/contracts/presentation/diagrams";
import { readReportDocument } from "../presentation/report-document.ts";
import { presentationHash } from "../presentation/identity.ts";
import { committedScope } from "../visibility/invalidations.ts";
import { artifactSummary, artifactPage } from "./artifacts.ts";
import { join } from "node:path";
import { Effect } from "effect";
import type { Context } from "@opencode/plugin/effect/plugin";
import { SessionMessage } from "@opencode/schema/session-message";
import {
  AbsolutePath,
  LockKey,
  SessionId,
  StorageKey,
  StoragePrefix,
  timestamp,
} from "../identities.ts";
import { CrewError, type Config } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { NativeStore, type Store } from "../storage/store.ts";
import { FileLocks, type Locks } from "../storage/lock.ts";
import { NativeRuntime } from "../opencode/runtime.ts";
import { type Controller } from "../workflow/controller.ts";
import { decode } from "../decode.ts";
import { webGateway } from "./protocol.ts";

import { ReceiptSchema, ReceiptQuerySchema, type SubmissionReceipt } from "./workspace-wire.ts";
import { loadSurfaceRecord, compactSurface } from "./surface-records.ts";
import { SurfacePublications } from "./surface-publications.ts";
import { resolveOwnedResource } from "./resource-selection.ts";
export type { SubmissionReceipt } from "./workspace-wire.ts";

/** Admission is separate from controller effects. A receipt never authorizes work. */
export class WebAdmissions {
  constructor(
    private store: Store,
    private runtime: Pick<NativeRuntime, "promptAdmission" | "prompt">,
    private locks: Locks,
  ) {}
  /** Observe one retained identity. Missing evidence never admits or retries input. */
  receipt(session: SessionId, requestID: string) {
    return domainEffect(
      Effect.gen({ self: this }, function* () {
        const id = yield* decode(ReceiptQuerySchema.fields.request_id, requestID, "Request ID");
        const key = StorageKey.make(`web/receipt/${session}/${id}`);
        const raw = yield* this.store.get(key);
        if (raw === undefined) return null;
        const receipt = yield* decode(ReceiptSchema, raw, key);
        if (receipt.request_id !== id)
          return yield* new CrewError("WEB_CONFLICT", "Receipt identity does not match its key");
        return receipt;
      }),
    );
  }
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
            at: yield* timestamp,
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
              yield* committedScope({ admissions: true });
              return admitted;
            }
            // Absence after a lost response cannot prove that a native turn never ran.
            // Preserve the ID and input; never submit another message on its behalf.
            const uncertain = { ...receipt, status: "uncertain" as const };
            yield* this.store.set(key, uncertain);
            yield* committedScope({ admissions: true });
            return uncertain;
          }
          yield* this.store.set(key, receipt);
          yield* committedScope({ admissions: true });
          const admission = yield* this.runtime
            .prompt(session, receipt.text, receipt.message_id, receipt.delivery === "steer")
            .pipe(Effect.result);
          const next = {
            ...receipt,
            status: admission._tag === "Success" ? ("admitted" as const) : ("uncertain" as const),
          };
          yield* this.store.set(key, next);
          yield* committedScope({ admissions: true });
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
  const surfacePublications = new SurfacePublications(
    store,
    new FileLocks(AbsolutePath.make(join(config.home, ".abracode/locks"))),
  );
  const reviews = nativeReviews(ctx,controller);
  let surfaceDiagnostics: { surface_id: string; unavailable: string }[] = [];
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
  return Effect.gen(function* () {
    const retained = yield* controller.queries.supervisor();
    if (retained) {
      const recovered = yield* assertSupervisor(retained).pipe(
        Effect.andThen(surfacePublications.recover(retained)),
        Effect.tap(()=>reviews.recover(retained)),
        Effect.result,
      );
      if (recovered._tag === "Success") surfaceDiagnostics = recovered.success;
      else
        surfaceDiagnostics = [
          {
            surface_id: "recovery",
            unavailable: "Generated-view recovery is unavailable; retained evidence was preserved.",
          },
        ];
    }
    // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- Native registration declares unknown; handler failures are mapped at the boundary.
    return yield* ctx.rpc.register(webGateway, {
      reviewList:({session_id,issue_id},{error})=>assertSupervisor(session_id).pipe(Effect.andThen(reviews.list(session_id,issue_id)),Effect.mapError(e=>error("refused",e.message,{code:e.code})),provide),
      review:({session_id,...selection},{error})=>assertSupervisor(session_id).pipe(Effect.andThen(reviews.read(session_id,selection)),Effect.mapError(e=>error("refused",e.message,{code:e.code})),provide),
      reviewAsset:({session_id,...selection},{error})=>assertSupervisor(session_id).pipe(Effect.andThen(reviews.asset(session_id,selection)),Effect.mapError(e=>error("refused",e.message,{code:e.code})),provide),
      reviewSubmit:({session_id,...input},{error})=>assertSupervisor(session_id).pipe(Effect.andThen(reviews.submit(session_id,input,admissions)),Effect.mapError(e=>error("refused",e.message,{code:e.code})),provide),
      prepareDiagrams: ({ session_id, selection }, { error }) =>
        assertSupervisor(session_id).pipe(
          Effect.andThen(
            Effect.gen(function* () {
              if (selection.kind === "surface") {
                const record = yield* surfacePublications.read(
                  session_id,
                  selection.surface_id,
                  selection.revision,
                );
                if (presentationHash(record.surface) !== selection.hash)
                  return yield* new CrewError(
                    "DIAGRAM_SOURCE",
                    "Surface source hash does not match its exact revision",
                  );
                return yield* prepareDiagrams(
                  collectDiagrams(record.surface.createSurface.components),
                );
              }
              const artifact = yield* controller.visualDocument(
                selection.issue_id,
                selection.request_id,
                selection.hash,
              );
              const decoded = yield* Effect.try({
                try: () => readReportDocument(artifact.json),
                catch: CrewError.from,
              });
              if (!decoded.supported) return yield* new CrewError("REPORT_FORMAT", decoded.reason);
              return yield* prepareDiagrams(documentDiagrams(decoded.document));
            }),
          ),
          Effect.mapError((e) => error("refused", e.message, { code: e.code })),
          provide,
        ),
      surface: ({ session_id, surface_id, revision }, { error }) =>
        assertSupervisor(session_id).pipe(
          Effect.andThen(surfacePublications.read(session_id, surface_id, revision)),
          Effect.catchIf(
            (e) => e.code === "SURFACE_REVISION_UNAVAILABLE",
            (e) => Effect.succeed({ surface_id, unavailable: e.message }),
          ),
          Effect.mapError((e) => error("refused", e.message, { code: e.code })),
          provide,
        ),
      presentations: ({ session_id, message_ids }, { error }) =>
        assertSupervisor(session_id).pipe(
          Effect.andThen(surfacePublications.associations(session_id, message_ids)),
          Effect.mapError((e) => error("refused", e.message, { code: e.code })),
          provide,
        ),
      resolve: ({ session_id, target }, { error }) =>
        assertSupervisor(session_id).pipe(
          Effect.andThen(resolveOwnedResource(controller.queries, target)),
          Effect.mapError((e) => error("refused", e.message, { code: e.code })),
          provide,
        ),
      submit: (input, { error }) =>
        assertSupervisor(input.session_id).pipe(
          Effect.andThen(admissions.submit(input.session_id, input)),
          Effect.mapError((e) => error("refused", e.message, { code: e.code })),
          provide,
        ),
      receipt: ({ session_id, request_id }, { error }) =>
        assertSupervisor(session_id).pipe(
          Effect.andThen(admissions.receipt(session_id, request_id)),
          Effect.mapError((e) => error("refused", e.message, { code: e.code })),
          provide,
        ),
      receipts: ({ session_id }, { error }) =>
        assertSupervisor(session_id).pipe(
          Effect.andThen(store.entries(StoragePrefix.make(`web/receipt/${session_id}/`))),
          Effect.flatMap((rows) =>
            Effect.forEach(rows, (r) => decode(ReceiptSchema, r.value, r.key)),
          ),
          Effect.map((rows) =>
            rows
              .toSorted((a, b) => {
                const time = (at: string) => {
                  const parsed = Date.parse(at);
                  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
                };
                const left = time(a.at),
                  right = time(b.at);
                return left === right ? a.request_id.localeCompare(b.request_id) : left - right;
              })
              .slice(-100),
          ),
          Effect.mapError((e) => error("refused", e.message, { code: e.code })),
          provide,
        ),
      surfaces: ({ session_id }, { error }) =>
        assertSupervisor(session_id).pipe(
          Effect.andThen(store.entries(StoragePrefix.make(`web/surface/${session_id}/`))),
          Effect.map((rows) => [
            ...rows.map((r) => compactSurface(loadSurfaceRecord(r.value, r.key))),
            ...surfaceDiagnostics,
          ]),
          Effect.mapError((e) => error("refused", e.message, { code: e.code })),
          provide,
        ),
      projects: ({ session_id }, { error }) =>
        assertSupervisor(session_id).pipe(
          Effect.andThen(controller.queries.projects()),
          Effect.map((projects) => projects.map((p) => ({ id: p.id, name: p.id, path: p.path }))),
          Effect.mapError((e) => error("refused", e.message, { code: e.code })),
          provide,
        ),
      history: ({ session_id, issue_id, artifact_offset }, { error }) =>
        assertSupervisor(session_id).pipe(
          Effect.andThen(controller.queries.execution(issue_id)),
          Effect.map((e) => ({
            decisions: e?.decisions ?? [],
            waits: e?.waits ?? [],
            ...artifactPage(e?.visual_reports ?? [], artifact_offset),
          })),
          Effect.mapError((e) => error("refused", e.message, { code: e.code })),
          provide,
        ),
      artifact: ({ session_id, issue_id, request_id }, { error }) =>
        assertSupervisor(session_id).pipe(
          Effect.andThen(controller.visualArtifact(issue_id, request_id)),
          Effect.mapError((e) => error("refused", e.message, { code: e.code })),
          provide,
        ),
      artifactDocument: ({ session_id, issue_id, request_id, hash }, { error }) =>
        assertSupervisor(session_id).pipe(
          Effect.andThen(controller.visualDocument(issue_id, request_id, hash)),
          Effect.mapError((e) => error("refused", e.message, { code: e.code })),
          provide,
        ),
      artifactSummary: ({ session_id, issue_id, request_id, hash }, { error }) =>
        assertSupervisor(session_id).pipe(
          Effect.andThen(
            resolveOwnedResource(controller.queries, {
              action: "open_artifact",
              issue_id,
              request_id,
              hash,
            }),
          ),
          Effect.andThen(controller.queries.execution(issue_id)),
          Effect.map((execution) =>
            artifactSummary(
              execution!.visual_reports!.find((build) => build.request.request_id === request_id)!,
            ),
          ),
          Effect.mapError((e) => error("refused", e.message, { code: e.code })),
          provide,
        ),
      exportDocument: ({ session_id, issue_id, request_id, hash }, { error }) =>
        assertSupervisor(session_id).pipe(
          Effect.andThen(controller.exportVisualDocument(issue_id, request_id, hash)),
          Effect.mapError((e) => error("refused", e.message, { code: e.code })),
          provide,
        ),
      readExport: ({ session_id, issue_id, request_id, hash, exporter_hash }, { error }) =>
        assertSupervisor(session_id).pipe(
          Effect.andThen(controller.readVisualExport(issue_id, request_id, hash, exporter_hash)),
          Effect.mapError((e) => error("refused", e.message, { code: e.code })),
          provide,
        ),
      saveSurface: ({ session_id, issue_id, request_id, surface_id, revision, title }, { error }) =>
        assertSupervisor(session_id).pipe(
          Effect.andThen(
            controller.saveVisualSurface(session_id, issue_id, {
              request_id,
              surface: { surface_id, revision },
              ...(title ? { title } : {}),
            }),
          ),
          Effect.map(artifactSummary),
          Effect.mapError((e) => error("refused", e.message, { code: e.code })),
          provide,
        ),
      checkpoint: ({ session_id, form_id }, { error }) =>
        assertSupervisor(session_id).pipe(
          Effect.andThen(controller.queries.checkpoint(session_id, form_id)),
          Effect.mapError((e) => error("refused", e.message, { code: e.code })),
          provide,
        ),
    });
  });
}
