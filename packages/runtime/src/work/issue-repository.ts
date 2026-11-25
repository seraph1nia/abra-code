import { type DatabaseSync } from "node:sqlite";
import {
  ExecutionId,
  IssueId,
  Timestamp,
  type RepositoryId,
  type RequestId,
} from "@abracode/contracts/identities";
import {
  WorkDiscoveryQuery,
  type WorkDiscovery,
} from "@abracode/contracts/visibility/discovery-contracts";
import { ThoughtSource } from "@abracode/contracts/visibility/thoughts";
import { Effect, Schema } from "effect";
import { DispatchSchema } from "../config/dispatch.ts";
import { decodeSync } from "../decode.ts";
import { ensure, identifier } from "../domain.ts";
import { committedScope } from "../visibility/invalidations.ts";
import { type InboxIndex, type SourceLink } from "./inbox-index.ts";
import {
  IssueSchema,
  SavedRequestSchema,
  explainIssue,
  explainIssues,
  normalizeIssue,
  type Issue,
  type NewIssue,
  type ReadyExplanation,
} from "./model.ts";
import { ReportReferenceSchema, ScopeDraftSchema } from "./scope.ts";
import { runTransaction, sqlEffect, type Row } from "./sqlite.ts";

export const WorkEventSchema = Schema.Struct({
  kind: Schema.Literals(["created", "claimed", "open", "in_progress", "blocked", "closed"]),
  actor: Schema.Union([Schema.Literal("supervisor"), ExecutionId]),
  reason: Schema.String,
  at: Timestamp,
});
export type WorkEvent = typeof WorkEventSchema.Type;

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

const IssueSummarySchema = Schema.Struct({
  id: IssueId,
  title: IssueSchema.fields.title,
  status: IssueSchema.fields.status,
});
const OwnerSummarySchema = Schema.Struct({
  id: IssueSchema.fields.id,
  repository_id: IssueSchema.fields.repository_id,
  title: IssueSchema.fields.title,
});
const IssueClosureSchema = Schema.Struct({
  issue_id: IssueId,
  at: Timestamp,
});
const ScopeJsonSchema = Schema.fromJsonString(ScopeDraftSchema);
const ReportReferenceJsonSchema = Schema.fromJsonString(ReportReferenceSchema);
const ThoughtSourceJsonSchema = Schema.fromJsonString(ThoughtSource);
const DispatchJsonSchema = Schema.fromJsonString(DispatchSchema);

export class IssueRepository {
  constructor(
    private readonly db: DatabaseSync,
    private readonly inbox: InboxIndex,
    private readonly nextId: (request: RequestId) => IssueId,
  ) {}

  hydrate(rows: Row[], links: Row[]): Issue[] {
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
          : decodeSync(ScopeJsonSchema, String(row.scope_json), "Issue scope");
      const report_reference =
        row.report_reference_json == null
          ? undefined
          : decodeSync(
              ReportReferenceJsonSchema,
              String(row.report_reference_json),
              "Issue report reference",
            );
      const thought_source =
        row.thought_source_json == null
          ? undefined
          : decodeSync(
              ThoughtSourceJsonSchema,
              String(row.thought_source_json),
              "Issue thought source",
            );
      const dispatch =
        row.dispatch_json == null
          ? undefined
          : decodeSync(DispatchJsonSchema, String(row.dispatch_json), "Issue dispatch");
      return decodeSync(
        IssueSchema,
        {
          ...row,
          scope,
          report_reference,
          ...(thought_source !== undefined ? { thought_source } : {}),
          quality_profile: row.quality_profile ?? undefined,
          openspec_schema: row.openspec_schema ?? undefined,
          require_plan_approval:
            row.require_plan_approval == null ? undefined : row.require_plan_approval === 1,
          dispatch,
          assignee: row.assignee ?? undefined,
          dependencies,
        },
        "Issue row",
      );
    });
  }

  issuesByID(ids: readonly IssueId[]): Issue[] {
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

  issue(id: IssueId): Issue {
    const issue = this.issuesByID([IssueId.make(identifier(id))])[0];
    ensure(issue, "ISSUE_MISSING", `Missing issue ${id}`);
    return issue;
  }

  allIssues(): Issue[] {
    return this.hydrate(
      this.db.prepare("SELECT * FROM issues ORDER BY priority, id").all(),
      this.db
        .prepare(
          "SELECT issue_id, dependency_id FROM dependencies ORDER BY issue_id, dependency_id",
        )
        .all(),
    );
  }

  recordEvent(
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

  insert(issue: Issue, input: string) {
    this.db
      .prepare(
        `INSERT INTO issues (
          id, repository_id, workflow_policy, request_id, request_input,
          title, description, priority, status, assignee,
          quality_profile, openspec_schema, require_plan_approval,
          scope_json, report_reference_json, thought_source_json, dispatch_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
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
        issue.quality_profile ?? null,
        issue.openspec_schema ?? null,
        issue.require_plan_approval === true ? 1 : null,
        issue.scope === undefined ? null : JSON.stringify(issue.scope),
        issue.report_reference === undefined ? null : JSON.stringify(issue.report_reference),
        issue.thought_source === undefined ? null : JSON.stringify(issue.thought_source),
        issue.dispatch === undefined ? null : JSON.stringify(issue.dispatch),
      );
  }

  hasRequest(id: RequestId) {
    return sqlEffect(() =>
      Boolean(this.db.prepare("SELECT 1 FROM issues WHERE request_id = ?").get(id)),
    );
  }

  searchOwners(after: string, repository?: RepositoryId, issue?: IssueId) {
    return sqlEffect(() =>
      this.db
        .prepare(
          "SELECT id,repository_id,title FROM issues WHERE id >= ? AND (? IS NULL OR repository_id = ?) AND (? IS NULL OR id = ?) ORDER BY id LIMIT 5",
        )
        .all(after, repository ?? null, repository ?? null, issue ?? null, issue ?? null)
        .map((row) => decodeSync(OwnerSummarySchema, row, "Discovery owner")),
    );
  }

  repositoryIssueSummaries(repository: RepositoryId) {
    return sqlEffect(() =>
      this.db
        .prepare(
          "SELECT id, title, status FROM issues WHERE repository_id = ? ORDER BY priority, id",
        )
        .all(repository)
        .map((row) => decodeSync(IssueSummarySchema, row, "Repository issue summary")),
    );
  }

  find(input: WorkDiscovery = {}) {
    return sqlEffect(() =>
      runTransaction(
        this.db,
        () => {
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
          const rawSearch = query.search?.trim() ?? "";
          const search = rawSearch.toLowerCase();
          if (search) {
            where.push("(instr(abracode_lower(title), ?) > 0 OR instr(abracode_lower(id), ?) > 0)");
            values.push(search, search);
          }
          const condition = where.length ? where.join(" AND ") : "1";
          const countRow = this.db
            .prepare(`SELECT COUNT(*) AS total FROM issues WHERE ${condition}`)
            .get(...values);
          const total = countRow ? Number(countRow.total) : 0;
          const offset = query.offset ?? 0;
          const limit = query.limit ?? 50;
          if (!total || offset >= total) return { entries: [], total, offset, limit };
          const rank = search ? "(id = ?) DESC, (abracode_lower(id) = ?) DESC, " : "";
          const rankValues = search ? [rawSearch, search] : [];
          const rows = this.db
            .prepare(
              `SELECT * FROM issues WHERE ${condition} ORDER BY ${rank}priority, id LIMIT ? OFFSET ?`,
            )
            .all(...values, ...rankValues, limit, offset);
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
        },
        false,
      ),
    );
  }

  create(input: NewIssue, source?: SourceLink) {
    return sqlEffect((at) =>
      runTransaction(this.db, () => {
        const linked = source && this.inbox.source(source);
        if (linked) return this.issue(linked);
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
          ensure(!source, "REQUEST_REBIND", "Request identity already belongs to ordinary intake");
          ensure(
            JSON.stringify(
              normalizeIssue(
                decodeSync(SavedRequestSchema, String(saved.request_input), "Saved request"),
              ),
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
        if (source) this.inbox.link(issue.id, source);
        const link = this.db.prepare(
          "INSERT INTO dependencies (issue_id, dependency_id) VALUES (?, ?)",
        );
        for (const dependency of issue.dependencies) link.run(issue.id, dependency);
        this.recordEvent(issue.id, "created", "supervisor", at);
        return issue;
      }),
    ).pipe(Effect.tap(() => committedScope({ finder: true, work_all: true })));
  }

  show(id: IssueId) {
    return sqlEffect(() => runTransaction(this.db, () => this.issue(id), false));
  }

  taskRows(entries: readonly Issue[]): TaskEvidence[] {
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
      const target = byID.get(IssueId.make(String(row.issue_id)));
      if (!target) continue;
      const status = Schema.decodeUnknownResult(IssueSchema.fields.status)(row.status);
      target.dependencies.push({
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
      for (const row of closures) {
        if (row.closed_at == null) continue;
        const target = byID.get(IssueId.make(String(row.id)));
        if (target) target.closed_at = decodeSync(Timestamp, row.closed_at, "Closure timestamp");
      }
    }
    return [...byID.values()];
  }

  taskEvidence(entries: readonly Issue[]) {
    return sqlEffect(() => runTransaction(this.db, () => this.taskRows(entries), false));
  }

  task(id: IssueId) {
    return sqlEffect(() =>
      runTransaction(
        this.db,
        () => {
          const issue = this.issue(id);
          const row = this.taskRows([issue])[0];
          ensure(row, "ISSUE_MISSING", `Missing issue ${id}`);
          return { issue, dependencies: row.dependencies, closed_at: row.closed_at };
        },
        false,
      ),
    );
  }

  explainSelected(ids: readonly IssueId[]) {
    return sqlEffect(() =>
      runTransaction(
        this.db,
        () => {
          const issues = this.issuesByID(ids).filter((issue) => issue.status !== "closed");
          const evidenceByID = new Map(this.taskRows(issues).map((row) => [row.id, row]));
          const result: ReadyExplanation = { ready: [], blocked: [] };
          for (const issue of issues) {
            const evidence = evidenceByID.get(issue.id);
            const blockers = (evidence?.dependencies ?? []).flatMap(({ id, title, status }) => {
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
        },
        false,
      ),
    );
  }

  list() {
    return sqlEffect(() => runTransaction(this.db, () => this.allIssues(), false));
  }

  revision() {
    return sqlEffect(() => {
      const row = this.db
        .prepare("SELECT COALESCE(MAX(sequence), 0) AS revision FROM work_events")
        .get();
      return String(row?.revision ?? 0);
    });
  }

  closureTimes() {
    return sqlEffect(() =>
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
            const closure = decodeSync(IssueClosureSchema, row, "Issue closure");
            return [closure.issue_id, closure.at];
          }),
      ),
    );
  }

  // A single read transaction prevents a mixed snapshot during concurrent closure.
  explain() {
    return sqlEffect(() => runTransaction(this.db, () => explainIssues(this.allIssues()), false));
  }

  claim(id: IssueId, execution: ExecutionId) {
    return sqlEffect((at) =>
      runTransaction(this.db, () => {
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
            issue.dependencies.every((depId) => {
              const dependency = dependencies.get(depId);
              ensure(dependency, "ISSUE_MISSING", `Missing issue ${depId}`);
              return dependency.status === "closed";
            }),
          "NOT_READY",
          "Issue status/dependencies prevent readiness",
        );
        this.db
          .prepare("UPDATE issues SET assignee = ?, status = 'in_progress' WHERE id = ?")
          .run(execution, id);
        this.recordEvent(id, "claimed", execution, at);
      }),
    ).pipe(Effect.tap(() => committedScope({ finder: true, work_all: true })));
  }

  transition(
    id: IssueId,
    execution: ExecutionId,
    from: Issue["status"],
    to: Issue["status"],
    reason = "",
  ) {
    return sqlEffect((at) =>
      runTransaction(this.db, () => {
        identifier(execution);
        const issue = this.issue(id);
        ensure(issue.assignee === execution, "CLAIM_LOST", "Another execution owns issue");
        if (issue.status === to) return;
        ensure(issue.status === from, "WORK_DRIFT", `Expected ${from}, found ${issue.status}`);
        this.db.prepare("UPDATE issues SET status = ? WHERE id = ?").run(to, id);
        this.recordEvent(id, to, execution, at, reason);
      }),
    ).pipe(Effect.tap(() => committedScope({ finder: true, work_all: true })));
  }

  history(id: IssueId) {
    return sqlEffect(() => {
      this.issue(id);
      return this.db
        .prepare(
          "SELECT kind, actor, reason, at FROM work_events WHERE issue_id = ? ORDER BY sequence",
        )
        .all(id)
        .map((row) => decodeSync(WorkEventSchema, row, "Work event"));
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
        .map((row) => decodeSync(IssueClosureSchema, row, "Issue completion")),
    );
  }
}
