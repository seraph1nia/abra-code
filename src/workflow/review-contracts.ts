import { Schema } from "effect";
import { NonEmpty } from "../contracts.ts";
import { ScopeDispositionSchema } from "./correction-contracts.ts";

const text = NonEmpty.check(Schema.isPattern(/\S/), Schema.isMaxLength(16384));
const assessment = Schema.Struct({
  status: Schema.Literals(["passed", "failed", "not_verified", "not_applicable"]),
  evidence: text,
});

export const SpecVerificationSchema = Schema.Struct({
  completeness: assessment,
  correctness: assessment,
  coherence: assessment,
  conflicts: Schema.Array(
    Schema.Struct({
      sources: Schema.Array(text).check(Schema.isMinLength(2), Schema.isMaxLength(16)),
      summary: text,
    }),
  ).check(Schema.isMaxLength(64)),
});
export type SpecVerification = typeof SpecVerificationSchema.Type;

export const ReviewReportSchema = Schema.Struct({
  passed: Schema.Boolean,
  findings: NonEmpty,
  scope_status: Schema.optional(ScopeDispositionSchema),
  spec_verification: Schema.optional(SpecVerificationSchema),
});

export function specVerificationPassed(report: SpecVerification | undefined) {
  return (
    !!report &&
    report.conflicts.length === 0 &&
    [report.completeness, report.correctness, report.coherence].every(
      (a) => a.status === "passed" || a.status === "not_applicable",
    )
  );
}

/** Conflicting authorities require a decision even when the reviewer labels the fix in scope. */
export function reviewScope(report: typeof ReviewReportSchema.Type) {
  if (report.spec_verification?.conflicts.length && report.scope_status !== "scope_change")
    return "uncertain";
  return report.scope_status;
}
