import { randomUUID } from "node:crypto";
import {
  IssueId,
  RepositoryId,
  SessionId,
  StorageKey,
  StoragePrefix,
  timestamp,
} from "@abracode/contracts/identities";
import { needsDisposition } from "@abracode/contracts/workflow/message-contracts";
import { Context, Layer, Effect, Schema, Option, Data } from "effect";
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
import { type Store } from "./native-store.ts";

export { NativeStore, type Store } from "./native-store.ts";

const executionSchema = ExecutionRecordSchema;
const setupSchema = SetupRecordSchema;
const projectSchema = ProjectRecordSchema;
const observationKey = StorageKey.make("observation/records-revision");
type ActiveIndex = {
  records: Records;
  executions: Map<IssueId, SavedExecution>;
  setups: Map<RepositoryId, SetupExecution>;
  diagnostics: RecordDiagnostic[];
};
const needsActiveIndex = (e: SavedExecution) =>
  e.current_phase !== "completed" ||
  e.attention?.some((item) => item.status === "uncertain" || item.status === "admitted");
const activeIndex = Context.Reference<ActiveIndex | undefined>("abracode/active-execution-index", {
  defaultValue: () => undefined,
});
class RecordFormatError extends Data.TaggedError("RecordFormatError")<{
  code: "INVALID_RECORD" | "UNSUPPORTED_RECORD_VERSION" | "RECORD_IDENTITY";
  message: string;
}> {}
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

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function checkedRecord(key: StorageKey, raw: unknown): Record<string, unknown> {
  if (!isRecordObject(raw))
    throw new RecordFormatError({ code: "INVALID_RECORD", message: `${key}: Expected a record` });
  if (raw.schema_version !== 1)
    throw new RecordFormatError({
      code: "UNSUPPORTED_RECORD_VERSION",
      message: `${key}: Unsupported record version; preserve data and use a compatible runtime`,
    });
  const identity = key.startsWith("project/")
    ? raw.id
    : key.startsWith("setup/")
      ? raw.repository_id
      : raw.issue_id;
  if (identity !== key.slice(key.indexOf("/") + 1))
    throw new RecordFormatError({
      code: "RECORD_IDENTITY",
      message: `${key}: Record identity does not match its key`,
    });
  return raw;
}

function decodeRecord<S extends Schema.ConstraintDecoder<unknown>>(
  key: StorageKey,
  raw: unknown,
  schema: S,
) {
  return Effect.try({
    try: () => checkedRecord(key, raw),
    catch: (error) =>
      error instanceof RecordFormatError
        ? new CrewError(error.code, error.message)
        : CrewError.from(error),
  }).pipe(Effect.flatMap((record) => decode(schema, record, key)));
}

function unknownExtensions(original: unknown, owned: ReadonlySet<string>): Record<string, unknown> {
  return isRecordObject(original)
    ? Object.fromEntries(Object.entries(original).filter(([field]) => !owned.has(field)))
    : {};
}

export class Records {
  private workerTickets = new Map<SessionId, IssueId>();

  constructor(
    public store: Store,
    readonly coordination: Coordination,
  ) {}

  /** Captured under coordinateRead alongside the records described by this stamp. */
  readonly observationRevision = Effect.suspend(() => this.store.get(observationKey)).pipe(
    Effect.flatMap((value) => decode(Schema.UndefinedOr(Schema.String), value, observationKey)),
  );

  coordinateCommit<A, E, R>(
    action: () => Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | CrewError, R> {
    return this.coordination.with(action);
  }

  /** Observers never queue ahead of control writes or hold a lock for external reads. */
  coordinateRead<A, E, R>(
    action: () => Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | CrewError, R> {
    return this.coordination.with(action, { waitSeconds: 0, shared: true });
  }

  private read<S extends Schema.ConstraintDecoder<unknown>>(key: StorageKey, schema: S) {
    return domainEffect(
      Effect.gen({ self: this }, function* () {
        const raw = yield* this.store.get(key);
        if (raw === undefined) return undefined;
        return yield* decodeRecord(key, raw, schema);
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
            domainEffect(Effect.suspend(() => decodeRecord(entry.key, entry.value, schema))),
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

  get projectScan(): Effect.Effect<
    { values: Project[]; diagnostics: RecordDiagnostic[] },
    CrewError
  > {
    return this.scan(StoragePrefix.make("project/"), projectSchema);
  }

  get executionScan(): Effect.Effect<
    { values: SavedExecution[]; diagnostics: RecordDiagnostic[] },
    CrewError
  > {
    return this.scan(StoragePrefix.make("execution/"), executionSchema);
  }

  get setupScan(): Effect.Effect<
    { values: SetupExecution[]; diagnostics: RecordDiagnostic[] },
    CrewError
  > {
    return this.scan(StoragePrefix.make("setup/"), setupSchema);
  }

  get projects() {
    return this.projectScan.pipe(Effect.map((s) => s.values));
  }

  project(id: RepositoryId): Effect.Effect<Project | undefined, CrewError> {
    return this.read(StorageKey.make(`project/${id}`), projectSchema);
  }

  get executions() {
    return this.executionScan.pipe(Effect.map((s) => s.values));
  }

  /** Audit storage before taking the exclusive admission lock. The revision
   * fence retries if another process wrote during capture. Nested admissions
   * reuse this transaction's active records and its fail-closed diagnostics. */
  withActiveIndex<A, E, R>(
    action: () => Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | CrewError, R> {
    return Effect.gen({ self: this }, function* () {
      if ((yield* activeIndex)?.records === this) return yield* action();
      while (true) {
        const revision = yield* this.coordination.with(() => this.observationRevision, {
          shared: true,
        });
        const [executions, setups] = yield* Effect.all([this.executionScan, this.setupScan], {
          concurrency: 2,
        });
        const index: ActiveIndex = {
          records: this,
          executions: new Map(
            executions.values.filter(needsActiveIndex).map((e) => [e.issue_id, e]),
          ),
          setups: new Map(
            setups.values
              .filter((e) => e.current_phase !== "completed")
              .map((e) => [e.repository_id, e]),
          ),
          diagnostics: [...executions.diagnostics, ...setups.diagnostics],
        };
        const result = yield* this.coordinateCommit(() =>
          this.observationRevision.pipe(
            Effect.flatMap((current) =>
              current === revision
                ? action().pipe(Effect.provideService(activeIndex, index), Effect.asSome)
                : Effect.succeed(Option.none<A>()),
            ),
          ),
        );
        if (Option.isSome(result)) return result.value;
      }
    });
  }

  capacityRecords(selected: readonly IssueId[] = []) {
    return Effect.gen({ self: this }, function* () {
      const index = yield* activeIndex;
      if (index?.records === this) {
        const executions = [...index.executions.values()];
        for (const id of selected) {
          if (index.executions.has(id)) continue;
          const result = yield* Effect.result(this.execution(id));
          if (result._tag === "Success" && result.success) executions.push(result.success);
        }
        return { executions, setups: [...index.setups.values()], diagnostics: index.diagnostics };
      }
      const [executions, setups] = yield* Effect.all([this.executionScan, this.setupScan], {
        concurrency: 2,
      });
      return {
        executions: executions.values,
        setups: setups.values,
        diagnostics: [...executions.diagnostics, ...setups.diagnostics],
      };
    });
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
      const found = (yield* this.executions).find((e) => hasWorkerSession(e, session));
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

  get supervisor() {
    return this.store
      .get(StorageKey.make("supervisor/session"))
      .pipe(Effect.flatMap((v) => decode(Schema.UndefinedOr(SessionId), v, "Supervisor session")));
  }

  get export() {
    return this.store
      .entries(StoragePrefix.make(""))
      .pipe(Effect.map((entries) => ({ format: "abracode-plugin-records-v1", entries })));
  }

  get diagnostics() {
    return Effect.all([this.projectScan, this.executionScan, this.setupScan], {
      concurrency: "unbounded",
    }).pipe(Effect.map((scans) => scans.flatMap((s) => s.diagnostics)));
  }

  private commitRecord<T extends { revision: number }>(
    key: StorageKey,
    record: Record<string, unknown>,
    decoded: T,
  ) {
    return Effect.gen({ self: this }, function* () {
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
    change: (prior: S["Type"] | undefined) => ManagedExecution | undefined,
    control = false,
  ): Effect.Effect<S["Type"], CrewError> {
    return this.coordinateCommit(() =>
      domainEffect(
        Effect.gen({ self: this }, function* () {
          const original = yield* this.store.get(key);
          const prior: S["Type"] | undefined =
            original === undefined ? undefined : yield* decodeRecord(key, original, schema);
          const value = change(prior);
          if (!value) {
            ensure(prior, "EXECUTION_MISSING", "No retained execution for update");
            return prior;
          }
          if (prior) yield* validateExecutionTransition(key, prior, value, control);
          const record: Record<string, unknown> = {
            ...unknownExtensions(original, executionOwnedFields),
            ...value,
            updated_at: yield* timestamp,
            schema_version: 1,
            revision: prior ? prior.revision + 1 : 1,
          };
          const decoded = yield* decode(schema, record, key);
          yield* this.commitRecord(key, record, decoded);
          const failureRole = newWorkerFailureRole(prior, decoded);
          if (failureRole) yield* providerFailure(failureRole);
          const index = yield* activeIndex;
          if (index?.records === this) {
            if (decoded.setup) {
              if (decoded.current_phase === "completed") index.setups.delete(decoded.repository_id);
              else index.setups.set(decoded.repository_id, decoded);
            } else if (!needsActiveIndex(decoded)) index.executions.delete(decoded.issue_id);
            else index.executions.set(decoded.issue_id, decoded);
          }
          if (!decoded.setup) this.rememberWorkers(decoded);
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

  private mutate<E extends ManagedExecution>(
    e: E,
    change: (current: SavedManagedRecord | undefined) => ManagedExecution | undefined,
    control = false,
  ) {
    const key = StorageKey.make(e.setup ? `setup/${e.repository_id}` : `execution/${e.issue_id}`);
    return this.writeManagedRecord(
      key,
      e.setup ? setupSchema : executionSchema,
      change,
      control,
    ).pipe(
      Effect.tap((saved) => Effect.sync(() => synchronizeExecution(e, saved))),
      Effect.as(e),
    );
  }

  private saveFields<E extends ManagedExecution>(e: E, fields: readonly ExecutionOwnedField[]) {
    return this.commitOwned(
      e,
      Object.fromEntries(
        fields.map((field) => [field, e[field] === undefined ? removeOwnedField : e[field]]),
      ),
    );
  }
  saveOwned(e: Execution, fields: readonly ExecutionOwnedField[]) {
    return this.saveFields(e, fields);
  }
  saveSetupOwned(e: SetupExecution, fields: readonly ExecutionOwnedField[]) {
    return this.saveFields(e, fields);
  }

  commitOwned<E extends ManagedExecution>(
    e: E,
    change: ExecutionPatch | ((current: ManagedExecution) => ExecutionPatch | undefined),
  ) {
    return this.mutate(e, (current) => {
      ensure(current, "EXECUTION_MISSING", "No retained execution for owned update");
      this.assertOwner(e, current);
      const patch = typeof change === "function" ? change(current) : change;
      return patch ? applyPatch(current, patch) : undefined;
    });
  }
  create<E extends ManagedExecution>(e: E, patch: ExecutionPatch = {}) {
    return this.mutate(e, (current) => {
      ensure(!current, "EXECUTION_EXISTS", "Execution is already retained");
      return applyPatch(e, patch);
    });
  }
  beginOperation<E extends ManagedExecution>(e: E, operation: NonNullable<E["operation"]>) {
    return this.commitOwned(e, (current) => {
      ensure(
        operation.status === "prepared" && operation.generation === current.control_generation,
        "STALE_OPERATION",
        "New operation requires the current control generation",
      );
      return { operation };
    });
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
    return this.writeManagedRecord(
      StorageKey.make(`execution/${id}`),
      executionSchema,
      (current) => {
        ensure(current, "EXECUTION_MISSING", `No execution for ${id}`);
        return change(current);
      },
    );
  }

  commitControl(e: Execution) {
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
    return this.mutate(
      e,
      () => ({ ...e, control_generation: generation, messages, attention }),
      true,
    );
  }

  saveProject(p: Project): Effect.Effect<Project, CrewError> {
    const key = StorageKey.make(`project/${p.id}`);
    return this.coordinateCommit(() =>
      domainEffect(
        Effect.gen({ self: this }, function* () {
          const original = yield* this.store.get(key);
          const prior =
            original === undefined ? undefined : yield* decodeRecord(key, original, projectSchema);
          const record: Record<string, unknown> = {
            ...unknownExtensions(original, projectOwnedFields),
            ...p,
            schema_version: 1,
            revision: prior ? prior.revision + 1 : 1,
          };
          const decoded = yield* decode(projectSchema, record, key);
          return yield* this.commitRecord(key, record, decoded);
        }),
      ),
    );
  }

  saveSetup(e: SetupExecution) {
    return this.mutate(e, () => e);
  }
  save(e: Execution) {
    return this.mutate(e, () => e);
  }
}

export class RecordsService extends Context.Service<RecordsService, Records>()("abracode/Records") {
  static layer(store: Store, coordination: Coordination) {
    return Layer.effect(
      RecordsService,
      Effect.sync(() => new Records(store, coordination)),
    );
  }
}
