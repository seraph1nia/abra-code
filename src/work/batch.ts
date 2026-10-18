import { Schema } from "effect";
import { createHash } from "node:crypto";
import { Identifier, IssueId, RequestId } from "../identities.ts";
import { ensure } from "../domain.ts";
import { decodeSync } from "../decode.ts";
import { WorkInputSchema, IssueSchema, normalizeIssue } from "./model.ts";

const { request_id: _request, dependencies: _dependencies, ...workFields } = WorkInputSchema.fields;
export const BatchDependencySchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal("local"), client_key: Identifier }),
  Schema.Struct({ type: Schema.Literal("existing"), issue_id: IssueId }),
]);
export const BatchTaskSchema = Schema.Struct({
  ...workFields,
  client_key: Identifier,
  dependencies: Schema.optional(Schema.Array(BatchDependencySchema).check(Schema.isMaxLength(256))),
});
export const BatchInputSchema = Schema.Struct({
  request_id: RequestId,
  tasks: Schema.Array(BatchTaskSchema).check(Schema.isMinLength(1), Schema.isMaxLength(32)),
}).check(
  Schema.makeFilter(
    (batch) =>
      new Set(batch.tasks.map((task) => task.client_key)).size === batch.tasks.length ||
      "Batch task keys must be unique",
  ),
);
export type BatchInput = typeof BatchInputSchema.Type;
export const BatchItemResultSchema = Schema.Struct({ client_key: Identifier, issue: IssueSchema });
export const BatchResultSchema = Schema.Struct({
  request_id: RequestId,
  tasks: Schema.Array(BatchItemResultSchema).check(Schema.isMinLength(1), Schema.isMaxLength(32)),
});
export type BatchResult = typeof BatchResultSchema.Type;

export const batchItemRequest = (batch: RequestId, key: string) =>
  RequestId.make(
    `batch-${createHash("sha256")
      .update(JSON.stringify([batch, key]))
      .digest("hex")}`,
  );

/** Canonical keyed definitions, independent of ordering or future issue IDs. */
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export function normalizeBatch(raw: unknown) {
  const batch = decodeSync(BatchInputSchema, raw, "Batch work request");
  const tasks = batch.tasks
    .map((task) => {
      const { client_key, dependencies, ...input } = task;
      const {
        request_id: _id,
        dependencies: _deps,
        ...fields
      } = normalizeIssue({
        ...input,
        priority: input.priority ?? 2,
        dependencies: [],
        request_id: batchItemRequest(batch.request_id, client_key),
      });
      const unique = new Map(
        (dependencies ?? []).map((dependency) => [JSON.stringify(dependency), dependency]),
      );
      return {
        client_key,
        ...fields,
        dependencies: [...unique.values()].sort((a, b) =>
          compare(JSON.stringify(a), JSON.stringify(b)),
        ),
      };
    })
    .sort((a, b) => compare(a.client_key, b.client_key));
  const byKey = new Map(tasks.map((task) => [task.client_key, task]));
  const visited = new Set<string>(),
    visiting = new Set<string>();
  const visit = (key: string) => {
    ensure(!visiting.has(key), "BATCH_CYCLE", "Batch dependencies contain a cycle");
    if (visited.has(key)) return;
    const task = byKey.get(key);
    ensure(task, "BATCH_DEPENDENCY", `Unknown local dependency ${key}`);
    visiting.add(key);
    for (const dependency of task.dependencies)
      if (dependency.type === "local") visit(dependency.client_key);
    visiting.delete(key);
    visited.add(key);
  };
  for (const task of tasks) visit(task.client_key);
  return { request_id: batch.request_id, tasks };
}
export type NormalizedBatch = ReturnType<typeof normalizeBatch>;

/** Resolve local references only after every new issue identity is allocated. */
export function batchRequests(batch: NormalizedBatch, ids: ReadonlyMap<string, IssueId>) {
  return batch.tasks.map((task) => {
    const { client_key, dependencies, ...fields } = task;
    return {
      client_key,
      id: ids.get(client_key)!,
      input: normalizeIssue({
        ...fields,
        request_id: batchItemRequest(batch.request_id, client_key),
        dependencies: dependencies.map((dependency) => {
          const id =
            dependency.type === "existing" ? dependency.issue_id : ids.get(dependency.client_key);
          ensure(id, "BATCH_DEPENDENCY", "Local dependency identity is missing");
          return id;
        }),
      }),
    };
  });
}
