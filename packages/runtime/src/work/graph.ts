import { DispatchSchema } from "../config/dispatch.ts";
import {
  BatchInputSchema,
  BatchResultSchema,
  normalizeBatch,
  prepareBatch,
  type BatchInput,
} from "./batch.ts";
import { committedScope } from "../visibility/invalidations.ts";
import {
  AbsolutePath,
  Timestamp,
  timestamp,
  ExecutionId,
  IssueId,
  type RequestId,
} from "../identities.ts";

import { ScopeDraftSchema, ReportReferenceSchema } from "./scope.ts";
import { Effect, Schema } from "effect";
import { randomUUID } from "node:crypto";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import {
  WorkDiscoveryQuery,
  type WorkDiscovery,
} from "@abracode/contracts/visibility/discovery-contracts";
import { decodeSync } from "../decode.ts";
import { dirname } from "node:path";
import { mkdir } from "../filesystem.ts";
import { CrewError, ensure, identifier, type Config } from "../domain.ts";
import { domainEffect } from "../effect.ts";

import {
  IssueSchema,
  explainIssues,
  explainIssue,
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
export type IssuePage = {
  entries: Issue[];
  total: number;
  offset: number;
  limit: number;
  next_offset?: number;
};
export type TaskIssue = {
  issue: Issue;
  dependencies: Array<{ id: IssueId; title?: string; status: Issue["status"] | "unavailable" }>;
  closed_at?: Timestamp;
};
export type TaskEvidence = Omit<TaskIssue, "issue"> & { id: IssueId };
type Row = Record<string, SQLOutputValue>;
/** All ownership checks and writes are atomic, including across independent processes. */
export interface WorkGraph {
  create(input: NewIssue): Effect.Effect<Issue, CrewError>;
  createBatch(input: BatchInput): Effect.Effect<typeof BatchResultSchema.Type, CrewError>;
  show(id: IssueId): Effect.Effect<Issue, CrewError>;
  task(id: IssueId): Effect.Effect<TaskIssue, CrewError>;
  taskEvidence(entries: readonly Issue[]): Effect.Effect<TaskEvidence[], CrewError>;
  readonly list: Effect.Effect<Issue[], CrewError>;
  find(query?: WorkDiscovery): Effect.Effect<IssuePage, CrewError>;
  /** Opaque committed graph revision, observed without writing or acquiring a writer transaction. */
  readonly revision: Effect.Effect<string, CrewError>;
  readonly closureTimes: Effect.Effect<Record<string, Timestamp>, CrewError>;
  explainSelected(ids: readonly IssueId[]): Effect.Effect<ReadyExplanation, CrewError>;
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
  private validatedVersion?: number;
  private constructor(
    private db: DatabaseSync,
    private readonly nextId: (request: RequestId) => IssueId,
  ) {
    // SQLite lower() is ASCII-only; preserve the existing JavaScript Unicode search.
    db.function("abracode_lower", { deterministic: true }, (value) => String(value).toLowerCase());
  }

  static open(
    path: AbsolutePath | ":memory:",
    nextId: (request: RequestId) => IssueId = () => IssueId.make(`abra-${randomUUID()}`),
  ) {
    return Effect.gen(function* () {
      if (path !== ":memory:") yield* mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const db = yield* Effect.acquireRelease(
        sqlEffect(() => new DatabaseSync(path)),
        (db) => sqlEffect(() => db.close()).pipe(Effect.orDie),
      );
      const graph = new SqliteWorkGraph(db, nextId);
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
              version === 6 ||
              version === 7 ||
              version === 8 ||
              version === 9,
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
          db.exec(`
            CREATE INDEX IF NOT EXISTS issues_priority ON issues(priority, id);
            CREATE INDEX IF NOT EXISTS issues_repository_status ON issues(repository_id, status, priority, id);
            CREATE INDEX IF NOT EXISTS issues_repository_priority ON issues(repository_id, priority, id);
            CREATE INDEX IF NOT EXISTS issues_status ON issues(status, priority, id);
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
          if (!columns.some((c) => c.name === "openspec_schema"))
            db.exec("ALTER TABLE issues ADD COLUMN openspec_schema TEXT");
          if (!columns.some((c) => c.name === "require_plan_approval"))
            db.exec(
              "ALTER TABLE issues ADD COLUMN require_plan_approval INTEGER CHECK (require_plan_approval IS NULL OR require_plan_approval = 1)",
            );
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
          `);
          if (columns.some((c) => c.name === "finder_rank")) {
            db.exec(`
              DROP INDEX IF EXISTS issues_finder_rank;
              DROP INDEX IF EXISTS issues_finder_priority;
              DROP INDEX IF EXISTS issues_finder_repository;
              DROP INDEX IF EXISTS issues_finder_status;
              DROP INDEX IF EXISTS issues_finder_repository_status;
              DROP TABLE IF EXISTS finder_order;
              ALTER TABLE issues DROP COLUMN finder_rank;
            `);
          }
          const empty = !db.prepare("SELECT 1 FROM dependencies LIMIT 1").get();
          const versionStamp = graph.dataVersion();
          db.exec("PRAGMA user_version = 9; COMMIT");
          if (empty) graph.validatedVersion = versionStamp;
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      });
      return graph;
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

  private hydrate(rows: Row[], links: Row[]): Issue[] {
    const dependenciesByID = new Map<string, string[]>();
    for (const link of links) {
      const id = String(link.issue_id);
      const dependencies = dependenciesByID.get(id) ?? [];
      dependencies.push(String(link.dependency_id));
      dependenciesByID.set(id, dependencies);
    }
    return rows.map((row) => {
      const dependencies = dependenciesByID.get(String(row.id)) ?? [];
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
        openspec_schema: row.openspec_schema ?? undefined,
        require_plan_approval:
          row.require_plan_approval == null ? undefined : row.require_plan_approval === 1,
        dispatch:
          row.dispatch_json == null
            ? undefined
            : Schema.decodeSync(Schema.fromJsonString(DispatchSchema))(String(row.dispatch_json)),
        assignee: row.assignee ?? undefined,
        dependencies,
      });
    });
  }
  private issuesByID(ids: readonly IssueId[]): Issue[] {
    if (!ids.length) return [];
    const encoded = JSON.stringify(ids);
    return this.hydrate(
      this.db
        .prepare("SELECT * FROM issues WHERE id IN (SELECT value FROM json_each(?))")
        .all(encoded),
      this.db
        .prepare(
          "SELECT issue_id, dependency_id FROM dependencies WHERE issue_id IN (SELECT value FROM json_each(?)) ORDER BY issue_id, dependency_id",
        )
        .all(encoded),
    );
  }
  private issue(id: IssueId): Issue {
    const issue = this.issuesByID([IssueId.make(identifier(id))])[0];
    ensure(issue, "ISSUE_MISSING", `Missing issue ${id}`);
    return issue;
  }
  private issues(): Issue[] {
    return this.hydrate(
      this.db.prepare("SELECT * FROM issues ORDER BY priority, id").all(),
      this.db
        .prepare(
          "SELECT issue_id, dependency_id FROM dependencies ORDER BY issue_id, dependency_id",
        )
        .all(),
    );
  }
  find(input: WorkDiscovery = {}) {
    return sqlEffect(() =>
      this.transaction(() => {
        const query = decodeSync(WorkDiscoveryQuery, input, "Work discovery");
        const where: string[] = [];
        const values: string[] = [];
        if (query.repository_id) {
          where.push("repository_id = ?");
          values.push(query.repository_id);
        }
        const state = query.state ?? "active";
        if (state !== "all")
          where.push(state === "closed" ? "status = 'closed'" : "status <> 'closed'");
        const search = query.search?.trim().toLowerCase() ?? "";
        if (search) {
          where.push("(instr(abracode_lower(title), ?) > 0 OR instr(abracode_lower(id), ?) > 0)");
          values.push(search, search);
        }
        const condition = where.length ? where.join(" AND ") : "1";
        const total = Number(
          this.db.prepare(`SELECT COUNT(*) AS total FROM issues WHERE ${condition}`).get(...values)!
            .total,
        );
        const offset = query.offset ?? 0,
          limit = query.limit ?? 50;
        if (!total || offset >= total) return { entries: [], total, offset, limit };
        const rows = this.db
          .prepare(`SELECT * FROM issues WHERE ${condition} ORDER BY priority, id LIMIT ? OFFSET ?`)
          .all(...values, limit, offset);
        return {
          entries: this.hydrate(
            rows,
            this.db
              .prepare(
                "SELECT issue_id, dependency_id FROM dependencies WHERE issue_id IN (SELECT value FROM json_each(?)) ORDER BY issue_id, dependency_id",
              )
              .all(JSON.stringify(rows.map((row) => row.id))),
          ),
          total,
          offset,
          limit,
          next_offset: offset + limit < total ? offset + limit : undefined,
        };
      }, false),
    );
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
      .prepare(
        "UPDATE issues SET quality_profile = ?, openspec_schema = ?, require_plan_approval = ? WHERE id = ?",
      )
      .run(
        issue.quality_profile ?? null,
        issue.openspec_schema ?? null,
        issue.require_plan_approval === true ? 1 : null,
        issue.id,
      );
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
        const dependencies = new Set(
          this.issuesByID(request.dependencies).map((issue) => issue.id),
        );
        for (const id of request.dependencies)
          ensure(dependencies.has(id), "ISSUE_MISSING", `Missing issue ${id}`);
        const issue: Issue = {
          ...request,
          id: this.nextId(request.request_id),
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
    ).pipe(Effect.tap(() => committedScope({ finder: true, work_all: true })));
  }

  private dataVersion() {
    return Number(this.db.prepare("PRAGMA data_version").get()!.data_version);
  }
  private validateHistoricalEdges() {
    const edges = this.db
      .prepare(`
      SELECT d.issue_id, d.dependency_id, child.id AS child, parent.id AS parent
      FROM dependencies d LEFT JOIN issues child ON child.id = d.issue_id
      LEFT JOIN issues parent ON parent.id = d.dependency_id
    `)
      .all();
    const degree = new Map<string, number>();
    const children = new Map<string, string[]>();
    for (const edge of edges) {
      ensure(
        edge.child && edge.parent,
        "ISSUE_MISSING",
        `Missing endpoint of dependency ${String(edge.issue_id)} -> ${String(edge.dependency_id)}`,
      );
      const child = String(edge.child),
        parent = String(edge.parent);
      degree.set(child, (degree.get(child) ?? 0) + 1);
      if (!degree.has(parent)) degree.set(parent, 0);
      const siblings = children.get(parent);
      if (siblings) siblings.push(child);
      else children.set(parent, [child]);
    }
    const ready = [...degree].filter(([, n]) => n === 0).map(([id]) => id);
    for (const id of ready) {
      for (const child of children.get(id) ?? []) {
        const remaining = degree.get(child)! - 1;
        degree.set(child, remaining);
        if (remaining === 0) ready.push(child);
      }
    }
    ensure(ready.length === degree.size, "BATCH_CYCLE", "Work dependencies contain a cycle");
  }

  createBatch(input: BatchInput) {
    return sqlEffect((at) => {
      let validated: number | undefined;
      const result = this.transaction(() => {
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
          const issues = new Map(
            this.issuesByID(rows.map((row) => IssueId.make(String(row.issue_id)))).map((issue) => [
              issue.id,
              issue,
            ]),
          );
          return Schema.decodeUnknownSync(BatchResultSchema)({
            request_id: batch.request_id,
            tasks: rows.map((row) => ({
              client_key: row.client_key,
              issue: issues.get(IssueId.make(String(row.issue_id))),
            })),
          });
        }
        const { requests, existing } = prepareBatch(batch, this.nextId);
        const created: Issue[] = requests.map(({ id, input }) => ({
          ...input,
          id,
          workflow_policy: input.workflow_policy ?? "full-openspec",
          status: "open",
        }));
        ensure(
          !this.db
            .prepare(
              "SELECT request_id FROM issues WHERE request_id IN (SELECT value FROM json_each(?)) LIMIT 1",
            )
            .get(JSON.stringify(requests.map(({ input }) => input.request_id))),
          "REQUEST_REBIND",
          "Batch item identity is already owned by another intake request",
        );
        validated = this.dataVersion();
        if (validated !== this.validatedVersion) this.validateHistoricalEdges();
        if (existing.length) {
          const found = new Set(
            this.db
              .prepare("SELECT id FROM issues WHERE id IN (SELECT value FROM json_each(?))")
              .all(JSON.stringify(existing))
              .map((row) => row.id),
          );
          for (const id of existing) ensure(found.has(id), "ISSUE_MISSING", `Missing issue ${id}`);
        }
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
      });
      if (validated !== undefined) this.validatedVersion = validated;
      return result;
    }).pipe(Effect.tap(() => committedScope({ finder: true, work_all: true })));
  }

  show(id: IssueId) {
    return sqlEffect(() => this.transaction(() => this.issue(id), false));
  }
  private taskRows(entries: readonly Issue[]): TaskEvidence[] {
    if (!entries.length) return [];
    const encoded = JSON.stringify(entries.map((entry) => entry.id));
    const byID = new Map<IssueId, TaskEvidence>(
      entries.map(({ id }) => [id, { id, dependencies: [] }]),
    );
    const dependencies = this.db
      .prepare(`
        SELECT d.issue_id, d.dependency_id AS id, i.title, i.status
        FROM dependencies d LEFT JOIN issues i ON i.id = d.dependency_id
        WHERE d.issue_id IN (SELECT value FROM json_each(?))
        ORDER BY d.issue_id, d.dependency_id
      `)
      .all(encoded);
    for (const row of dependencies) {
      const status = Schema.decodeUnknownResult(IssueSchema.fields.status)(row.status);
      byID.get(IssueId.make(String(row.issue_id)))!.dependencies.push({
        id: IssueId.make(String(row.id)),
        title: typeof row.title === "string" ? row.title : undefined,
        status: status._tag === "Success" ? status.success : "unavailable",
      });
    }
    const closed = entries.filter(({ status }) => status === "closed");
    if (closed.length) {
      const closures = this.db
        .prepare(`
          SELECT i.id, (SELECT at FROM work_events
            WHERE issue_id = i.id AND kind = 'closed' ORDER BY sequence DESC LIMIT 1) AS closed_at
          FROM issues i WHERE i.id IN (SELECT value FROM json_each(?))
        `)
        .all(JSON.stringify(closed.map(({ id }) => id)));
      for (const row of closures)
        if (row.closed_at != null)
          byID.get(IssueId.make(String(row.id)))!.closed_at = Schema.decodeUnknownSync(Timestamp)(
            row.closed_at,
          );
    }
    return [...byID.values()];
  }
  taskEvidence(entries: readonly Issue[]) {
    return sqlEffect(() => this.transaction(() => this.taskRows(entries), false));
  }
  task(id: IssueId) {
    return sqlEffect(() =>
      this.transaction(() => {
        const issue = this.issue(id);
        const { dependencies, closed_at } = this.taskRows([issue])[0]!;
        return { issue, dependencies, closed_at };
      }, false),
    );
  }

  explainSelected(ids: readonly IssueId[]) {
    return sqlEffect(() =>
      this.transaction(() => {
        const issues = this.issuesByID(ids).filter((issue) => issue.status !== "closed");
        const evidence = this.taskRows(issues);
        const result: ReadyExplanation = { ready: [], blocked: [] };
        for (const [index, issue] of issues.entries()) {
          const blockers = evidence[index]!.dependencies.flatMap(({ id, title, status }) => {
            ensure(
              status !== "unavailable" && title !== undefined,
              "ISSUE_DEPENDENCIES",
              `Missing dependency ${id}`,
            );
            return status === "closed" ? [] : [{ id, title, status }];
          });
          explainIssue(result, issue, blockers);
        }
        return result;
      }, false),
    );
  }

  readonly list = sqlEffect(() => this.transaction(() => this.issues(), false));
  readonly revision = sqlEffect(() =>
    String(
      this.db.prepare("SELECT COALESCE(MAX(sequence), 0) AS revision FROM work_events").get()!
        .revision,
    ),
  );
  readonly closureTimes = sqlEffect(() =>
    Object.fromEntries(
      this.db
        .prepare(`
      SELECT issue_id, at FROM (
        SELECT e.issue_id, e.at,
          ROW_NUMBER() OVER (PARTITION BY e.issue_id ORDER BY e.sequence DESC) AS position
        FROM work_events e JOIN issues i ON i.id = e.issue_id AND i.status = 'closed'
        WHERE e.kind = 'closed'
      ) WHERE position = 1
    `)
        .all()
        .map((row) => {
          const closure = Schema.decodeUnknownSync(
            Schema.Struct({ issue_id: IssueId, at: Timestamp }),
          )(row);
          return [closure.issue_id, closure.at];
        }),
    ),
  );

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
        const dependencies =
          issue.status === "open"
            ? new Map(
                this.issuesByID(issue.dependencies).map((dependency) => [
                  dependency.id,
                  dependency,
                ]),
              )
            : new Map<IssueId, Issue>();
        ensure(
          issue.status === "open" &&
            issue.dependencies.every((id) => {
              const dependency = dependencies.get(id);
              ensure(dependency, "ISSUE_MISSING", `Missing issue ${id}`);
              return dependency.status === "closed";
            }),
          "NOT_READY",
          "Issue status/dependencies prevent readiness",
        );
        this.db
          .prepare("UPDATE issues SET assignee = ?, status = 'in_progress' WHERE id = ?")
          .run(execution, id);
        this.event(id, "claimed", execution, at);
      }),
    ).pipe(Effect.tap(() => committedScope({ finder: true, work_all: true })));
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
    ).pipe(Effect.tap(() => committedScope({ finder: true, work_all: true })));
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
