import { Clock, Effect, Queue } from "effect";
import {
  type FindingId,
  type FindingRevisionId,
  type IssueId,
  type RelativePath,
} from "@abracode/contracts/identities";
import {
  WorkDiscoveryQuery,
  type SessionQuery,
  type SessionRow,
  type WorkDiscovery,
} from "@abracode/contracts/visibility/discovery-contracts";
import { type BindingReadQuery } from "@abracode/contracts/web/bindings";
import type { ChangeScope } from "@abracode/contracts/web/changes";
import { decode } from "../decode.ts";
import { type CrewError } from "../domain.ts";
import { presentationHash } from "../presentation/identity.ts";
import { type Controller } from "../workflow/controller.ts";
import { type Queries, type ReadBundle } from "../workflow/queries.ts";
import { buildDetail, observeOverview } from "./detail.ts";
import { readBindings } from "./bindings.ts";
import { FleetCache } from "./fleet-cache.ts";
import { projectFinderWork, sessions } from "./projections.ts";
import { type DiffScope, type WorkDetail } from "./protocol.ts";
import { buildSnapshot } from "./snapshot.ts";

/** Read-only projection. Lifecycle actions remain exclusively in the controller tools. */
export class Visibility {
  private readonly c: Queries;
  private readonly fleetCache: FleetCache;

  constructor(controller: Pick<Controller, "queries">, finderRequests?: Queue.Queue<void>) {
    this.c = controller.queries;
    this.fleetCache = new FleetCache(finderRequests);
  }

  readonly requestFinderRefresh = Effect.suspend(() => this.fleetCache.requestFinderRefresh);

  invalidateFinder = (scope: ChangeScope) => this.fleetCache.invalidateFinder(scope);

  readonly refreshFinder = Effect.suspend(() =>
    this.fleetCache.refreshFinder(this.c, this.snapshot),
  );

  feedback = (issue: IssueId, page = 0, finding_id?: FindingId, revision?: FindingRevisionId) =>
    this.c.feedback(issue, page, finding_id, revision);

  sessionSearch = (query: typeof SessionQuery.Type) =>
    Effect.gen({ self: this }, function* () {
      const issues = new Map((yield* this.c.issues()).map((issue) => [issue.id, issue]));
      const needle = query.search?.trim().toLowerCase() ?? "";
      const rows: Array<typeof SessionRow.Type> = [];
      const executions = new Map((yield* this.c.executions()).map((e) => [e.issue_id, e]));
      for (const execution of executions.values()) {
        const issue = issues.get(execution.issue_id);
        if (
          !issue ||
          issue.repository_id !== execution.repository_id ||
          (query.repository_id && issue.repository_id !== query.repository_id)
        )
          continue;
        for (const { id, role } of sessions(execution)) {
          if (
            ![id, role, issue.id, issue.title, issue.repository_id].some((value) =>
              value.toLowerCase().includes(needle),
            )
          )
            continue;
          rows.push({
            availability: "unverified",
            session_id: id,
            role,
            issue_id: issue.id,
            title: issue.title,
            repository_id: issue.repository_id,
            association:
              execution[`${role}_session_id`] === id && execution.current_phase !== "completed"
                ? "current"
                : "historical",
          });
        }
      }
      rows.sort(
        (a, b) =>
          Number(b.session_id.toLowerCase() === needle) -
            Number(a.session_id.toLowerCase() === needle) ||
          a.issue_id.localeCompare(b.issue_id) ||
          a.session_id.localeCompare(b.session_id),
      );
      const offset = query.offset ?? 0;
      const end = offset + (query.limit ?? 30);
      const entries = yield* Effect.forEach(
        rows.slice(offset, end),
        (row) =>
          this.c
            .sessionAvailability(executions.get(row.issue_id)!, row.session_id)
            .pipe(Effect.map((availability) => ({ ...row, availability }))),
        { concurrency: 4 },
      );
      return { entries, total: rows.length, next_offset: end < rows.length ? end : undefined };
    });

  find = (input: WorkDiscovery = {}) =>
    Effect.gen({ self: this }, function* () {
      const query = yield* decode(WorkDiscoveryQuery, input, "Work discovery");
      const page = yield* this.c.observeFinder(query);
      const { fleet, fleetCurrent } = yield* this.fleetCache.observeForFinder(
        page.workRevision,
        page.recordsRevision,
      );
      const at = yield* Clock.currentTimeMillis;
      const entries = yield* Effect.forEach(
        page.entries,
        (entry) =>
          Effect.gen({ self: this }, function* () {
            const work = projectFinderWork(this.c.settings.supervisionMode, entry, at);
            return {
              ...work,
              supervision: yield* this.c.supervision(
                entry.execution,
                work.blocker_details,
                entry.issue.status === "closed",
              ),
            };
          }),
        { concurrency: 4 },
      );
      return {
        entries,
        ...(page.capacity && { capacity: page.capacity }),
        ...(page.project_capacity && { project_capacity: page.project_capacity }),
        total: page.total,
        offset: page.offset,
        limit: page.limit,
        next_offset: page.next_offset,
        observed_at: page.observedAt,
        work_revision: page.workRevision,
        fleet: fleet?.data,
        fleet_observation: {
          state: fleetCurrent
            ? ("current" as const)
            : fleet
              ? ("stale" as const)
              : ("unavailable" as const),
          work_revision: fleet?.workRevision,
          observed_at: fleet?.at,
        },
      };
    });

  binding = (input: typeof BindingReadQuery.Type) => readBindings(this.c, input);

  snapshot = (closedPage?: number, bundle?: ReadBundle, includeLeads = true) =>
    buildSnapshot(this.c, closedPage, bundle, includeLeads);

  report = (issueID: IssueId) =>
    this.c.report(issueID).pipe(Effect.map((content) => ({ content })));

  diff = (issueID: IssueId, scope: DiffScope, file?: RelativePath) =>
    this.c.diff(issueID, scope, file);

  document = (issueID: IssueId, path: RelativePath) =>
    Effect.gen({ self: this }, function* () {
      const e = yield* this.c.get(issueID);
      const content = yield* this.c.planDocument(e, path);
      return { path, content, generation: e.control_generation, hash: presentationHash(content) };
    });

  overview = (issueID: IssueId) =>
    observeOverview(this.c, issueID).pipe(Effect.map((observed) => observed.overview));

  detail: (issueID: IssueId) => Effect.Effect<WorkDetail, CrewError> = Effect.fn(
    "Visibility.detail",
  )({ self: this }, function* (issueID: IssueId) {
    return yield* buildDetail(this.c, issueID);
  });
}
