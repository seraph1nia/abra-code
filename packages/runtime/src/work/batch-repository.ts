import { type DatabaseSync } from "node:sqlite";
import { IssueId, type RequestId } from "@abracode/contracts/identities";
import { Effect, Graph, Schema } from "effect";
import { decodeSync } from "../decode.ts";
import { ensure } from "../domain.ts";
import { committedScope } from "../invalidations.ts";
import {
  BatchInputSchema,
  BatchResultSchema,
  normalizeBatch,
  prepareBatch,
  type BatchInput,
} from "./batch.ts";
import type { IssueQueries } from "./issue-queries.ts";
import { type IssueRepository } from "./issue-repository.ts";
import { type Issue } from "./model.ts";
import { readDataVersion, runTransaction, sqlEffect } from "./sqlite.ts";

const SavedBatchInputSchema = Schema.fromJsonString(BatchInputSchema);

export class BatchRepository {
  constructor(
    private readonly db: DatabaseSync,
    private readonly issues: IssueRepository,
    private readonly queries: IssueQueries,
    private readonly nextId: (request: RequestId) => IssueId,
    private validatedVersion?: number,
  ) {}

  validateHistoricalEdges(): void {
    const edges = this.db
      .prepare(`
        SELECT d.issue_id, d.dependency_id, child.id AS child, parent.id AS parent
        FROM dependencies d LEFT JOIN issues child ON child.id = d.issue_id
        LEFT JOIN issues parent ON parent.id = d.dependency_id
      `)
      .all();

    const dag = Graph.directed<string, undefined>((mutable) => {
      const nodeById = new Map<string, Graph.NodeIndex>();
      const nodeOf = (id: string): Graph.NodeIndex => {
        const existing = nodeById.get(id);
        if (existing !== undefined) return existing;
        const index = Graph.addNode(mutable, id);
        nodeById.set(id, index);
        return index;
      };
      for (const edge of edges) {
        ensure(
          edge.child && edge.parent,
          "ISSUE_MISSING",
          `Missing endpoint of dependency ${String(edge.issue_id)} -> ${String(edge.dependency_id)}`,
        );
        Graph.addEdge(mutable, nodeOf(String(edge.parent)), nodeOf(String(edge.child)), undefined);
      }
      return undefined;
    });

    ensure(Graph.isAcyclic(dag), "BATCH_CYCLE", "Work dependencies contain a cycle");
  }

  createBatch(
    input: BatchInput,
  ): Effect.Effect<typeof BatchResultSchema.Type, import("../domain.ts").CrewError> {
    return sqlEffect((at) => {
      let validated: number | undefined;
      const result = runTransaction(this.db, () => {
        const batch = normalizeBatch(input);
        const encoded = JSON.stringify(batch);
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
            decodeSync(SavedBatchInputSchema, String(saved.request_input), "Saved batch request"),
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
          const byId = new Map(
            this.queries
              .issuesByID(rows.map((row) => IssueId.make(String(row.issue_id))))
              .map((issue) => [issue.id, issue]),
          );
          return decodeSync(
            BatchResultSchema,
            {
              request_id: batch.request_id,
              tasks: rows.map((row) => ({
                client_key: row.client_key,
                issue: byId.get(IssueId.make(String(row.issue_id))),
              })),
            },
            "Batch receipt",
          );
        }

        const { requests, existing } = prepareBatch(batch, this.nextId);
        const entries: Array<{ request: (typeof requests)[number]; issue: Issue }> = requests.map(
          (request) => ({
            request,
            issue: {
              ...request.input,
              id: request.id,
              workflow_policy: request.input.workflow_policy ?? "full-openspec",
              status: "open",
            },
          }),
        );
        ensure(
          !this.db
            .prepare(
              "SELECT request_id FROM issues WHERE request_id IN (SELECT value FROM json_each(?)) LIMIT 1",
            )
            .get(JSON.stringify(requests.map(({ input: req }) => req.request_id))),
          "REQUEST_REBIND",
          "Batch item identity is already owned by another intake request",
        );
        validated = readDataVersion(this.db);
        if (validated !== this.validatedVersion) {
          this.validateHistoricalEdges();
        }
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
        for (const { issue, request } of entries) {
          this.issues.insert(issue, JSON.stringify(request.input));
        }
        const link = this.db.prepare(
          "INSERT INTO dependencies (issue_id, dependency_id) VALUES (?, ?)",
        );
        const item = this.db.prepare(
          "INSERT INTO batch_items (batch_request_id, client_key, issue_id) VALUES (?, ?, ?)",
        );
        for (const { issue, request } of entries) {
          for (const dependency of issue.dependencies) link.run(issue.id, dependency);
          item.run(batch.request_id, request.client_key, issue.id);
          this.issues.recordEvent(
            issue.id,
            "created",
            "supervisor",
            at,
            `Batch ${batch.request_id}, task ${request.client_key}`,
          );
        }
        return {
          request_id: batch.request_id,
          tasks: entries.map(({ issue, request }) => ({
            client_key: request.client_key,
            issue,
          })),
        };
      });
      if (validated !== undefined) this.validatedVersion = validated;
      return result;
    }).pipe(Effect.tap(() => committedScope({ finder: true, work_all: true })));
  }
}
