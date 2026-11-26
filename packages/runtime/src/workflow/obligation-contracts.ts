import { Schema } from "effect";
import { Count } from "@abracode/contracts/primitives";
import { FormId, SessionId } from "@abracode/contracts/identities";
import { FinishingTargetSchema, FinishingAnswerSchema } from "./finishing/contracts.ts";
import { DecisionSummarySchema } from "@abracode/contracts/workflow/obligation-summary";
import { DeclaredWaitSchema } from "@abracode/contracts/workflow/obligation-summary";
export {
  QuestionInputSchema,
  WaitInputSchema,
  DeclaredWaitSchema,
  ProgressSchema,
} from "@abracode/contracts/workflow/obligation-summary";
export const DecisionSchema = Schema.Struct({
  ...DecisionSummarySchema.fields,
  finishing_target: Schema.optional(FinishingTargetSchema),
  finishing_answer: Schema.optional(FinishingAnswerSchema),
  finishing_history: Schema.optional(
    Schema.Array(
      Schema.Struct({
        form_id: FormId,
        form_session: SessionId,
        target: FinishingTargetSchema,
        answer: Schema.optional(FinishingAnswerSchema),
        resolved_at: Count,
      }),
    ).check(Schema.isMaxLength(64)),
  ),
});
export type Decision = typeof DecisionSchema.Type;
export type DeclaredWait = typeof DeclaredWaitSchema.Type;
