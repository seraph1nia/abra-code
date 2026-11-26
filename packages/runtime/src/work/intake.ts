import { sha256 } from "../digest.ts";
import { tryDomainValue } from "../effect.ts";
import { WorkGraphError } from "../errors.ts";
import { PersonalThoughts } from "./thoughts.ts";
import { validateDispatch } from "../config/dispatch.ts";
import { type Config } from "../domain.ts";
import { batchItemRequest, type BatchInput } from "./batch.ts";
import { completeScope } from "./scope.ts";
import { codingPolicy } from "../config/policy.ts";
import { RequestId, SessionId } from "@abracode/contracts/identities";

import { Effect } from "effect";

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

  validateProject = Effect.fn("WorkIntake.validateProject")(
    { self: this },
    function* (request: WorkInput) {
      const project = yield* this.records.project(request.repository_id);
      if (!project)
        return yield* new WorkGraphError(
          "PROJECT_MISSING",
          "Register the repository before creating work",
        );
      yield* tryDomainValue(validateDispatch, this.config ?? {}, request.dispatch);
      yield* tryDomainValue(
        codingPolicy,
        project,
        request.workflow_policy ?? this.defaultWorkflow,
        request.quality_profile,
      );
    },
  );
  private prepare = Effect.fn("WorkIntake.prepare")(
    { self: this },
    function* (input: WorkInput, supervisor: SessionId) {
      const request = yield* tryDomainValue(normalizeIssue, {
        ...input,
        workflow_policy: input.workflow_policy ?? this.defaultWorkflow,
        priority: input.priority ?? 2,
        dependencies: input.dependencies ?? [],
        request_id: input.request_id ?? RequestId.make("implicit"),
      });
      if (input.request_id === undefined) {
        const { request_id: _id, ...fields } = request;
        request.request_id = RequestId.make(sha256(JSON.stringify([supervisor, fields])));
      }
      yield* this.validateProject(request);
      return request;
    },
  );
  prepareIntake = Effect.fn("WorkIntake.prepareIntake")(
    { self: this },
    function* (input: WorkInput, supervisor: SessionId) {
      const request = yield* this.prepare(input, supervisor);
      if (request.thought_source && !(yield* this.work.hasRequest(request.request_id))) {
        const { reference, excerpt } = request.thought_source;
        const memo = yield* new PersonalThoughts(this.config ?? {}, this.work).get(
          reference,
          "http",
        );
        if (!memo.content.includes(excerpt))
          return yield* new WorkGraphError(
            "MEMOS_EXCERPT",
            "Reselect the exact wording to accept for this issue.",
          );
      }
      return request;
    },
  );
  createBatch = Effect.fn("WorkIntake.createBatch")(
    { self: this },
    function* (input: BatchInput, supervisor: SessionId) {
      const batch = {
        ...input,
        tasks: input.tasks.map((task) => ({
          ...task,
          workflow_policy: task.workflow_policy ?? this.defaultWorkflow,
        })),
      };
      for (const task of batch.tasks) {
        const { client_key, dependencies, ...fields } = task;
        const request = yield* this.prepare(
          {
            ...fields,
            request_id: batchItemRequest(batch.request_id, client_key),
            dependencies: (dependencies ?? []).flatMap((d) =>
              d.type === "existing" ? [d.issue_id] : [],
            ),
          },
          supervisor,
        );
        if (request.workflow_policy !== "full-openspec" && !completeScope(request.scope))
          return yield* new WorkGraphError(
            "SCOPE_REQUIRED",
            `Batch task ${client_key} requires a complete goal, acceptance and constraints contract`,
          );
      }
      return yield* this.work.createBatch(batch);
    },
  );
}
