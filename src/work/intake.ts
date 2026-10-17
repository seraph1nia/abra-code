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
  ) {}

  create = Effect.fn("WorkIntake.create")(
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
      codingPolicy(
        project,
        request.workflow_policy ?? this.defaultWorkflow,
        request.quality_profile,
      );
      // Request identity and issue creation commit in the same database transaction.
      return yield* this.work.create(request);
    }.bind(this),
    domainEffect,
  );
}
