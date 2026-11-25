import { Effect, Schema } from "effect";
import { ArtifactId } from "@abracode/contracts/identities";
import { Count, NonEmpty } from "@abracode/contracts/primitives";
import {
  CaptureInputSchema,
  EvidenceQuerySchema,
  WorkerReferenceSchema,
} from "@abracode/contracts/web/worker-evidence";
import { WorkerReplySchema } from "@abracode/contracts/workflow/message-contracts";
import { domainEffect } from "../../effect.ts";
import type { Controller } from "../../workflow/controller.ts";
import { QuestionInputSchema, WaitInputSchema } from "../../workflow/obligation-contracts.ts";
import { ReportInputSchema } from "../../reporting/report-contracts.ts";
import { assertActiveWorker } from "../session-authority.ts";
import { toolOutputs } from "../tool-contracts.ts";
import { defineTool as define, type DefinedTool } from "../tool-definition.ts";

export function workerTools(c: Controller): DefinedTool[] {
  return [
    define({
      name: "worker_reply",
      description:
        "Acknowledge or answer a controller request, or submit keyed findings for Abra to route. Findings grant no authority.",
      worker: true,
      input: WorkerReplySchema,
      output: toolOutputs.worker_reply,
      run: (a, s) => c.workerReply(s, a),
    }),
    define({
      name: "research_report",
      output: toolOutputs.research_report,
      description:
        "Submit the assigned immutable research report for controller publication outside the worktree.",
      input: ReportInputSchema,
      worker: true,
      run: (a, s) => c.researchReport(s, a),
    }),
    define({
      name: "worker_question",
      output: toolOutputs.worker_question,
      description:
        "Open a durable keyed scope question. Answers never authorize plan, merge or delivery.",
      input: QuestionInputSchema,
      worker: true,
      run: (a, s) => c.workerQuestion(s, a),
    }),
    define({
      name: "worker_progress",
      description:
        "Report progress, retain chosen evidence, or read an exact retained item from the current assignment.",
      output: toolOutputs.worker_progress,
      input: Schema.Union([
        Schema.Struct({
          generation: Count,
          summary: NonEmpty.check(Schema.isMaxLength(8192)),
          capture: Schema.optionalKey(CaptureInputSchema),
          references: Schema.optionalKey(
            Schema.Array(WorkerReferenceSchema).check(Schema.isMaxLength(8)),
          ),
        }),
        Schema.Struct({ generation: Count, read_evidence: EvidenceQuerySchema }),
      ]),
      worker: true,
      run: (input, session) => {
        if ("summary" in input)
          return c.workerProgress(
            session,
            input.generation,
            input.summary,
            input.capture,
            input.references,
          );
        return Effect.gen(function* () {
          yield* assertActiveWorker(c, session, {
            generation: input.generation,
            issueId: input.read_evidence.issue_id,
            code: "WORKER_ASSIGNMENT",
            message: "An active assignment on this issue and generation is required",
          });
          return yield* c.queries.evidence(input.read_evidence);
        });
      },
    }),
    define({
      name: "worker_wait",
      output: toolOutputs.worker_wait,
      description:
        "Declare a bounded dependency, decision or controller-owned command wait with its clearing evidence.",
      input: WaitInputSchema,
      worker: true,
      run: (a, s) => c.workerWait(s, a),
    }),
    define({
      name: "spec",
      output: toolOutputs.spec,
      description:
        "Read the assigned OpenSpec change status or instructions. Does not modify workflow state.",
      input: Schema.Struct({
        action: Schema.Literals(["status", "instructions", "apply"]),
        artifact: Schema.optional(ArtifactId),
      }).check(
        Schema.makeFilter(
          (a) => a.action !== "instructions" || !!a.artifact || "Instructions require an artifact",
        ),
      ),
      worker: true,
      run: (a, s) =>
        domainEffect(
          Effect.gen(function* () {
            const { execution: e } = yield* assertActiveWorker(c, s);
            return yield* a.action === "status"
              ? c.queries.specStatus(e)
              : a.action === "apply"
                ? c.queries.specApply(e)
                : c.queries.specInstructions(e, a.artifact!);
          }),
        ),
    }),
  ];
}
