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
import { Schema } from "effect";
import { DispatchSchema } from "../config/dispatch.ts";
import { decodeSync } from "../decode.ts";
import { ensure, identifier } from "../domain.ts";

import {
  IssueSchema,
  explainIssue,
  explainIssues,
  type Issue,
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

export class IssueQueries {
  private readonly sql: import("node:sqlite").SQLTagStore;
  constructor(private readonly db: DatabaseSync) {
    this.sql = db.createTagStore(32);
  }
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
          proposal_review: row.proposal_review ?? undefined,
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
      this.sql
        .all`SELECT *, json_extract(request_input, '$.proposal_review') AS proposal_review FROM issues WHERE id IN (SELECT value FROM json_each(${encoded}))`,
      this.sql
        .all`SELECT issue_id, dependency_id FROM dependencies WHERE issue_id IN (SELECT value FROM json_each(${encoded})) ORDER BY issue_id, dependency_id`,
    );
  }
  issue(id: IssueId): Issue {
    const issue = this.issuesByID([IssueId.make(identifier(id))])[0];
    ensure(issue, "ISSUE_MISSING", `Missing issue ${id}`);
    return issue;
  }
  allIssues(): Issue[] {
    return this.hydrate(
      this.sql
        .all`SELECT *, json_extract(request_input, '$.proposal_review') AS proposal_review FROM issues ORDER BY priority, id`,
      this.sql
        .all`SELECT issue_id, dependency_id FROM dependencies ORDER BY issue_id, dependency_id`,
    );
  }
  hasRequest(id: RequestId) {
    return sqlEffect(() => Boolean(this.sql.get`SELECT 1 FROM issues WHERE request_id = ${id}`));
  }
  searchOwners(after: string, repository?: RepositoryId, issue?: IssueId) {
    return sqlEffect(() =>
      this.sql
        .all`SELECT id,repository_id,title FROM issues WHERE id >= ${after} AND (${repository ?? null} IS NULL OR repository_id = ${repository ?? null}) AND (${issue ?? null} IS NULL OR id = ${issue ?? null}) ORDER BY id LIMIT 5`.map(
        (row) => decodeSync(OwnerSummarySchema, row, "Discovery owner"),
      ),
    );
  }
  repositoryIssueSummaries(repository: RepositoryId) {
    return sqlEffect(() =>
      this.sql
        .all`SELECT id, title, status FROM issues WHERE repository_id = ${repository} ORDER BY priority, id`.map(
        (row) => decodeSync(IssueSummarySchema, row, "Repository issue summary"),
      ),
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
              `SELECT *, json_extract(request_input, '$.proposal_review') AS proposal_review FROM issues WHERE ${condition} ORDER BY ${rank}priority, id LIMIT ? OFFSET ?`,
            )
            .all(...values, ...rankValues, limit, offset);
          return {
            entries: this.hydrate(
              rows,
              this.sql
                .all`SELECT issue_id, dependency_id FROM dependencies WHERE issue_id IN (SELECT value FROM json_each(${JSON.stringify(rows.map((row) => row.id))})) ORDER BY issue_id, dependency_id`,
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
  show(id: IssueId) {
    return sqlEffect(() => runTransaction(this.db, () => this.issue(id), false));
  }
  taskRows(entries: readonly Issue[]): TaskEvidence[] {
    if (!entries.length) return [];
    const encoded = JSON.stringify(entries.map((entry) => entry.id));
    const byID = new Map<IssueId, TaskEvidence>(
      entries.map(({ id }) => [id, { id, dependencies: [] }]),
    );
    const dependencies = this.sql.all`
        SELECT d.issue_id, d.dependency_id AS id, i.title, i.status
        FROM dependencies d LEFT JOIN issues i ON i.id = d.dependency_id
        WHERE d.issue_id IN (SELECT value FROM json_each(${encoded}))
        ORDER BY d.issue_id, d.dependency_id
      `;
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
      const closures = this.sql.all`
          SELECT i.id, (SELECT at FROM work_events
            WHERE issue_id = i.id AND kind = 'closed' ORDER BY sequence DESC LIMIT 1) AS closed_at
          FROM issues i WHERE i.id IN (SELECT value FROM json_each(${JSON.stringify(closed.map(({ id }) => id))}))
        `;
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
      const row = this.sql.get`SELECT COALESCE(MAX(sequence), 0) AS revision FROM work_events`;
      return String(row?.revision ?? 0);
    });
  }
  closureTimes() {
    return sqlEffect(() =>
      Object.fromEntries(
        this.sql.all`
            SELECT issue_id, at FROM (
              SELECT e.issue_id, e.at,
                ROW_NUMBER() OVER (PARTITION BY e.issue_id ORDER BY e.sequence DESC) AS position
              FROM work_events e JOIN issues i ON i.id = e.issue_id AND i.status = 'closed'
              WHERE e.kind = 'closed'
            ) WHERE position = 1
          `.map((row) => {
          const closure = decodeSync(IssueClosureSchema, row, "Issue closure");
          return [closure.issue_id, closure.at];
        }),
      ),
    );
  }
  explain() {
    return sqlEffect(() => runTransaction(this.db, () => explainIssues(this.allIssues()), false));
  }
  history(id: IssueId) {
    return sqlEffect(() => {
      this.issue(id);
      return this.sql
        .all`SELECT kind, actor, reason, at FROM work_events WHERE issue_id = ${id} ORDER BY sequence`.map(
        (row) => decodeSync(WorkEventSchema, row, "Work event"),
      );
    });
  }
  completions(start: Timestamp, end: Timestamp) {
    return sqlEffect(() =>
      this.sql.all`
          SELECT e.issue_id, MAX(e.at) AS at FROM work_events e
          JOIN issues i ON i.id = e.issue_id AND i.status = 'closed'
          WHERE e.kind = 'closed' AND e.at >= ${start} AND e.at < ${end}
          GROUP BY e.issue_id
        `.map((row) => decodeSync(IssueClosureSchema, row, "Issue completion")),
    );
  }
}
