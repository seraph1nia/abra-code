import { Schema } from "effect";
import { Count } from "../contracts.ts";
import { FormId, SessionId } from "../identities.ts";
import { FinishingTargetSchema, FinishingAnswerSchema } from "./finishing-contracts.ts";
import { DecisionSummarySchema } from "./obligation-summary.ts";
import { DeclaredWaitSchema } from "./obligation-summary.ts";
export {
  QuestionInputSchema,
  WaitInputSchema,
  DeclaredWaitSchema,
  ProgressSchema,
} from "./obligation-summary.ts";
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
