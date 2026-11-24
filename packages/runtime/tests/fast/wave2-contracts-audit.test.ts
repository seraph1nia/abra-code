import assert from "node:assert/strict";
import { Context, Effect, Exit, Schema } from "effect";
import { test } from "vite-plus/test";
import { ApprovalSchema } from "@abracode/contracts/primitives";
import {
  AbsolutePath,
  BranchName,
  ChangeName,
  Commit,
  ExecutionId,
  Fingerprint,
  FormId,
  GitRemote,
  IssueId,
  RepositoryId,
  SessionId,
  WebSubmissionId,
} from "@abracode/contracts/identities";
import { remoteIdentity } from "../../src/git/source.ts";
import { createExecution } from "../../src/workflow/execution.ts";
import { Records } from "../../src/storage/store.ts";
import { MemoryStore, TestLocks } from "../fixtures.ts";
import { CrewError, type Project } from "../../src/domain.ts";

test("WebSubmissionId accepts leading underscore identifiers", () => {
  const id = Schema.decodeSync(WebSubmissionId)("_selection");
  assert.equal(id, "_selection");
  assert.throws(() => Schema.decodeSync(WebSubmissionId)("bad id with spaces"));
});

test("ApprovalSchema binds plan to Fingerprint and merge to Commit", () => {
  const base = {
    form_id: FormId.make("frm_1"),
    session_id: SessionId.make("ses_1"),
  };
  const plan = Schema.decodeSync(ApprovalSchema)({
    ...base,
    kind: "plan",
    fingerprint: Fingerprint.make("plan-digest-any-nonempty"),
  });
  assert.equal(plan.kind, "plan");

  const mergeSha1 = Schema.decodeSync(ApprovalSchema)({
    ...base,
    kind: "merge",
    fingerprint: Commit.make("a".repeat(40)),
  });
  assert.equal(mergeSha1.kind, "merge");

  const mergeSha256 = Schema.decodeSync(ApprovalSchema)({
    ...base,
    kind: "merge",
    fingerprint: Commit.make("b".repeat(64)),
  });
  assert.equal(mergeSha256.kind, "merge");

  assert.throws(() =>
    Schema.decodeSync(ApprovalSchema)({
      ...base,
      kind: "merge",
      fingerprint: "invalid-commit",
    }),
  );
});

test("remoteIdentity translates malformed file-URL percent escapes to REMOTE failure", async () => {
  const exit = await Effect.runPromiseExit(
    Effect.try({
      try: () => remoteIdentity(GitRemote.make("file:///tmp/%E0%A4%A")),
      catch: CrewError.from,
    }),
  );
  assert.equal(Exit.isFailure(exit), true);
  if (Exit.isFailure(exit)) {
    const error = exit.cause.reasons.find((r) => r._tag === "Fail");
    assert.ok(error && error._tag === "Fail");
    assert.equal(error.error.code, "REMOTE");
  }
});

test("createExecution returns failing Effect on policy rejection without throwing synchronously", async () => {
  const project: Project = {
    schema_version: 1,
    revision: 1,
    id: RepositoryId.make("proj"),
    path: AbsolutePath.make("/tmp/proj"),
    git_common_dir: AbsolutePath.make("/tmp/proj/.git"),
    remote: GitRemote.make("https://example.com/org/repo.git"),
    delivery: "github-pr",
    target_branch: BranchName.make("main"),
    branch_policy: "default",
    managed: true,
    openspec: true,
    verification: [],
    max_workers: 2,
    max_executions: 2,
    plan_approval: true,
    merge_approval: true,
    merge_method: "squash",
    ci_policy: "all-reported",
    allow_no_checks: true,
    generated_paths: [],
    diagnostic_turns: 3,
    repair_rounds: 2,
  };

  // Must NOT throw synchronously when constructing the Effect.
  const effect = createExecution(project, {
    issue_id: IssueId.make("iss-1"),
    repository_id: project.id,
    execution_id: ExecutionId.make("exe-1"),
    workflow_policy: "lightweight-fix",
    quality_profile: "strict",
    current_phase: "exploring",
    branch: BranchName.make("work/iss-1"),
    openspec_change: ChangeName.make("iss-1"),
    supervisor_session_id: SessionId.make("ses_1"),
    intent: { title: "Fix issue", description: "Strict quality vs lightweight fix" },
  });

  const exit = await Effect.runPromiseExit(effect);
  assert.equal(Exit.isFailure(exit), true);
  if (Exit.isFailure(exit)) {
    const fail = exit.cause.reasons.find((r) => r._tag === "Fail");
    assert.ok(fail && fail._tag === "Fail");
    assert.equal(fail.error.code, "QUALITY_WORKFLOW");
  }
});

test("Records.coordinateCommit preserves callback error and environment types", async () => {
  class CustomService extends Context.Service<CustomService, { readonly tag: string }>()(
    "test/CustomService",
  ) {}
  class CustomError {
    readonly _tag = "CustomError";
  }
  const records = new Records(new MemoryStore());
  records.coordinate(new TestLocks());
  const eff: Effect.Effect<string, CrewError | CustomError, CustomService> =
    records.coordinateCommit(() =>
      Effect.gen(function* () {
        const svc = yield* CustomService;
        if (svc.tag === "fail") return yield* Effect.fail(new CustomError());
        return svc.tag;
      }),
    );
  const ok = await Effect.runPromise(
    eff.pipe(Effect.provideService(CustomService, { tag: "preserved" })),
  );
  assert.equal(ok, "preserved");
});
