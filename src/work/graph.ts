import { DispatchSchema } from "../config/dispatch.ts";
import {
  BatchInputSchema,
  BatchResultSchema,
  normalizeBatch,
  batchRequests,
  type BatchInput,
} from "./batch.ts";
import { committed } from "../visibility/invalidations.ts";
import { AbsolutePath, Timestamp, timestamp, ExecutionId, IssueId } from "../identities.ts";

import { ScopeDraftSchema, ReportReferenceSchema } from "./scope.ts";
import { Effect, Schema } from "effect";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { dirname } from "node:path";
import { mkdir } from "../filesystem.ts";
import { CrewError, ensure, identifier, type Config } from "../domain.ts";
import { domainEffect } from "../effect.ts";

import {
  IssueSchema,
  explainIssues,
  normalizeIssue,
  SavedRequestSchema,
  type Issue,
  type NewIssue,
  type ReadyExplanation,
} from "./model.ts";
export type { NewIssue, ReadyExplanation } from "./model.ts";

export const WorkEventSchema = Schema.Struct({
  kind: Schema.Literals(["created", "claimed", "open", "in_progress", "blocked", "closed"]),
  actor: Schema.Union([Schema.Literal("supervisor"), ExecutionId]),
  reason: Schema.String,
  at: Timestamp,
});
export type WorkEvent = typeof WorkEventSchema.Type;

/** Open the configured SQLite work graph. */
export function openWorkGraph(config: Pick<Config, "work_database">) {
  return domainEffect(SqliteWorkGraph.open(config.work_database));
}
/** All ownership checks and writes are atomic, including across independent processes. */
export interface WorkGraph {
  create(input: NewIssue): Effect.Effect<Issue, CrewError>;
  createBatch(input: BatchInput): Effect.Effect<typeof BatchResultSchema.Type, CrewError>;
  show(id: IssueId): Effect.Effect<Issue, CrewError>;
  readonly list: Effect.Effect<Issue[], CrewError>;
  readonly explain: Effect.Effect<ReadyExplanation, CrewError>;
  readonly ready: Effect.Effect<Issue[], CrewError>;
  claim(id: IssueId, execution: ExecutionId): Effect.Effect<void, CrewError>;
  block(id: IssueId, execution: ExecutionId, reason: string): Effect.Effect<void, CrewError>;
  resume(id: IssueId, execution: ExecutionId): Effect.Effect<void, CrewError>;
  close(id: IssueId, execution: ExecutionId): Effect.Effect<void, CrewError>;
  history(id: IssueId): Effect.Effect<WorkEvent[], CrewError>;
  completions(
    start: Timestamp,
    end: Timestamp,
  ): Effect.Effect<Array<{ issue_id: IssueId; at: Timestamp }>, CrewError>;
}

const sqlEffect = <A>(action: (at: Timestamp) => A) =>
  timestamp.pipe(
    Effect.flatMap((at) => Effect.try({ try: () => action(at), catch: CrewError.from })),
  );
const decodeIssue = Schema.decodeUnknownSync(IssueSchema);

/** A scoped connection. Transactions contain only synchronous SQL and domain checks. */
export class SqliteWorkGraph implements WorkGraph {
  private constructor(private db: DatabaseSync) {}

  static open(path: AbsolutePath | ":memory:") {
    return Effect.gen(function* () {
      if (path !== ":memory:") yield* mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const db = yield* Effect.acquireRelease(
        sqlEffect(() => new DatabaseSync(path)),
        (db) => sqlEffect(() => db.close()).pipe(Effect.orDie),
      );
      yield* sqlEffect(() => {
        db.exec(
          "PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;",
        );
        db.exec("BEGIN IMMEDIATE");
        try {
          const version = db.prepare("PRAGMA user_version").get()!.user_version;
          ensure(
            version === 0 ||
              version === 1 ||
              version === 2 ||
              version === 3 ||
              version === 4 ||
              version === 5 ||
              version === 6,
            "WORK_DATABASE_VERSION",
            `Unsupported work database version ${String(version)}`,
          );
          db.exec(`
          CREATE TABLE IF NOT EXISTS issues (
            id TEXT PRIMARY KEY,
            repository_id TEXT NOT NULL,
            workflow_policy TEXT NOT NULL,
            request_id TEXT NOT NULL UNIQUE,
            request_input TEXT NOT NULL,
            title TEXT NOT NULL,
            description TEXT NOT NULL,
            priority INTEGER NOT NULL CHECK (priority BETWEEN 0 AND 4),
            status TEXT NOT NULL CHECK (status IN ('open','in_progress','blocked','closed')),
            assignee TEXT
          );
          CREATE TABLE IF NOT EXISTS dependencies (
            issue_id TEXT NOT NULL REFERENCES issues(id),
            dependency_id TEXT NOT NULL REFERENCES issues(id),
            PRIMARY KEY (issue_id, dependency_id),
            CHECK (issue_id <> dependency_id)
          );
          CREATE TABLE IF NOT EXISTS work_events (
            sequence INTEGER PRIMARY KEY,
            issue_id TEXT NOT NULL REFERENCES issues(id),
            kind TEXT NOT NULL,
            actor TEXT NOT NULL,
            reason TEXT NOT NULL,
            at TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS work_events_issue ON work_events(issue_id, sequence);
          CREATE INDEX IF NOT EXISTS work_events_completion ON work_events(kind, at, issue_id);
        `);
          const columns = db.prepare("PRAGMA table_info(issues)").all();
          if (!columns.some((c) => c.name === "scope_json"))
            db.exec("ALTER TABLE issues ADD COLUMN scope_json TEXT");
          if (!columns.some((c) => c.name === "report_reference_json"))
            db.exec("ALTER TABLE issues ADD COLUMN report_reference_json TEXT");
          if (!columns.some((c) => c.name === "quality_profile"))
            db.exec("ALTER TABLE issues ADD COLUMN quality_profile TEXT");
          if (!columns.some((c) => c.name === "dispatch_json"))
            db.exec("ALTER TABLE issues ADD COLUMN dispatch_json TEXT");
          db.exec(`
            CREATE TABLE IF NOT EXISTS work_batches (
              request_id TEXT PRIMARY KEY,
              request_input TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS batch_items (
              batch_request_id TEXT NOT NULL REFERENCES work_batches(request_id),
              client_key TEXT NOT NULL,
              issue_id TEXT NOT NULL UNIQUE REFERENCES issues(id),
              PRIMARY KEY(batch_request_id, client_key)
            );
            PRAGMA user_version = 6;
            COMMIT;
          `);
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      });
      return new SqliteWorkGraph(db);
    });
  }

  private transaction<A>(action: () => A, write = true): A {
    this.db.exec(write ? "BEGIN IMMEDIATE" : "BEGIN");
    try {
      const result = action();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private issue(id: IssueId): Issue {
    const row = this.db.prepare("SELECT * FROM issues WHERE id = ?").get(identifier(id));
    ensure(row, "ISSUE_MISSING", `Missing issue ${id}`);
    const dependencies = this.db
      .prepare("SELECT dependency_id FROM dependencies WHERE issue_id = ? ORDER BY dependency_id")
      .all(id)
      .map((row) => row.dependency_id);
    const scope =
      row.scope_json == null
        ? undefined
        : Schema.decodeSync(Schema.fromJsonString(ScopeDraftSchema))(String(row.scope_json));
    const report_reference =
      row.report_reference_json == null
        ? undefined
        : Schema.decodeSync(Schema.fromJsonString(ReportReferenceSchema))(
            String(row.report_reference_json),
          );
    return decodeIssue({
      ...row,
      scope,
      report_reference,
      quality_profile: row.quality_profile ?? undefined,
      dispatch:
        row.dispatch_json == null
          ? undefined
          : Schema.decodeSync(Schema.fromJsonString(DispatchSchema))(String(row.dispatch_json)),
      assignee: row.assignee ?? undefined,
      dependencies,
    });
  }

  private issues(): Issue[] {
    return this.db
      .prepare("SELECT id FROM issues ORDER BY priority, id")
      .all()
      .map((row) => this.issue(IssueId.make(String(row.id))));
  }

  private event(
    id: IssueId,
    kind: WorkEvent["kind"],
    actor: WorkEvent["actor"],
    at: Timestamp,
    reason = "",
  ) {
    this.db
      .prepare("INSERT INTO work_events (issue_id, kind, actor, reason, at) VALUES (?, ?, ?, ?, ?)")
      .run(id, kind, actor, reason, at);
  }

  private insert(issue: Issue, input: string) {
    this.db
      .prepare(`INSERT INTO issues
      (id, repository_id, workflow_policy, request_id, request_input, title, description, priority, status, assignee)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        issue.id,
        issue.repository_id,
        issue.workflow_policy,
        issue.request_id,
        input,
        issue.title,
        issue.description,
        issue.priority,
        issue.status,
        issue.assignee ?? null,
      );
    this.db
      .prepare("UPDATE issues SET quality_profile = ? WHERE id = ?")
      .run(issue.quality_profile ?? null, issue.id);
    this.db
      .prepare(
        "UPDATE issues SET scope_json = ?, report_reference_json = ?, dispatch_json = ? WHERE id = ?",
      )
      .run(
        issue.scope === undefined ? null : JSON.stringify(issue.scope),
        issue.report_reference === undefined ? null : JSON.stringify(issue.report_reference),
        issue.dispatch === undefined ? null : JSON.stringify(issue.dispatch),
        issue.id,
      );
  }

  create(input: NewIssue) {
    return sqlEffect((at) =>
      this.transaction(() => {
        const request = normalizeIssue(input);
        const encoded = JSON.stringify(request);
        ensure(
          !this.db
            .prepare("SELECT request_id FROM work_batches WHERE request_id = ?")
            .get(request.request_id),
          "REQUEST_REBIND",
          "Request identity belongs to batch intake",
        );
        const saved = this.db
          .prepare("SELECT id, request_input FROM issues WHERE request_id = ?")
          .get(request.request_id);
        if (saved) {
          ensure(
            JSON.stringify(
              normalizeIssue(Schema.decodeSync(SavedRequestSchema)(String(saved.request_input))),
            ) === encoded,
            "REQUEST_REBIND",
            "This request_id belongs to a different goal; reuse its original input or choose a new request_id",
          );
          return this.issue(IssueId.make(String(saved.id)));
        }
        for (const id of request.dependencies) this.issue(id);
        const issue: Issue = {
          ...request,
          id: IssueId.make(`abra-${randomUUID()}`),
          workflow_policy: request.workflow_policy ?? "full-openspec",
          status: "open",
        };
        this.insert(issue, encoded);
        const link = this.db.prepare(
          "INSERT INTO dependencies (issue_id, dependency_id) VALUES (?, ?)",
        );
        for (const dependency of issue.dependencies) link.run(issue.id, dependency);
        this.event(issue.id, "created", "supervisor", at);
        return issue;
      }),
    ).pipe(Effect.tap(() => committed));
  }

  createBatch(input: BatchInput) {
    return sqlEffect((at) =>
      this.transaction(() => {
        const batch = normalizeBatch(input),
          encoded = JSON.stringify(batch);
        ensure(
          !this.db.prepare("SELECT id FROM issues WHERE request_id = ?").get(batch.request_id),
          "REQUEST_REBIND",
          "Batch identity belongs to single-item intake",
        );
        const saved = this.db
          .prepare("SELECT request_input FROM work_batches WHERE request_id = ?")
          .get(batch.request_id);
        if (saved) {
          const previous = normalizeBatch(
            Schema.decodeSync(Schema.fromJsonString(BatchInputSchema))(String(saved.request_input)),
          );
          ensure(
            JSON.stringify(previous) === encoded,
            "REQUEST_REBIND",
            "Batch identity belongs to different keyed task definitions",
          );
          const rows = this.db
            .prepare(
              "SELECT client_key, issue_id FROM batch_items WHERE batch_request_id = ? ORDER BY client_key",
            )
            .all(batch.request_id);
          ensure(
            rows.length === batch.tasks.length,
            "BATCH_RECEIPT",
            "Batch receipt is incomplete; do not recreate its issues",
          );
          return Schema.decodeUnknownSync(BatchResultSchema)({
            request_id: batch.request_id,
            tasks: rows.map((row) => ({
              client_key: row.client_key,
              issue: this.issue(IssueId.make(String(row.issue_id))),
            })),
          });
        }
        const ids = new Map(
          batch.tasks.map((task) => [task.client_key, IssueId.make(`abra-${randomUUID()}`)]),
        );
        const requests = batchRequests(batch, ids);
        const created: Issue[] = requests.map(({ id, input }) => ({
          ...input,
          id,
          workflow_policy: input.workflow_policy ?? "full-openspec",
          status: "open",
        }));
        for (const { input } of requests)
          ensure(
            !this.db.prepare("SELECT id FROM issues WHERE request_id = ?").get(input.request_id),
            "REQUEST_REBIND",
            "Batch item identity is already owned by another intake request",
          );
        // Validate the complete graph before inserting any receipt, issue or event.
        const existing = this.issues(),
          existingIDs = new Set(existing.map((issue) => issue.id));
        for (const task of batch.tasks)
          for (const dependency of task.dependencies)
            if (dependency.type === "existing")
              ensure(
                existingIDs.has(dependency.issue_id),
                "ISSUE_MISSING",
                `Missing issue ${dependency.issue_id}`,
              );
        const all = [...existing, ...created];
        const remaining = new Map(all.map((issue) => [issue.id, issue.dependencies.length]));
        const children = new Map<IssueId, IssueId[]>();
        for (const issue of all)
          for (const dependency of issue.dependencies) {
            ensure(remaining.has(dependency), "ISSUE_MISSING", `Missing issue ${dependency}`);
            children.set(dependency, [...(children.get(dependency) ?? []), issue.id]);
          }
        const ready = [...remaining].filter(([, count]) => count === 0).map(([id]) => id);
        let count = 0;
        for (let index = 0; index < ready.length; index++) {
          count++;
          for (const child of children.get(ready[index]!) ?? []) {
            const degree = remaining.get(child)! - 1;
            remaining.set(child, degree);
            if (degree === 0) ready.push(child);
          }
        }
        ensure(count === remaining.size, "BATCH_CYCLE", "Work dependencies contain a cycle");
        this.db
          .prepare("INSERT INTO work_batches (request_id, request_input) VALUES (?, ?)")
          .run(batch.request_id, encoded);
        for (let index = 0; index < created.length; index++)
          this.insert(created[index]!, JSON.stringify(requests[index]!.input));
        const link = this.db.prepare(
          "INSERT INTO dependencies (issue_id, dependency_id) VALUES (?, ?)",
        );
        const item = this.db.prepare(
          "INSERT INTO batch_items (batch_request_id, client_key, issue_id) VALUES (?, ?, ?)",
        );
        for (const [index, issue] of created.entries()) {
          for (const dependency of issue.dependencies) link.run(issue.id, dependency);
          item.run(batch.request_id, requests[index]!.client_key, issue.id);
          this.event(
            issue.id,
            "created",
            "supervisor",
            at,
            `Batch ${batch.request_id}, task ${requests[index]!.client_key}`,
          );
        }
        return {
          request_id: batch.request_id,
          tasks: created.map((issue, index) => ({
            client_key: requests[index]!.client_key,
            issue,
          })),
        };
      }),
    ).pipe(Effect.tap(() => committed));
  }

  show(id: IssueId) {
    return sqlEffect(() => this.transaction(() => this.issue(id), false));
  }

  readonly list = sqlEffect(() => this.transaction(() => this.issues(), false));

  // A single read transaction prevents a mixed snapshot during concurrent closure.
  readonly explain = sqlEffect(() => this.transaction(() => explainIssues(this.issues()), false));

  readonly ready = this.explain.pipe(Effect.map((result) => result.ready));

  claim(id: IssueId, execution: ExecutionId) {
    return sqlEffect((at) =>
      this.transaction(() => {
        identifier(execution);
        const issue = this.issue(id);
        if (issue.assignee === execution && issue.status === "in_progress") return;
        ensure(!issue.assignee, "CLAIM_LOST", "Another execution owns issue");
        ensure(
          issue.status === "open" &&
            issue.dependencies.every((id) => this.issue(id).status === "closed"),
          "NOT_READY",
          "Issue status/dependencies prevent readiness",
        );
        this.db
          .prepare("UPDATE issues SET assignee = ?, status = 'in_progress' WHERE id = ?")
          .run(execution, id);
        this.event(id, "claimed", execution, at);
      }),
    ).pipe(Effect.tap(() => committed));
  }

  private transition(
    id: IssueId,
    execution: ExecutionId,
    from: Issue["status"],
    to: Issue["status"],
    reason = "",
  ) {
    return sqlEffect((at) =>
      this.transaction(() => {
        identifier(execution);
        const issue = this.issue(id);
        ensure(issue.assignee === execution, "CLAIM_LOST", "Another execution owns issue");
        if (issue.status === to) return;
        ensure(issue.status === from, "WORK_DRIFT", `Expected ${from}, found ${issue.status}`);
        this.db.prepare("UPDATE issues SET status = ? WHERE id = ?").run(to, id);
        this.event(id, to, execution, at, reason);
      }),
    ).pipe(Effect.tap(() => committed));
  }

  block(id: IssueId, execution: ExecutionId, reason: string) {
    return this.transition(id, execution, "in_progress", "blocked", reason);
  }

  resume(id: IssueId, execution: ExecutionId) {
    return this.transition(id, execution, "blocked", "in_progress");
  }

  close(id: IssueId, execution: ExecutionId) {
    return this.transition(
      id,
      execution,
      "in_progress",
      "closed",
      "AbraCode verified delivery and retired owned worktree",
    );
  }

  history(id: IssueId) {
    return sqlEffect(() => {
      this.issue(id);
      return this.db
        .prepare(
          "SELECT kind, actor, reason, at FROM work_events WHERE issue_id = ? ORDER BY sequence",
        )
        .all(id)
        .map((row) => Schema.decodeUnknownSync(WorkEventSchema)(row));
    });
  }

  /** Read-only aggregate over authoritative closures, independent of ticket pages. */
  completions(start: Timestamp, end: Timestamp) {
    return sqlEffect(() =>
      this.db
        .prepare(`
      SELECT e.issue_id, MAX(e.at) AS at FROM work_events e
      JOIN issues i ON i.id = e.issue_id AND i.status = 'closed'
      WHERE e.kind = 'closed' AND e.at >= ? AND e.at < ?
      GROUP BY e.issue_id
    `)
        .all(start, end)
        .map((row) =>
          Schema.decodeUnknownSync(Schema.Struct({ issue_id: IssueId, at: Timestamp }))(row),
        ),
    );
  }
}
