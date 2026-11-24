import { Effect, Schema } from "effect";
import { ApprovalSchema } from "@abracode/contracts/primitives";
import { CrewError, type Execution } from "../../src/domain.ts";
import * as Id from "@abracode/contracts/identities";
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

const approvalRecord = Schema.Struct({ approval_receipts: Schema.Array(ApprovalSchema) });

export function interruptApprovalWrite(records: Records, recordKey: string, form: Id.FormId) {
  const set = records.store.set.bind(records.store);
  records.store.set = (key, value) => {
    if (
      key === recordKey &&
      Schema.is(approvalRecord)(value) &&
      value.approval_receipts.some((a) => a.form_id === form && a.authorized_at)
    ) {
      records.store.set = set;
      return Effect.fail(new CrewError("STORAGE", "Approval receipt interrupted"));
    }
    return set(key, value);
  };
}
