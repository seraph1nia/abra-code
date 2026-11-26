import { type DatabaseSync } from "node:sqlite";
import { ExecutionId, IssueId, Timestamp, type RequestId } from "@abracode/contracts/identities";

import { Effect } from "effect";

import { decodeSync } from "../decode.ts";
import { ensure, identifier } from "../domain.ts";
import { committedScope } from "../invalidations.ts";
import { type InboxIndex, type SourceLink } from "./inbox-index.ts";
import { SavedRequestSchema, normalizeIssue, type Issue, type NewIssue } from "./model.ts";

import { runTransaction, sqlEffect } from "./sqlite.ts";
import { IssueQueries, type WorkEvent } from "./issue-queries.ts";
export class IssueRepository {
  private readonly sql: import("node:sqlite").SQLTagStore;
  constructor(
    private readonly db: DatabaseSync,
    private readonly queries: IssueQueries,
    private readonly inbox: InboxIndex,
    private readonly nextId: (request: RequestId) => IssueId,
  ) {
    this.sql = db.createTagStore(32);
  }
  recordEvent(
    id: IssueId,
    kind: WorkEvent["kind"],
    actor: WorkEvent["actor"],
    at: Timestamp,
    reason = "",
  ) {
    void this.sql
      .run`INSERT INTO work_events (issue_id, kind, actor, reason, at) VALUES (${id}, ${kind}, ${actor}, ${reason}, ${at})`;
  }
  insert(issue: Issue, input: string) {
    void this.sql.run`INSERT INTO issues (
          id, repository_id, workflow_policy, request_id, request_input,
          title, description, priority, status, assignee,
          quality_profile, openspec_schema, require_plan_approval,
          scope_json, report_reference_json, thought_source_json, dispatch_json
        ) VALUES (${issue.id}, ${issue.repository_id}, ${issue.workflow_policy}, ${issue.request_id}, ${input}, ${issue.title}, ${issue.description}, ${issue.priority}, ${issue.status}, ${issue.assignee ?? null}, ${issue.quality_profile ?? null}, ${issue.openspec_schema ?? null}, ${issue.require_plan_approval === true ? 1 : null}, ${issue.scope === undefined ? null : JSON.stringify(issue.scope)}, ${issue.report_reference === undefined ? null : JSON.stringify(issue.report_reference)}, ${issue.thought_source === undefined ? null : JSON.stringify(issue.thought_source)}, ${issue.dispatch === undefined ? null : JSON.stringify(issue.dispatch)})`;
  }
  create(input: NewIssue, source?: SourceLink) {
    return sqlEffect((at) =>
      runTransaction(this.db, () => {
        const linked = source && this.inbox.source(source);
        if (linked) return this.queries.issue(linked);
        const request = normalizeIssue(input);
        const encoded = JSON.stringify(request);
        ensure(
          !this.sql
            .get`SELECT request_id FROM work_batches WHERE request_id = ${request.request_id}`,
          "REQUEST_REBIND",
          "Request identity belongs to batch intake",
        );
        const saved = this.sql
          .get`SELECT id, request_input FROM issues WHERE request_id = ${request.request_id}`;
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
          return this.queries.issue(IssueId.make(String(saved.id)));
        }
        const dependencies = new Set(
          this.queries.issuesByID(request.dependencies).map((issue) => issue.id),
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
  claim(id: IssueId, execution: ExecutionId) {
    return sqlEffect((at) =>
      runTransaction(this.db, () => {
        identifier(execution);
        const issue = this.queries.issue(id);
        if (issue.assignee === execution && issue.status === "in_progress") return;
        ensure(!issue.assignee, "CLAIM_LOST", "Another execution owns issue");
        const dependencies =
          issue.status === "open"
            ? new Map(
                this.queries
                  .issuesByID(issue.dependencies)
                  .map((dependency) => [dependency.id, dependency]),
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
        void this.sql
          .run`UPDATE issues SET assignee = ${execution}, status = 'in_progress' WHERE id = ${id}`;
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
        const issue = this.queries.issue(id);
        ensure(issue.assignee === execution, "CLAIM_LOST", "Another execution owns issue");
        if (issue.status === to) return;
        ensure(issue.status === from, "WORK_DRIFT", `Expected ${from}, found ${issue.status}`);
        void this.sql.run`UPDATE issues SET status = ${to} WHERE id = ${id}`;
        this.recordEvent(id, to, execution, at, reason);
      }),
    ).pipe(Effect.tap(() => committedScope({ finder: true, work_all: true })));
  }
}
