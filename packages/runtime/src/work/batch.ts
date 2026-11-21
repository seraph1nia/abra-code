import { Schema } from "effect";
import { createHash } from "node:crypto";
import { Identifier, IssueId, RequestId } from "../identities.ts";
import { ensure } from "../domain.ts";
import { decodeSync } from "../decode.ts";
import { WorkInputSchema, IssueSchema, normalizeIssue } from "./model.ts";

const {
  request_id: _request,
  dependencies: _dependencies,
  thought_source: _singleThought,
  ...workFields
} = WorkInputSchema.fields;
import { BatchDependencySchema } from "./batch-dependency.ts";
export { BatchDependencySchema } from "./batch-dependency.ts";
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
export function prepareBatch(batch: NormalizedBatch, allocate: (request: RequestId) => IssueId) {
  const identities = new Map(
    batch.tasks.map(({ client_key }) => {
      const request_id = batchItemRequest(batch.request_id, client_key);
      return [client_key, { id: allocate(request_id), request_id }] as const;
    }),
  );
  const existing = new Set<IssueId>();
  const requests = batch.tasks.map((task) => {
    const { client_key, dependencies, ...fields } = task;
    return {
      client_key,
      id: identities.get(client_key)!.id,
      input: normalizeIssue({
        ...fields,
        request_id: identities.get(client_key)!.request_id,
        dependencies: dependencies.map((dependency) => {
          if (dependency.type === "existing") existing.add(dependency.issue_id);
          const id =
            dependency.type === "existing"
              ? dependency.issue_id
              : identities.get(dependency.client_key)?.id;
          ensure(id, "BATCH_DEPENDENCY", "Local dependency identity is missing");
          return id;
        }),
      }),
    };
  });
  return { requests, existing: [...existing] };
}
