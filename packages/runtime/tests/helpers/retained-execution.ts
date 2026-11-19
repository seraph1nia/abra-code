import type { Execution } from "../../src/domain.ts";
import * as Id from "../../src/identities.ts";
import { Records } from "../../src/storage/store.ts";
import { MemoryStore, TestLocks } from "../fixtures.ts";
import { run } from "../effects.ts";

export async function retainedExecution(fields: Partial<Execution> = {}) {
  const records = new Records(new MemoryStore());
  const locks = new TestLocks();
  records.coordinate(locks);
  const execution: Execution = {
    schema_version: 1,
    revision: 1,
    control_generation: 0,
    issue_id: Id.IssueId.make("abra-1"),
    execution_id: Id.ExecutionId.make("execution-one"),
    repository_id: Id.RepositoryId.make("api"),
    branch: Id.BranchName.make("work/one"),
    openspec_change: Id.ChangeName.make("work-one"),
    workflow_policy: "full-openspec",
    current_phase: "provisioning",
    approval_receipts: [],
    updated_at: Id.timestampAt(0),
    plan_approval_required: true,
    merge_approval_required: true,
    delivery_policy: "github-pr",
    effective_policy: {
      verification: [],
      delivery: "github-pr",
      plan_approval: true,
      merge_approval: true,
      merge_method: "merge",
      ci_policy: "all-reported",
      allow_no_checks: false,
      generated_paths: [],
      diagnostic_turns: 0,
      repair_rounds: 0,
    },
    ...fields,
  };
  await run(records.create(execution));
  return { execution, records, locks };
}
