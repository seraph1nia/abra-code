import { createHash, randomUUID } from "node:crypto";
import {
  IssueId,
  RepositoryId,
  SessionId,
  StorageKey,
  StoragePrefix,
  timestamp,
  type FindingId,
  type FindingRevisionId,
} from "@abracode/contracts/identities";
import {
  retainedFinding,
  type FeedbackPage,
} from "@abracode/contracts/workflow/feedback-contracts";
import { needsDisposition } from "@abracode/contracts/workflow/message-contracts";
import { Effect, Schema } from "effect";
import { decode } from "../decode.ts";
import {
  CrewError,
  ensure,
  type Execution,
  type ManagedExecution,
  type Project,
  type SavedExecution,
  type SetupExecution,
} from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { providerFailure } from "../observability.ts";
import { committedScope } from "../visibility/invalidations.ts";
import { Coordination } from "../workflow/coordination.ts";
import { hasWorkerSession, workerSessionIDs } from "../workflow/worker-assignment.ts";
import {
  ExecutionRecordSchema,
  ProjectRecordSchema,
  SetupRecordSchema,
  executionRecordFields,
  type RecordDiagnostic,
} from "./contracts.ts";
import {
  newWorkerFailureRole,
  validateExecutionTransition,
  type SavedManagedRecord,
} from "./invariants.ts";
import { type Locks } from "./lock.ts";
import { isLegacyRecord, isRecordObject, normalizeRecord } from "./migrations.ts";
import { type Store } from "./native-store.ts";

export { NativeStore, type Store } from "./native-store.ts";

const executionSchema = ExecutionRecordSchema;
const setupSchema = SetupRecordSchema;
const projectSchema = ProjectRecordSchema;
const observationKey = StorageKey.make("observation/records-revision");
const projectOwnedFields = new Set(Object.keys(ProjectRecordSchema.fields));
const executionOwnedFields = new Set(Object.keys(executionRecordFields));
const terminalWorkerPhases = new Set<string>(["completed", "cancelled", "archived"]);
const maxWorkerTickets = 2048;

/** Replace owned fields, including absence. Unknown additive evidence stays on disk. */
export function synchronizeExecution(target: object, source: ManagedExecution) {
  for (const field of executionOwnedFields)
    if (!(field in source)) Reflect.deleteProperty(target, field);
  Object.assign(target, source);
}

/** Identity/control replacement is separate from a writer's explicitly owned fields. */
export type ExecutionOwnedField = Exclude<
  keyof Execution,
  | "schema_version"
  | "revision"
  | "issue_id"
  | "repository_id"
  | "execution_id"
  | "workflow_policy"
  | "control_generation"
  | "effective_policy"
  | "configuration_snapshot"
  | "openspec_schema"
  | "setup"
>;
export const removeOwnedField = Symbol("remove owned execution field");
export type ExecutionPatch = {
  [K in ExecutionOwnedField]?:
    | Exclude<Execution[K], undefined>
    | (undefined extends Execution[K] ? typeof removeOwnedField : never);
};

function applyPatch<E extends ManagedExecution>(current: E, patch: ExecutionPatch): E {
  const next = { ...current };
  for (const [field, value] of Object.entries(patch)) {
    ensure(value !== undefined, "INVALID_PATCH", "Use explicit removal to clear an owned field");
    if (value === removeOwnedField) Reflect.deleteProperty(next, field);
    else Reflect.set(next, field, value);
  }
  return next;
}

function unknownExtensions(original: unknown, owned: ReadonlySet<string>): Record<string, unknown> {
  return isRecordObject(original)
    ? Object.fromEntries(Object.entries(original).filter(([field]) => !owned.has(field)))
    : {};
}

export class Records {
  private coordination?: Coordination;
  private workerTickets = new Map<SessionId, IssueId>();

  constructor(public store: Store) {}

  feedback = (
    id: IssueId,
    page = 0,
    finding_id?: FindingId,
    revision?: FindingRevisionId | string,
  ): Effect.Effect<FeedbackPage, CrewError> =>
    domainEffect(
      Effect.gen({ self: this }, function* () {
        ensure(
          Number.isSafeInteger(page) && page >= 0,
          "FEEDBACK_PAGE",
          "Feedback page must be a nonnegative integer",
        );
        const e = yield* this.execution(id);
        ensure(e, "EXECUTION_MISSING", "No retained execution for feedback history");
        const f = e.feedback,
          offset = page * 20;
        const exact =
          finding_id && revision ? retainedFinding(f, { id: finding_id, revision }) : undefined;
        if (finding_id !== undefined || revision !== undefined)
          ensure(
            exact,
            "INVALID_SELECTION",
            "The requested finding revision is unavailable for this task",
          );
        return {
          issue_id: id,
          generation: e.control_generation,
          head: e.delivered_commit,
          page,
          page_size: 20 as const,
          external_validation: e.external_validation,
          external_gate_digest: e.external_validation?.observation?.gate
            ? createHash("sha256")
                .update(JSON.stringify(e.external_validation.observation.gate))
                .digest("hex")
            : undefined,
          external_history: e.external_history?.slice(page, page + 1) ?? [],
          external_history_total: e.external_history?.length ?? 0,
          observation: f
            ? {
                head: f.head,
                pr: f.pr,
                target: f.target,
                observed_at: f.observed_at,
                next_check_at: f.next_check_at,
                complete: f.complete,
                error: f.error,
              }
            : undefined,
          findings: exact
            ? f?.findings.includes(exact)
              ? [exact]
              : []
            : (f?.findings.slice(offset, offset + 20) ?? []),
          history: exact
            ? f?.history.includes(exact)
              ? [exact]
              : []
            : (f?.history.slice(offset, offset + 20) ?? []),
          actions: f?.actions.slice(offset, offset + 20) ?? [],
          finding_total: f?.findings.length ?? 0,
          history_total: f?.history.length ?? 0,
          action_total: f?.actions.length ?? 0,
        };
      }),
    );

  /** Captured under coordinateRead alongside the records described by this stamp. */
  readonly observationRevision = Effect.suspend(() => this.store.get(observationKey)).pipe(
    Effect.flatMap((value) => decode(Schema.UndefinedOr(Schema.String), value, observationKey)),
  );

  coordinate(locks: Locks) {
    return (this.coordination ??= new Coordination(locks));
  }

  coordinateCommit<A, E, R>(
    action: () => Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | CrewError, R> {
    return this.coordination ? this.coordination.with(action) : action();
  }

  /** Observers never queue ahead of control writes or hold a lock for external reads. */
  coordinateRead<A, E, R>(
    action: () => Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | CrewError, R> {
    return this.coordination
      ? this.coordination.with(action, { waitSeconds: 0, shared: true })
      : Effect.fail(
          new CrewError("OBSERVATION_UNAVAILABLE", "Retained-state coordination is unavailable"),
        );
  }

  private read<S extends Schema.ConstraintDecoder<unknown>>(key: StorageKey, schema: S) {
    return domainEffect(
      Effect.gen({ self: this }, function* () {
        const raw = yield* this.store.get(key);
        if (raw === undefined) return undefined;
        return yield* decode(schema, normalizeRecord(key, raw), key);
      }),
    );
  }

  private scan<S extends Schema.ConstraintDecoder<unknown>>(prefix: StoragePrefix, schema: S) {
    return domainEffect(
      Effect.gen({ self: this }, function* () {
        const values: S["Type"][] = [];
        const diagnostics: RecordDiagnostic[] = [];
        for (const entry of yield* this.store.entries(prefix)) {
          const result = yield* Effect.result(
            domainEffect(
              Effect.suspend(() =>
                decode(schema, normalizeRecord(entry.key, entry.value), entry.key),
              ),
            ),
          );
          if (result._tag === "Success") values.push(result.success);
          else
            diagnostics.push({
              key: entry.key,
              code:
                result.failure.code === "UNSUPPORTED_RECORD_VERSION"
                  ? "unsupported_version"
                  : "invalid_record",
              message: result.failure.message,
            });
        }
        return { values, diagnostics };
      }),
    );
  }

  projectScan(): Effect.Effect<{ values: Project[]; diagnostics: RecordDiagnostic[] }, CrewError> {
    return this.scan(StoragePrefix.make("project/"), projectSchema);
  }

  executionScan(): Effect.Effect<
    { values: SavedExecution[]; diagnostics: RecordDiagnostic[] },
    CrewError
  > {
    return this.scan(StoragePrefix.make("execution/"), executionSchema);
  }

  setupScan(): Effect.Effect<
    { values: SetupExecution[]; diagnostics: RecordDiagnostic[] },
    CrewError
  > {
    return this.scan(StoragePrefix.make("setup/"), setupSchema);
  }

  projects() {
    return this.projectScan().pipe(Effect.map((s) => s.values));
  }

  project(id: RepositoryId): Effect.Effect<Project | undefined, CrewError> {
    return this.read(StorageKey.make(`project/${id}`), projectSchema);
  }

  executions() {
    return this.executionScan().pipe(Effect.map((s) => s.values));
  }

  rememberWorkers(execution: Execution) {
    if (terminalWorkerPhases.has(execution.current_phase)) {
      for (const session of workerSessionIDs(execution)) {
        if (session) this.workerTickets.delete(session);
      }
      for (const [session, issueId] of this.workerTickets) {
        if (issueId === execution.issue_id) this.workerTickets.delete(session);
      }
      return;
    }
    for (const session of workerSessionIDs(execution)) {
      if (!session) continue;
      this.workerTickets.delete(session);
      this.workerTickets.set(session, execution.issue_id);
      if (this.workerTickets.size > maxWorkerTickets) {
        const oldest = this.workerTickets.keys().next().value;
        if (oldest !== undefined) this.workerTickets.delete(oldest);
      }
    }
  }

  workerAssignment = Effect.fn("Records.workerAssignment")(
    function* (this: Records, session: SessionId) {
      const ticket = this.workerTickets.get(session);
      if (ticket) {
        const current = yield* this.execution(ticket).pipe(Effect.result);
        if (
          current._tag === "Success" &&
          current.success &&
          hasWorkerSession(current.success, session)
        )
          return current.success;
        if (
          current._tag === "Failure" &&
          ![
            "INVALID_DATA",
            "INVALID_RECORD",
            "UNSUPPORTED_RECORD_VERSION",
            "RECORD_IDENTITY",
          ].includes(current.failure.code)
        )
          return yield* current.failure;
        this.workerTickets.delete(session);
      }
      const found = (yield* this.executions()).find((e) => hasWorkerSession(e, session));
      if (found) this.rememberWorkers(found);
      return found;
    }.bind(this),
  );

  execution(id: IssueId): Effect.Effect<SavedExecution | undefined, CrewError> {
    return this.read(StorageKey.make(`execution/${id}`), executionSchema);
  }

  setup(id: RepositoryId): Effect.Effect<SetupExecution | undefined, CrewError> {
    return this.read(StorageKey.make(`setup/${id}`), setupSchema);
  }

  supervisor() {
    return this.store
      .get(StorageKey.make("supervisor/session"))
      .pipe(Effect.flatMap((v) => decode(Schema.UndefinedOr(SessionId), v, "Supervisor session")));
  }

  export() {
    return this.store
      .entries(StoragePrefix.make(""))
      .pipe(Effect.map((entries) => ({ format: "abracode-plugin-records-v1", entries })));
  }

  diagnostics() {
    return Effect.all([this.projectScan(), this.executionScan(), this.setupScan()], {
      concurrency: "unbounded",
    }).pipe(Effect.map((scans) => scans.flatMap((s) => s.diagnostics)));
  }

  private commitRecord<T extends { revision: number }>(
    key: StorageKey,
    original: unknown,
    record: Record<string, unknown>,
    decoded: T,
  ) {
    return Effect.gen({ self: this }, function* () {
      if (isLegacyRecord(original)) {
        const backup = StorageKey.make(`legacy-original/${key}`);
        if ((yield* this.store.get(backup)) === undefined) yield* this.store.set(backup, original);
      }
      // Fence derived readers before writing the record. An interruption
      // between these writes leaves summaries stale rather than falsely current.
      yield* this.store.set(observationKey, randomUUID());
      // Preserve additive unknown evidence when updating fields owned by this version.
      yield* this.store.set(key, { ...record, ...decoded });
      yield* committedScope(
        key.startsWith("execution/")
          ? {
              issues: [IssueId.make(key.slice("execution/".length))],
              finder: true,
              attention: true,
            }
          : { projects: true, finder: true, work_all: true },
      );
      return decoded;
    });
  }

  private writeManagedRecord<S extends typeof executionSchema | typeof setupSchema>(
    key: StorageKey,
    schema: S,
    value: ManagedExecution,
    control = false,
  ): Effect.Effect<S["Type"], CrewError> {
    return this.coordinateCommit(() =>
      domainEffect(
        Effect.gen({ self: this }, function* () {
          const original = yield* this.store.get(key);
          const prior: SavedManagedRecord | undefined =
            original === undefined
              ? undefined
              : yield* decode(schema, normalizeRecord(key, original), key);
          if (prior) yield* validateExecutionTransition(key, prior, value, control);
          const record: Record<string, unknown> = {
            ...unknownExtensions(original, executionOwnedFields),
            ...value,
            schema_version: 1,
            revision: prior ? prior.revision + 1 : 1,
          };
          const decoded = yield* decode(schema, record, key);
          yield* this.commitRecord(key, original, record, decoded);
          const failureRole = newWorkerFailureRole(prior, decoded);
          if (failureRole) yield* providerFailure(failureRole);
          return decoded;
        }),
      ),
    );
  }

  private assertOwner(e: ManagedExecution, current: ManagedExecution) {
    ensure(
      current.execution_id === e.execution_id &&
        current.control_generation === e.control_generation &&
        current.operation?.id === e.operation?.id &&
        current.operation?.generation === e.operation?.generation &&
        current.operation?.fingerprint === e.operation?.fingerprint,
      "STALE_OPERATION",
      "Owned aggregate update was superseded",
    );
  }

  private owned<E extends ManagedExecution>(
    e: ManagedExecution,
    current: E,
    fields: readonly ExecutionOwnedField[],
  ): E {
    this.assertOwner(e, current);
    const next = { ...current };
    for (const field of fields) {
      if (field in e) Object.assign(next, { [field]: e[field] });
      else Reflect.deleteProperty(next, field);
    }
    return next;
  }

  /** Commit explicitly owned fields against current progress and decision history. */
  saveOwned(e: Execution, fields: readonly ExecutionOwnedField[]) {
    return this.update(e.issue_id, (current) => this.owned(e, current, fields)).pipe(
      Effect.tap((saved) => Effect.sync(() => synchronizeExecution(e, saved))),
      Effect.as(e),
    );
  }

  patchOwned(e: Execution, patch: ExecutionPatch) {
    return this.update(e.issue_id, (current) => {
      this.assertOwner(e, current);
      return applyPatch(current, patch);
    });
  }

  /** Shared lifecycle handles observe the committed aggregate only after the write succeeds. */
  commitOwned<E extends ManagedExecution>(
    e: E,
    change: ExecutionPatch | ((current: ManagedExecution) => ExecutionPatch | undefined),
  ) {
    return this.coordinateCommit(() =>
      domainEffect(
        Effect.gen({ self: this }, function* () {
          const current = e.setup
            ? yield* this.setup(e.repository_id)
            : yield* this.execution(e.issue_id);
          ensure(current, "EXECUTION_MISSING", "No retained execution for owned update");
          this.assertOwner(e, current);
          const patch = typeof change === "function" ? change(current) : change;
          const saved = patch
            ? yield* this.saveExecution(applyPatch(current, patch), e.setup === true)
            : current;
          synchronizeExecution(e, saved);
          return e;
        }),
      ),
    );
  }

  /** Setup uses the same field ownership contract without becoming a graph execution. */
  saveSetupOwned(e: SetupExecution, fields: readonly ExecutionOwnedField[]) {
    return this.coordinateCommit(() =>
      domainEffect(
        Effect.gen({ self: this }, function* () {
          const current = yield* this.setup(e.repository_id);
          ensure(current, "EXECUTION_MISSING", "No retained setup execution");
          const saved = yield* this.saveSetup(this.owned(e, current, fields));
          synchronizeExecution(e, saved);
          return e;
        }),
      ),
    );
  }

  /** Initial retention is distinct from a revision-checked replacement. */
  create<E extends ManagedExecution>(e: E, patch: ExecutionPatch = {}) {
    return this.coordinateCommit(() =>
      domainEffect(
        Effect.gen({ self: this }, function* () {
          const setup = e.setup === true;
          const key = StorageKey.make(
            `${setup ? "setup" : "execution"}/${setup ? e.repository_id : e.issue_id}`,
          );
          ensure(
            (yield* this.store.get(key)) === undefined,
            "EXECUTION_EXISTS",
            "Execution is already retained",
          );
          const saved = yield* this.saveExecution(applyPatch(e, patch), setup);
          synchronizeExecution(e, saved);
          return e;
        }),
      ),
    );
  }

  /** Replace an operation only while its previous execution/generation/operation still owns it. */
  beginOperation<E extends ManagedExecution>(e: E, operation: NonNullable<E["operation"]>) {
    return this.coordinateCommit(() =>
      domainEffect(
        Effect.gen({ self: this }, function* () {
          const current =
            e.setup === true
              ? yield* this.setup(e.repository_id)
              : yield* this.execution(e.issue_id);
          ensure(current, "EXECUTION_MISSING", "No retained execution for operation");
          this.assertOwner(e, current);
          ensure(
            operation.status === "prepared" && operation.generation === current.control_generation,
            "STALE_OPERATION",
            "New operation requires the current control generation",
          );
          const saved = yield* this.saveExecution({ ...current, operation }, e.setup === true);
          synchronizeExecution(e, saved);
          return e;
        }),
      ),
    );
  }

  /** Read, validate and change current state under the same commit lock. */
  saveFinishing(e: Execution, fields: readonly (keyof NonNullable<Execution["finishing"]>)[]) {
    return this.update(e.issue_id, (current) => {
      ensure(
        current.execution_id === e.execution_id &&
          current.control_generation === e.control_generation &&
          current.operation?.id === e.operation?.id,
        "STALE_OPERATION",
        "Finishing evidence ownership changed",
      );
      const finishing = { ...current.finishing, schema_version: 1 as const };
      for (const field of fields) {
        if (e.finishing && field in e.finishing)
          Object.assign(finishing, { [field]: e.finishing[field] });
        else Reflect.deleteProperty(finishing, field);
      }
      return { ...current, finishing };
    }).pipe(
      Effect.tap((saved) => Effect.sync(() => synchronizeExecution(e, saved))),
      Effect.as(e),
    );
  }

  /** Read, validate and change current state under the same commit lock. */
  update(id: IssueId, change: (current: Execution) => Execution | undefined) {
    return this.coordinateCommit(() =>
      domainEffect(
        Effect.gen({ self: this }, function* () {
          const current = yield* this.execution(id);
          if (!current) return yield* new CrewError("EXECUTION_MISSING", `No execution for ${id}`);
          const next = change(current);
          return next ? yield* this.save(next) : current;
        }),
      ),
    );
  }

  saveControl(e: Execution) {
    return Effect.gen({ self: this }, function* () {
      const generation = e.control_generation + 1;
      const messages = e.messages?.map((m) =>
        m.type !== "finding" && m.generation !== generation && needsDisposition(m)
          ? { ...m, status: "superseded" as const }
          : m,
      );
      const attention = e.attention?.map((a) =>
        a.generation !== generation && !["handled", "superseded"].includes(a.status)
          ? {
              ...a,
              status: "superseded" as const,
              disposition: `Superseded by control generation ${generation}`,
            }
          : a,
      );
      const saved = yield* this.writeManagedRecord(
        StorageKey.make(`execution/${e.issue_id}`),
        executionSchema,
        { ...e, control_generation: generation, messages, attention, updated_at: yield* timestamp },
        true,
      );
      synchronizeExecution(e, saved);
      this.rememberWorkers(e);
      return e;
    });
  }

  saveProject(p: Project): Effect.Effect<Project, CrewError> {
    const key = StorageKey.make(`project/${p.id}`);
    return this.coordinateCommit(() =>
      domainEffect(
        Effect.gen({ self: this }, function* () {
          const original = yield* this.store.get(key);
          const prior =
            original === undefined
              ? undefined
              : yield* decode(projectSchema, normalizeRecord(key, original), key);
          const record: Record<string, unknown> = {
            ...unknownExtensions(original, projectOwnedFields),
            ...p,
            schema_version: 1,
            revision: prior ? prior.revision + 1 : 1,
          };
          const decoded = yield* decode(projectSchema, record, key);
          return yield* this.commitRecord(key, original, record, decoded);
        }),
      ),
    );
  }

  saveSetup(e: SetupExecution) {
    return this.saveExecution(e, true).pipe(Effect.as(e));
  }

  save(e: Execution) {
    return this.saveExecution(e, false).pipe(Effect.as(e));
  }

  private saveExecution = Effect.fn("Records.saveExecution")(
    function* (this: Records, e: ManagedExecution, setup: boolean) {
      const key = StorageKey.make(
        `${setup ? "setup" : "execution"}/${setup ? e.repository_id : e.issue_id}`,
      );
      const saved = yield* this.writeManagedRecord(key, setup ? setupSchema : executionSchema, {
        ...e,
        updated_at: yield* timestamp,
      });
      synchronizeExecution(e, saved);
      if (!e.setup) this.rememberWorkers(e);
      return e;
    }.bind(this),
    domainEffect,
  );
}
