import { createHash } from "node:crypto";
import { type FeedbackPage } from "../workflow/feedback-contracts.ts";
import { providerFailure } from "../observability.ts";
import { ExecutionStateSchema } from "./contracts.ts";
import { committed } from "../visibility/invalidations.ts";
import {
  StorageKey,
  StoragePrefix,
  IssueId,
  RepositoryId,
  SessionId,
  timestamp,
} from "../identities.ts";

import { domainEffect } from "../effect.ts";
import {
  CrewError,
  ensure,
  type Execution,
  type Project,
  type SetupExecution,
  type ManagedExecution,
  type SavedExecution,
} from "../domain.ts";
import { Effect, Schema } from "effect";
import { type StorageDomain } from "@opencode/plugin/effect/storage";

import { decode, decodeJSON } from "../decode.ts";
import {
  ExecutionRecordSchema,
  ProjectRecordSchema,
  SetupRecordSchema,
  executionRecordFields,
  type RecordDiagnostic,
} from "./contracts.ts";

import { Coordination } from "../workflow/coordination.ts";
import { type Locks } from "./lock.ts";

export interface Store {
  get(key: StorageKey): Effect.Effect<unknown, CrewError>;
  set<T>(key: StorageKey, value: T): Effect.Effect<void, CrewError>;
  entries(
    prefix: StoragePrefix,
  ): Effect.Effect<Array<{ key: StorageKey; value: unknown }>, CrewError>;
}
export class NativeStore implements Store {
  constructor(private storage: StorageDomain) {}
  get(key: StorageKey) {
    return domainEffect(this.storage.get(key));
  }
  set<T>(key: StorageKey, value: T) {
    return domainEffect(
      Effect.gen({ self: this }, function* () {
        const encoded = yield* Effect.try({
          try: () => JSON.stringify(value),
          catch: () => new CrewError("INVALID_RECORD", `Cannot encode ${key}`),
        });
        if (!(encoded !== undefined))
          return yield* new CrewError("INVALID_RECORD", `Cannot encode ${key}`);
        const json = yield* decodeJSON(Schema.Json, encoded, key);
        yield* this.storage.set(key, json).pipe(Effect.uninterruptible);
      }),
    );
  }
  entries(prefix: StoragePrefix) {
    return domainEffect(
      Effect.gen({ self: this }, function* () {
        const result: Array<{ key: StorageKey; value: unknown }> = [];
        let after: string | undefined;
        do {
          const page = yield* this.storage.scan({ prefix, after, limit: 100 });
          result.push(
            ...page.entries.map((entry) => ({ ...entry, key: StorageKey.make(entry.key) })),
          );
          after = page.next;
        } while (after);
        return result;
      }),
    );
  }
}
const executionSchema = ExecutionRecordSchema;
const setupSchema = SetupRecordSchema;
const projectSchema = ProjectRecordSchema;
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
/** Replace owned fields, including absence. Unknown additive evidence stays on disk. */
export function synchronizeExecution(target: object, source: ManagedExecution) {
  for (const field of Object.keys(executionRecordFields))
    if (!(field in source)) Reflect.deleteProperty(target, field);
  Object.assign(target, source);
}
export class Records {
  feedback = (id: IssueId, page = 0): Effect.Effect<FeedbackPage, CrewError> =>
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
          findings: f?.findings.slice(offset, offset + 20) ?? [],
          history: f?.history.slice(offset, offset + 20) ?? [],
          actions: f?.actions.slice(offset, offset + 20) ?? [],
          finding_total: f?.findings.length ?? 0,
          history_total: f?.history.length ?? 0,
          action_total: f?.actions.length ?? 0,
        };
      }),
    );
  private coordination?: Coordination;
  constructor(public store: Store) {}
  coordinate(locks: Locks) {
    return (this.coordination ??= new Coordination(locks));
  }
  coordinateCommit<A>(action: () => Effect.Effect<A, CrewError>) {
    return this.coordination ? this.coordination.with(action) : action();
  }
  /** Read-only normalization. Only a coordinated save writes a migration and its original. */
  private normalize(key: StorageKey, raw: unknown) {
    ensure(object(raw), "INVALID_RECORD", `${key}: Expected a record`);
    ensure(
      raw.schema_version === undefined || raw.schema_version === 1,
      "UNSUPPORTED_RECORD_VERSION",
      `${key}: Unsupported record version; preserve data and use a compatible runtime`,
    );
    const expectedID = key.slice(key.indexOf("/") + 1);
    ensure(
      (key.startsWith("project/")
        ? raw.id
        : key.startsWith("setup/")
          ? raw.repository_id
          : raw.issue_id) === expectedID,
      "RECORD_IDENTITY",
      `${key}: Record identity does not match its key`,
    );
    if (key.startsWith("project/"))
      return {
        diagnostic_turns: 1,
        repair_rounds: 0,
        generated_paths: [],
        merge_method: "merge",
        ci_policy: "all-reported",
        allow_no_checks: false,
        max_executions: raw.max_workers,
        branch_policy: "fixed",
        managed: false,
        ...raw,
        ...(raw.schema_version === undefined ? { schema_version: 1, revision: 1 } : {}),
      };
    if (raw.schema_version === 1) return raw;
    const setup = key.startsWith("setup/");
    return {
      ...raw,
      schema_version: 1,
      revision: 1,
      control_generation: 0,
      ...(setup ? { plan_approval_required: false } : {}),
      effective_policy: {
        verification: object(raw.verification_receipt) ? raw.verification_receipt.commands : [],
        delivery: raw.delivery_policy,
        plan_approval: setup ? false : raw.plan_approval_required,
        merge_approval: raw.merge_approval_required,
        merge_method: "merge",
        ci_policy: "all-reported",
        allow_no_checks: false,
        generated_paths: [],
        diagnostic_turns: 1,
        repair_rounds: 0,
      },
    };
  }
  private read<S extends Schema.ConstraintDecoder<unknown>>(key: StorageKey, schema: S) {
    return domainEffect(
      Effect.gen({ self: this }, function* () {
        const raw = yield* this.store.get(key);
        if (raw === undefined) return undefined;
        return yield* decode(schema, this.normalize(key, raw), key);
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
                decode(schema, this.normalize(entry.key, entry.value), entry.key),
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
    return Effect.all([this.projectScan(), this.executionScan(), this.setupScan()]).pipe(
      Effect.map((scans) => scans.flatMap((s) => s.diagnostics)),
    );
  }
  private write<S extends Schema.ConstraintDecoder<unknown>>(
    key: StorageKey,
    schema: S,
    value: object,
    control = false,
  ) {
    return this.coordinateCommit(() =>
      domainEffect(
        Effect.gen({ self: this }, function* () {
          const original = yield* this.store.get(key);
          const prior =
            original === undefined
              ? undefined
              : yield* decode(schema, this.normalize(key, original), key);
          const owned = new Set(
            Object.keys(
              key.startsWith("project/") ? ProjectRecordSchema.fields : executionRecordFields,
            ),
          );
          const extensions = object(original)
            ? Object.fromEntries(Object.entries(original).filter(([field]) => !owned.has(field)))
            : {};
          const record = {
            ...extensions,
            ...value,
            schema_version: 1,
            revision: object(prior) && typeof prior.revision === "number" ? prior.revision + 1 : 1,
          };
          if (!key.startsWith("project/") && object(prior) && object(value)) {
            if (
              !(
                (control ? Number(prior.control_generation) + 1 : prior.control_generation) ===
                value.control_generation
              )
            )
              return yield* new CrewError(
                "STALE_OPERATION",
                `${key}: Control generation changed; discard stale result`,
              );
          }
          if (!key.startsWith("project/") && object(prior) && object(value)) {
            if (!control && object(prior.operation) && object(value.operation)) {
              if (
                !(
                  (prior.operation.id === value.operation.id &&
                    prior.operation.fingerprint === value.operation.fingerprint &&
                    prior.operation.generation === value.operation.generation) ||
                  (value.operation.status === "prepared" && value.revision === prior.revision)
                )
              )
                return yield* new CrewError(
                  "STALE_OPERATION",
                  `${key}: Operation identity changed; discard stale result`,
                );
            }
            if (
              typeof prior.revision === "number" &&
              typeof value.revision === "number" &&
              value.revision < prior.revision
            )
              for (const field of [
                "feedback",
                "provisional",
                "implementation_head",
                "external_validation",
                "external_history",
                "validation_setup",
                "worker_failure",
                "progress",
                "decisions",
                "waits",
                "attention",
                "attention_turns",
                "resume_after_decision",
                "finishing",
              ]) {
                if (field in prior) Object.assign(record, { [field]: prior[field] });
                else Reflect.deleteProperty(record, field);
              }
          }
          if (!key.startsWith("project/") && object(prior) && object(value) && !control) {
            if (
              !(JSON.stringify(prior.effective_policy) === JSON.stringify(value.effective_policy))
            )
              return yield* new CrewError(
                "POLICY_DRIFT",
                `${key}: Effective execution policy is immutable without an explicit revision`,
              );
          }
          if (
            !key.startsWith("project/") &&
            object(prior) &&
            Array.isArray(prior.rounds) &&
            object(value)
          ) {
            if (
              !(
                Array.isArray(value.rounds) &&
                value.rounds.length >= prior.rounds.length &&
                JSON.stringify(value.rounds.slice(0, prior.rounds.length)) ===
                  JSON.stringify(prior.rounds)
              )
            )
              return yield* new CrewError(
                "ROUND_HISTORY",
                "Correction history cannot be rewritten or removed",
              );
          }
          if (object(prior) && object(value)) {
            if (
              Array.isArray(prior.external_history) &&
              (!Array.isArray(value.external_history) ||
                JSON.stringify(value.external_history.slice(0, prior.external_history.length)) !==
                  JSON.stringify(prior.external_history))
            )
              return yield* new CrewError(
                "EXTERNAL_HISTORY",
                "External run history cannot be rewritten or removed",
              );
            if (
              object(prior.external_validation) &&
              prior.external_validation.custody !== "returned"
            ) {
              const next = object(value.external_validation)
                ? value.external_validation
                : undefined;
              for (const field of [
                "nonce",
                "submitted_head",
                "intent_digest",
                "validation_generation",
                "preflight",
              ])
                if (
                  !next ||
                  JSON.stringify(next[field]) !== JSON.stringify(prior.external_validation[field])
                )
                  return yield* new CrewError(
                    "EXTERNAL_IDENTITY",
                    "Active external launch cannot be rebound or removed",
                  );
            }
          }
          if (object(prior) && object(prior.feedback) && Array.isArray(prior.feedback.history)) {
            const next = object(value) && object(value.feedback) ? value.feedback : undefined;
            if (
              !next ||
              !Array.isArray(next.history) ||
              JSON.stringify(next.history.slice(0, prior.feedback.history.length)) !==
                JSON.stringify(prior.feedback.history)
            )
              return yield* new CrewError(
                "FEEDBACK_HISTORY",
                "Retained feedback history cannot be removed or rewritten",
              );
          }
          const decoded = yield* decode(schema, record, key);
          if (!object(decoded))
            return yield* new CrewError("INVALID_RECORD", `${key}: Expected decoded record`);
          if (object(original) && original.schema_version === undefined) {
            const backup = StorageKey.make(`legacy-original/${key}`);
            if ((yield* this.store.get(backup)) === undefined)
              yield* this.store.set(backup, original);
          }
          // Preserve additive unknown evidence when updating fields owned by this version.
          yield* this.store.set(key, { ...record, ...decoded });
          yield* committed;
          const failure = object(decoded) ? decoded.worker_failure : undefined;
          const previous = object(prior) ? prior.worker_failure : undefined;
          const failureSchema = ExecutionStateSchema.fields.worker_failure;
          if (
            failure &&
            Schema.is(failureSchema)(failure) &&
            failure.role &&
            (!previous ||
              !Schema.is(failureSchema)(previous) ||
              previous.session_id !== failure.session_id ||
              previous.prompt_id !== failure.prompt_id ||
              previous.role !== failure.role ||
              JSON.stringify(previous.error) !== JSON.stringify(failure.error))
          )
            yield* providerFailure(failure.role);

          return decoded;
        }),
      ),
    );
  }
  /** Commit controller-owned aggregate fields against current progress and decision history. */
  saveOwned(
    e: Execution,
    fields: readonly (
      | "implementation_head"
      | "feedback"
      | "forge_observation"
      | "external_validation"
      | "external_history"
      | "validation_setup"
      | "current_phase"
      | "capacity_reservation"
    )[],
  ) {
    return this.update(e.issue_id, (current) => {
      ensure(
        current.control_generation === e.control_generation &&
          current.operation?.id === e.operation?.id,
        "STALE_OPERATION",
        "Owned aggregate update was superseded",
      );
      const next = { ...current };
      for (const field of fields) {
        if (field in e) Object.assign(next, { [field]: e[field] });
        else Reflect.deleteProperty(next, field);
      }
      return next;
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
      e.control_generation = e.control_generation + 1;
      e.attention = e.attention?.map((a) =>
        a.generation !== e.control_generation && !["handled", "superseded"].includes(a.status)
          ? {
              ...a,
              status: "superseded",
              disposition: `Superseded by control generation ${e.control_generation}`,
            }
          : a,
      );
      e.updated_at = yield* timestamp;
      return yield* this.write(
        StorageKey.make(`execution/${e.issue_id}`),
        executionSchema,
        e,
        true,
      ).pipe(
        Effect.tap((saved) => Effect.sync(() => synchronizeExecution(e, saved))),
        Effect.as(e),
      );
    });
  }
  saveProject(p: Project): Effect.Effect<Project, CrewError> {
    return this.write(StorageKey.make(`project/${p.id}`), projectSchema, p);
  }
  saveSetup(e: SetupExecution) {
    return this.saveExecution(e, true).pipe(Effect.as(e));
  }
  save(e: Execution) {
    return this.saveExecution(e, false).pipe(Effect.as(e));
  }
  private saveExecution = Effect.fn("Records.saveExecution")(
    function* (this: Records, e: ManagedExecution, setup: boolean) {
      e.updated_at = yield* timestamp;
      const key = StorageKey.make(
        `${setup ? "setup" : "execution"}/${setup ? e.repository_id : e.issue_id}`,
      );
      const saved = yield* this.write(key, setup ? setupSchema : executionSchema, e);
      synchronizeExecution(e, saved);
      return e;
    }.bind(this),
    domainEffect,
  );
}
