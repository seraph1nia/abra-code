import { searchPublications } from "../presentation/associations.ts";
import { selectedFollowups, selectionReceiptKey } from "../workflow/selected-requests.ts";
import { captureSelection } from "./capture-selection.ts";
import type { WorkSelection } from "@abracode/contracts/web/resources";
import type { Submission } from "@abracode/contracts/web/workspace-wire";
import type { Reviews } from "./reviews.ts";
import type { AgentDefinitionError } from "@abracode/agents";
import type { AgentCatalog } from "@abracode/contracts/web/agent-settings";
import { prepareDiagrams, documentDiagrams } from "../reporting/diagrams.ts";
import { collectDiagrams } from "@abracode/contracts/presentation/diagrams";
import { readReportDocument } from "@abracode/contracts/presentation/report-document";
import { canonicalJSON, presentationHash } from "../presentation/identity.ts";
import { committedScope } from "../visibility/invalidations.ts";
import { artifactSummary, artifactPage } from "./artifacts.ts";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import type { Context } from "@opencode/plugin/effect/plugin";
import { SessionMessage } from "@opencode/schema/session-message";
import {
  AbsolutePath,
  LockKey,
  SessionId,
  StoragePrefix,
  WebSubmissionId,
  timestamp,
} from "@abracode/contracts/identities";
import { CrewError, type Config } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { NativeStore, type Store } from "../storage/store.ts";
import { FileLocks, type Locks } from "../storage/lock.ts";
import { NativeRuntime } from "../opencode/runtime.ts";
import { type Controller } from "../workflow/controller.ts";
import { decode } from "../decode.ts";
import { webGateway } from "./protocol.ts";

import {
  selectionMarker,
  thoughtMarker,
  thoughtSubmissionMarker,
  ReceiptSchema,
  ReceiptQuerySchema,
  type SubmissionReceipt,
} from "@abracode/contracts/web/workspace-wire";
import { SurfacePublications } from "./surface-publications.ts";
import { resolveOwnedResource } from "./resource-selection.ts";
export type { SubmissionReceipt } from "@abracode/contracts/web/workspace-wire";

/** Admission is separate from controller effects. A receipt never authorizes work. */
export class WebAdmissions {
  constructor(
    private store: Store,
    private runtime: Pick<NativeRuntime, "promptAdmission" | "prompt">,
    private locks: Locks,
    private capture?: (selection: WorkSelection) => Effect.Effect<string, CrewError>,
    private verifyThought?: (
      reference: NonNullable<Submission["thought"]>,
    ) => Effect.Effect<void, CrewError>,
  ) {}
  /** Observe one retained identity. Missing evidence never admits or retries input. */
  receipt(session: SessionId, requestID: WebSubmissionId) {
    return domainEffect(
      Effect.gen({ self: this }, function* () {
        const id = yield* decode(ReceiptQuerySchema.fields.request_id, requestID, "Request ID");
        const key = selectionReceiptKey(session, id);
        const raw = yield* this.store.get(key);
        if (raw === undefined) return null;
        const receipt = yield* decode(ReceiptSchema, raw, key);
        if (receipt.request_id !== id)
          return yield* new CrewError("WEB_CONFLICT", "Receipt identity does not match its key");
        return receipt;
      }),
    );
  }
  submit(session: SessionId, input: Submission) {
    return this.locks.with(LockKey.make("web-admission"), () =>
      domainEffect(
        Effect.gen({ self: this }, function* () {
          if (
            !Schema.is(WebSubmissionId)(input.request_id) ||
            !input.text.trim() ||
            input.text.length > 32768
          )
            return yield* new CrewError("WEB_INPUT", "Invalid submission identity or text");
          const key = selectionReceiptKey(session, input.request_id);
          const raw = yield* this.store.get(key);
          const prior = raw === undefined ? undefined : yield* decode(ReceiptSchema, raw, key);
          if (
            prior &&
            (prior.text !== input.text ||
              prior.delivery !== input.delivery ||
              canonicalJSON(prior.thought) !== canonicalJSON(input.thought) ||
              canonicalJSON(prior.capture?.selection) !== canonicalJSON(input.selection))
          )
            return yield* new CrewError(
              "WEB_CONFLICT",
              "Submission identity is already bound to different input",
            );
          let capture = prior?.capture;
          let nativeText = prior?.native_text;
          if (!prior && input.selection) {
            if (!this.capture)
              return yield* new CrewError(
                "SELECTION_UNAVAILABLE",
                "Selection capture is unavailable.",
              );
            const excerpt = yield* this.capture(input.selection);
            capture = { selection: input.selection, excerpt };
            nativeText =
              input.text +
              selectionMarker +
              JSON.stringify({ request_id: input.request_id, ...capture });
            if (nativeText.length > 32768)
              return yield* new CrewError(
                "SELECTION_LIMIT",
                "The question and excerpt exceed the native input bound.",
              );
          }
          if (!prior && input.thought) {
            if (!this.verifyThought)
              return yield* new CrewError(
                "SELECTION_UNAVAILABLE",
                "Thought lookup is unavailable.",
              );
            yield* this.verifyThought(input.thought).pipe(
              Effect.mapError((e) => new CrewError("SELECTION_THOUGHT", e.message)),
            );
            nativeText =
              (nativeText ?? input.text) +
              thoughtSubmissionMarker +
              input.request_id +
              thoughtMarker +
              JSON.stringify(input.thought);
            if (nativeText.length > 32768)
              return yield* new CrewError(
                "SELECTION_LIMIT",
                "Shorten the question to attach this thought.",
              );
          }
          const receipt: SubmissionReceipt = prior ?? {
            request_id: input.request_id,
            delivery: input.delivery,
            text: input.text,
            ...(capture && { capture }),
            ...(input.thought && { thought: input.thought }),
            ...(nativeText && { native_text: nativeText }),
            message_id: SessionMessage.ID.create(),
            status: "submitted",
            at: yield* timestamp,
          };
          if (receipt.status === "admitted") return receipt;
          if (prior) {
            const observation = yield* this.runtime.promptAdmission(
              session,
              receipt.message_id,
              receipt.native_text ?? receipt.text,
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
            .prompt(
              session,
              receipt.native_text ?? receipt.text,
              receipt.message_id,
              receipt.delivery === "steer",
            )
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
  reviews: Reviews,
  agents: Effect.Effect<AgentCatalog, AgentDefinitionError>,
  provide: <A, E>(effect: Effect.Effect<A, E>) => Effect.Effect<A, E>,
) {
  const store = new NativeStore(ctx.storage);
  const locks = new FileLocks(AbsolutePath.make(join(config.home, ".abracode/locks")));
  const surfacePublications = new SurfacePublications(store, locks);
  let surfaceDiagnostics: { surface_id: string; unavailable: string }[] = [];
  const admissions = new WebAdmissions(
    store,
    new NativeRuntime(ctx, config),
    locks,
    (selection) => captureSelection(controller.queries, selection),
    (ref) => controller.thoughts.get(ref, "http").pipe(Effect.asVoid),
  );
  const receipts = (id: SessionId) =>
    store.entries(StoragePrefix.make(`web/receipt/${id}/`)).pipe(
      Effect.flatMap((rows) => Effect.forEach(rows, (r) => decode(ReceiptSchema, r.value, r.key))),
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
    );
  const surfaces = (id: SessionId) =>
    surfacePublications.list(id).pipe(Effect.map((rows) => [...rows, ...surfaceDiagnostics]));
  const projects = () =>
    controller.queries
      .projects()
      .pipe(Effect.map((rows) => rows.map((p) => ({ id: p.id, name: p.id, path: p.path }))));
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
  const authorizedSupervisor = <A, E>(
    id: SessionId,
    error: (kind: "refused", message: string, data: { code: string }) => E,
    operation: () => Effect.Effect<A, CrewError | AgentDefinitionError>,
  ) =>
    assertSupervisor(id).pipe(
      Effect.andThen(operation),
      Effect.mapError((e) => error("refused", e.message, { code: e.code })),
      provide,
    );
  return Effect.gen(function* () {
    const retained = yield* controller.queries.supervisor();
    if (retained) {
      const authorized = yield* assertSupervisor(retained).pipe(Effect.result);
      const recovered =
        authorized._tag === "Failure"
          ? authorized
          : yield* surfacePublications.recover(retained).pipe(Effect.result);
      if (authorized._tag === "Success")
        yield* reviews
          .recover(retained)
          .pipe(
            Effect.catch((error) =>
              Effect.logWarning("Interactive review recovery unavailable", error.code),
            ),
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
      observeSections: (input, { error }) =>
        authorizedSupervisor(input.session_id, error, () =>
          Effect.gen(function* () {
            return {
              ...(input.receipts ? { receipts: yield* receipts(input.session_id) } : {}),
              ...(input.surfaces ? { surfaces: yield* surfaces(input.session_id) } : {}),
              ...(input.message_ids
                ? {
                    presentations: yield* reviews.presentations(
                      input.session_id,
                      input.message_ids,
                    ),
                  }
                : {}),
              ...(input.projects ? { projects: yield* projects() } : {}),
            };
          }),
        ),
      memorySearch: ({ session_id, repository_id, ...input }, { error }) =>
        authorizedSupervisor(session_id, error, () =>
          controller.memory.search(repository_id, input),
        ),
      memoryRead: ({ session_id, repository_id, ...input }, { error }) =>
        authorizedSupervisor(session_id, error, () => controller.memory.read(repository_id, input)),
      memoryPublish: ({ session_id, ...input }, { error }) =>
        authorizedSupervisor(session_id, error, () => controller.memory.publish(input)),
      memoryEnabled: ({ session_id }, { error }) =>
        authorizedSupervisor(session_id, error, () => Effect.succeed(controller.memory.enabled)),
      agents: ({ session_id }, { error }) => authorizedSupervisor(session_id, error, () => agents),
      reviewReceipt: ({ session_id, ...selection }, { error }) =>
        authorizedSupervisor(session_id, error, () =>
          reviews.receipt(session_id, selection, admissions),
        ),
      reviewList: ({ session_id, issue_id }, { error }) =>
        authorizedSupervisor(session_id, error, () => reviews.list(session_id, issue_id)),
      review: ({ session_id, ...selection }, { error }) =>
        authorizedSupervisor(session_id, error, () => reviews.read(session_id, selection)),
      reviewAsset: ({ session_id, ...selection }, { error }) =>
        authorizedSupervisor(session_id, error, () => reviews.asset(session_id, selection)),
      reviewSubmit: ({ session_id, ...input }, { error }) =>
        authorizedSupervisor(session_id, error, () =>
          reviews.submit(session_id, input, admissions),
        ),
      prepareDiagrams: ({ session_id, selection }, { error }) =>
        authorizedSupervisor(session_id, error, () =>
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
      publications: ({ session_id, ...query }, { error }) =>
        authorizedSupervisor(session_id, error, () =>
          searchPublications(store, session_id, query, (target) =>
            target.kind === "surface"
              ? surfacePublications.searchCommitted(session_id, target.surface_id, target.revision)
              : reviews.searchCommitted(session_id, target),
          ),
        ),
      surface: ({ session_id, surface_id, revision }, { error }) =>
        authorizedSupervisor(session_id, error, () =>
          surfacePublications.read(session_id, surface_id, revision).pipe(
            Effect.catchIf(
              (e) => e.code === "SURFACE_REVISION_UNAVAILABLE",
              (e) => Effect.succeed({ surface_id, unavailable: e.message }),
            ),
          ),
        ),
      presentations: ({ session_id, message_ids }, { error }) =>
        authorizedSupervisor(session_id, error, () =>
          reviews.presentations(session_id, message_ids),
        ),
      resolve: ({ session_id, target }, { error }) =>
        authorizedSupervisor(session_id, error, () =>
          resolveOwnedResource(controller.queries, target),
        ),
      submit: (input, { error }) =>
        authorizedSupervisor(input.session_id, error, () =>
          admissions.submit(input.session_id, input),
        ),
      receipt: ({ session_id, request_id }, { error }) =>
        authorizedSupervisor(session_id, error, () =>
          Effect.gen(function* () {
            const receipt = yield* admissions.receipt(session_id, request_id);
            if (!receipt?.capture) return receipt;
            const execution = yield* controller.queries.execution(
              receipt.capture.selection.issue_id,
            );
            return { ...receipt, followups: selectedFollowups(receipt, execution, session_id) };
          }),
        ),
      receipts: ({ session_id }, { error }) =>
        authorizedSupervisor(session_id, error, () => receipts(session_id)),
      surfaces: ({ session_id }, { error }) =>
        authorizedSupervisor(session_id, error, () => surfaces(session_id)),
      projects: ({ session_id }, { error }) =>
        authorizedSupervisor(session_id, error, () => projects()),
      history: ({ session_id, issue_id, artifact_offset }, { error }) =>
        authorizedSupervisor(session_id, error, () =>
          controller.queries.execution(issue_id).pipe(
            Effect.map((e) => ({
              decisions: e?.decisions ?? [],
              waits: e?.waits ?? [],
              ...artifactPage(e?.visual_reports ?? [], artifact_offset),
            })),
          ),
        ),
      artifact: ({ session_id, issue_id, request_id }, { error }) =>
        authorizedSupervisor(session_id, error, () =>
          controller.visualArtifact(issue_id, request_id),
        ),
      artifactDocument: ({ session_id, issue_id, request_id, hash }, { error }) =>
        authorizedSupervisor(session_id, error, () =>
          controller.visualDocument(issue_id, request_id, hash),
        ),
      artifactSummary: ({ session_id, issue_id, request_id, hash }, { error }) =>
        authorizedSupervisor(session_id, error, () =>
          resolveOwnedResource(controller.queries, {
            action: "open_artifact",
            issue_id,
            request_id,
            hash,
          }).pipe(
            Effect.andThen(controller.queries.execution(issue_id)),
            Effect.map((execution) =>
              artifactSummary(
                execution!.visual_reports!.find(
                  (build) => build.request.request_id === request_id,
                )!,
              ),
            ),
          ),
        ),
      exportDocument: ({ session_id, issue_id, request_id, hash }, { error }) =>
        authorizedSupervisor(session_id, error, () =>
          controller.exportVisualDocument(issue_id, request_id, hash),
        ),
      readExport: ({ session_id, issue_id, request_id, hash, exporter_hash }, { error }) =>
        authorizedSupervisor(session_id, error, () =>
          controller.readVisualExport(issue_id, request_id, hash, exporter_hash),
        ),
      saveSurface: ({ session_id, issue_id, request_id, surface_id, revision, title }, { error }) =>
        authorizedSupervisor(session_id, error, () =>
          controller
            .saveVisualSurface(session_id, issue_id, {
              request_id,
              surface: { surface_id, revision },
              ...(title ? { title } : {}),
            })
            .pipe(Effect.map(artifactSummary)),
        ),
      checkpoint: ({ session_id, form_id }, { error }) =>
        authorizedSupervisor(session_id, error, () =>
          controller.queries.checkpoint(session_id, form_id),
        ),
    });
  });
}
