import { Schema } from "effect";
import { IssueId, SessionId } from "../identities.ts";

/** Resource hints after a commit. They never confer mutation authority. */
export const ChangeScopeSchema = Schema.Struct({
  all: Schema.optional(Schema.Boolean),
  transcript: Schema.optional(Schema.Boolean),
  attention: Schema.optional(Schema.Boolean),
  admissions: Schema.optional(Schema.Boolean),
  presentations: Schema.optional(Schema.Boolean),
  projects: Schema.optional(Schema.Boolean),
  finder: Schema.optional(Schema.Boolean),
  fleet: Schema.optional(Schema.Boolean),
  work_all: Schema.optional(Schema.Boolean),
  sessions: Schema.optional(Schema.Array(SessionId).check(Schema.isMaxLength(256))),
  issues: Schema.optional(Schema.Array(IssueId).check(Schema.isMaxLength(256))),
});
export type ChangeScope = typeof ChangeScopeSchema.Type;
export function mergeChanges(a: ChangeScope, b: ChangeScope): ChangeScope {
  if (a.all || b.all)
    return a.work_all ||
      b.work_all ||
      a.issues?.length ||
      b.issues?.length ||
      a.sessions?.length ||
      b.sessions?.length
      ? { all: true, work_all: true }
      : { all: true };
  const sessions = [...new Set([...(a.sessions ?? []), ...(b.sessions ?? [])])];
  const issues = [...new Set([...(a.issues ?? []), ...(b.issues ?? [])])];
  return {
    transcript: a.transcript || b.transcript || undefined,
    attention: a.attention || b.attention || undefined,
    admissions: a.admissions || b.admissions || undefined,
    presentations: a.presentations || b.presentations || undefined,
    projects: a.projects || b.projects || undefined,
    finder: a.finder || b.finder || undefined,
    ...(a.fleet || b.fleet ? { fleet: true } : {}),
    ...(sessions.length && sessions.length <= 256 ? { sessions } : {}),
    work_all: sessions.length > 256 || a.work_all || b.work_all || issues.length > 256 || undefined,
    issues: issues.length > 256 ? undefined : issues,
  };
}
export const ObservationSchema = Schema.Struct({
  epoch: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  sequence: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  baseline: Schema.Boolean,
  changes: ChangeScopeSchema,
});
export type Observation = typeof ObservationSchema.Type;

/** Shared reactivity-key vocabulary: transcript/attention changes touch no work query. */
export function workInvalidationKeys(scope: ChangeScope): string[] {
  return [
    ...(scope.all || scope.work_all ? ["work-observed"] : []),
    ...(scope.all || scope.finder || scope.fleet || scope.work_all || scope.projects
      ? ["work-finder"]
      : []),
    ...(scope.sessions ?? []).map((session) => `session:${session}`),
    ...(scope.issues ?? []).map((issue) => `work:${issue}`),
  ];
}
