import { validateDispatch } from "../config/dispatch.ts";
import { type Config } from "../domain.ts";
import { normalizeBatch, batchItemRequest, type BatchInput } from "./batch.ts";
import { completeScope } from "./scope.ts";
import { codingPolicy } from "../config/policy.ts";
import { RequestId, SessionId } from "../identities.ts";

import { Effect } from "effect";
import { createHash } from "node:crypto";
import { domainEffect } from "../effect.ts";
import { CrewError } from "../domain.ts";
import { type Records } from "../storage/store.ts";
import { type WorkGraph } from "./graph.ts";
import { normalizeIssue, type WorkInput } from "./model.ts";
export type { WorkInput } from "./model.ts";
export class WorkIntake {
  constructor(
    private work: WorkGraph,
    private records: Records,
    private defaultWorkflow: import("../domain.ts").Policy = "full-openspec",
    private config?: Config,
  ) {}

  private prepare = Effect.fn("WorkIntake.prepare")(
    function* (this: WorkIntake, input: WorkInput, supervisor: SessionId) {
      const repository = input.repository_id;
      const project = yield* this.records.project(repository);
      if (!project)
        return yield* new CrewError(
          "PROJECT_MISSING",
          "Register the repository before creating work",
        );
      const request = normalizeIssue({
        ...input,
        workflow_policy: input.workflow_policy ?? this.defaultWorkflow,
        priority: input.priority ?? 2,
        dependencies: input.dependencies ?? [],
        request_id: input.request_id ?? RequestId.make("implicit"),
      });
      if (input.request_id === undefined) {
        const { request_id: _id, ...fields } = request;
        request.request_id = RequestId.make(
          createHash("sha256")
            .update(JSON.stringify([supervisor, fields]))
            .digest("hex"),
        );
      }
      validateDispatch(this.config ?? {}, request.dispatch);
      codingPolicy(
        project,
        request.workflow_policy ?? this.defaultWorkflow,
        request.quality_profile,
      );
      return request;
    }.bind(this),
    domainEffect,
  );
  create = Effect.fn("WorkIntake.create")(
    function* (this: WorkIntake, input: WorkInput, supervisor: SessionId) {
      return yield* this.work.create(yield* this.prepare(input, supervisor));
    }.bind(this),
    domainEffect,
  );
  createBatch = Effect.fn("WorkIntake.createBatch")(
    function* (this: WorkIntake, input: BatchInput, supervisor: SessionId) {
      const batch = normalizeBatch({
        ...input,
        tasks: input.tasks.map((task) => ({
          ...task,
          workflow_policy: task.workflow_policy ?? this.defaultWorkflow,
        })),
      });
      for (const task of batch.tasks) {
        const { client_key, dependencies, ...fields } = task;
        const request = yield* this.prepare(
          {
            ...fields,
            request_id: batchItemRequest(batch.request_id, client_key),
            dependencies: dependencies.flatMap((d) => (d.type === "existing" ? [d.issue_id] : [])),
          },
          supervisor,
        );
        if (request.workflow_policy !== "full-openspec" && !completeScope(request.scope))
          return yield* new CrewError(
            "SCOPE_REQUIRED",
            `Batch task ${client_key} requires a complete goal, acceptance and constraints contract`,
          );
      }
      return yield* this.work.createBatch(batch);
    }.bind(this),
    domainEffect,
  );
}
