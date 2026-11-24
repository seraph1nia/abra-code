import { randomUUID } from "node:crypto";
import { type DatabaseSync } from "node:sqlite";
import {
  IssueId,
  type AbsolutePath,
  type ExecutionId,
  type RepositoryId,
  type RequestId,
  type Timestamp,
} from "@abracode/contracts/identities";
import { type WorkDiscovery } from "@abracode/contracts/visibility/discovery-contracts";
import {
  type ThoughtWorkPage,
  type ThoughtWorkQuery,
} from "@abracode/contracts/visibility/thoughts";
import { Effect } from "effect";
import { type Config, type CrewError } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { type BatchInput, type BatchResultSchema } from "./batch.ts";
import { BatchRepository } from "./batch-repository.ts";
import { InboxIndex, type SourceLink } from "./inbox-index.ts";
import {
  IssueRepository,
  type IssuePage,
  type TaskEvidence,
  type TaskIssue,
  type WorkEvent,
} from "./issue-repository.ts";
import { type Issue, type NewIssue, type ReadyExplanation } from "./model.ts";
import { openWorkDatabase, type Row } from "./sqlite.ts";
import { ThoughtReceipts } from "./thought-receipts.ts";

export type { NewIssue, ReadyExplanation } from "./model.ts";
export {
  WorkEventSchema,
  type IssuePage,
  type TaskEvidence,
  type TaskIssue,
  type WorkEvent,
} from "./issue-repository.ts";

/** Open the configured SQLite work graph. */
export function openWorkGraph(config: Pick<Config, "work_database">) {
  return domainEffect(SqliteWorkGraph.open(config.work_database));
}

/** All ownership checks and writes are atomic, including across independent processes. */
export interface WorkGraph {
  readonly inbox: InboxIndex;
  hasRequest(id: RequestId): Effect.Effect<boolean, CrewError>;
  thoughtWork(
    query: typeof ThoughtWorkQuery.Type,
  ): Effect.Effect<typeof ThoughtWorkPage.Type, CrewError>;
  reserveThought(
    key: string,
    digest: string,
  ): Effect.Effect<{ id: string; fresh: boolean }, CrewError>;
  create(input: NewIssue, source?: SourceLink): Effect.Effect<Issue, CrewError>;
  createBatch(input: BatchInput): Effect.Effect<typeof BatchResultSchema.Type, CrewError>;
  show(id: IssueId): Effect.Effect<Issue, CrewError>;
  repositoryIssueSummaries(
    repository: RepositoryId,
  ): Effect.Effect<Array<Pick<Issue, "id" | "title" | "status">>, CrewError>;
  searchOwners(
    after: string,
    repository?: RepositoryId,
    issue?: IssueId,
  ): Effect.Effect<Array<Pick<Issue, "id" | "repository_id" | "title">>, CrewError>;
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

/** A scoped connection. Transactions contain only synchronous SQL and domain checks. */
export class SqliteWorkGraph implements WorkGraph {
  readonly inbox: InboxIndex;
  private readonly db: DatabaseSync;
  private readonly issuesRepo: IssueRepository;
  private readonly batchesRepo: BatchRepository;
  private readonly thoughtsRepo: ThoughtReceipts;

  readonly list: Effect.Effect<Issue[], CrewError>;
  readonly revision: Effect.Effect<string, CrewError>;
  readonly closureTimes: Effect.Effect<Record<string, Timestamp>, CrewError>;
  readonly explain: Effect.Effect<ReadyExplanation, CrewError>;
  readonly ready: Effect.Effect<Issue[], CrewError>;

  private constructor(
    db: DatabaseSync,
    nextId: (request: RequestId) => IssueId,
    validatedVersion?: number,
  ) {
    this.db = db;
    this.inbox = new InboxIndex(db);
    this.issuesRepo = new IssueRepository(db, this.inbox, nextId, {
      hydrate: (rows, links) => this.hydrate(rows, links),
      taskRows: (entries) => this.taskRows(entries),
    });
    this.batchesRepo = new BatchRepository(db, this.issuesRepo, nextId, validatedVersion, () =>
      this.validateHistoricalEdges(),
    );
    this.thoughtsRepo = new ThoughtReceipts(db);

    this.list = this.issuesRepo.list();
    this.revision = this.issuesRepo.revision();
    this.closureTimes = this.issuesRepo.closureTimes();
    this.explain = this.issuesRepo.explain();
    this.ready = this.explain.pipe(Effect.map((result) => result.ready));
  }

  private hydrate(rows: Row[], links: Row[]): Issue[] {
    return this.issuesRepo.hydrate(rows, links);
  }

  private taskRows(entries: readonly Issue[]): TaskEvidence[] {
    return this.issuesRepo.taskRows(entries);
  }

  private validateHistoricalEdges(): void {
    this.batchesRepo.validateHistoricalEdges();
  }

  static open(
    path: AbsolutePath | ":memory:",
    nextId: (request: RequestId) => IssueId = () => IssueId.make(`abra-${randomUUID()}`),
  ) {
    return openWorkDatabase(path).pipe(
      Effect.map(({ db, validatedVersion }) => new SqliteWorkGraph(db, nextId, validatedVersion)),
    );
  }

  hasRequest(id: RequestId) {
    return this.issuesRepo.hasRequest(id);
  }

  thoughtWork(query: typeof ThoughtWorkQuery.Type) {
    return this.thoughtsRepo.thoughtWork(query);
  }

  reserveThought(key: string, digest: string) {
    return this.thoughtsRepo.reserveThought(key, digest);
  }

  create(input: NewIssue, source?: SourceLink) {
    return this.issuesRepo.create(input, source);
  }

  createBatch(input: BatchInput) {
    return this.batchesRepo.createBatch(input);
  }

  show(id: IssueId) {
    return this.issuesRepo.show(id);
  }

  repositoryIssueSummaries(repository: RepositoryId) {
    return this.issuesRepo.repositoryIssueSummaries(repository);
  }

  searchOwners(after: string, repository?: RepositoryId, issue?: IssueId) {
    return this.issuesRepo.searchOwners(after, repository, issue);
  }

  task(id: IssueId) {
    return this.issuesRepo.task(id);
  }

  taskEvidence(entries: readonly Issue[]) {
    return this.issuesRepo.taskEvidence(entries);
  }

  find(query?: WorkDiscovery) {
    return this.issuesRepo.find(query);
  }

  explainSelected(ids: readonly IssueId[]) {
    return this.issuesRepo.explainSelected(ids);
  }

  claim(id: IssueId, execution: ExecutionId) {
    return this.issuesRepo.claim(id, execution);
  }

  block(id: IssueId, execution: ExecutionId, reason: string) {
    return this.issuesRepo.transition(id, execution, "in_progress", "blocked", reason);
  }

  resume(id: IssueId, execution: ExecutionId) {
    return this.issuesRepo.transition(id, execution, "blocked", "in_progress");
  }

  close(id: IssueId, execution: ExecutionId) {
    return this.issuesRepo.transition(
      id,
      execution,
      "in_progress",
      "closed",
      "AbraCode verified delivery and retired owned worktree",
    );
  }

  history(id: IssueId) {
    return this.issuesRepo.history(id);
  }

  completions(start: Timestamp, end: Timestamp) {
    return this.issuesRepo.completions(start, end);
  }
}
