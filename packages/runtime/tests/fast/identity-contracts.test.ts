import { test, expectTypeOf } from "vite-plus/test";
import assert from "node:assert/strict";
import { Schema } from "effect";
import {
  IssueId,
  RepositoryId,
  ExecutionId,
  Commit,
  Fingerprint,
  SessionId,
} from "../../src/identities.ts";
import { type Execution, type SavedExecution } from "../../src/domain.ts";
import { type Runtime, type QuestionAnswer } from "../../src/opencode/runtime.ts";
import { WaitInputSchema } from "../../src/workflow/obligation-contracts.ts";
import { Session } from "@opencode/schema/session";

test("domain identities remain distinct through controller and adapter interfaces", () => {
  expectTypeOf<string>().not.toExtend<IssueId>();
  expectTypeOf<IssueId>().not.toExtend<RepositoryId>();
  expectTypeOf<ExecutionId>().not.toExtend<IssueId>();
  expectTypeOf<Commit>().not.toExtend<Fingerprint>();
  expectTypeOf<SessionId>().toEqualTypeOf<Session.ID>();
  expectTypeOf<Parameters<Runtime["prompt"]>[0]>().toEqualTypeOf<SessionId>();
  type Delivered = Extract<SavedExecution, { current_phase: "awaiting_merge" }>;
  expectTypeOf<Delivered["delivered_commit"]>().toEqualTypeOf<Commit>();
  expectTypeOf<Execution["effective_policy"]>().not.toBeNullable();
  expectTypeOf<Execution["control_generation"]>().toEqualTypeOf<number>();
  expectTypeOf<Extract<QuestionAnswer, { status: "answered" }>["answer"]>().toEqualTypeOf<string>();
});

test("schema decoding validates identities without changing persisted strings", () => {
  const schema = Schema.Struct({ issue: IssueId, repository: RepositoryId, commit: Commit });
  const raw = { issue: "abra-1", repository: "api", commit: "a".repeat(40) };
  const value = Schema.decodeSync(schema)(raw);
  assert.deepEqual(JSON.parse(JSON.stringify(value)), raw);
  assert.throws(() => Schema.decodeSync(schema)({ ...raw, issue: "../escape" }));
  assert.throws(() => Schema.decodeSync(schema)({ ...raw, commit: "not-a-commit" }));
});

test("wait kind determines its reference type", () => {
  type Wait = typeof WaitInputSchema.Type;
  expectTypeOf<Extract<Wait, { kind: "dependency" }>["reference"]>().toEqualTypeOf<IssueId>();
  expectTypeOf<Extract<Wait, { kind: "user" }>["reference"]>().not.toEqualTypeOf<IssueId>();
});
