import { Schema } from "effect";
import { join } from "node:path";
import {
  WorkerContextSchema,
  type WorkerContext,
} from "../../src/workflow/worker-context-contracts.ts";

/** Materialize the historical shape for recovery tests starting from a fresh fixture. */
export const legacyContext = (context: WorkerContext, assets: string) =>
  Schema.decodeSync(WorkerContextSchema)({
    ...context,
    schema_version: 1,
    guidance: { ...context.guidance, path: join(assets, `${context.role}.md`) },
  });
