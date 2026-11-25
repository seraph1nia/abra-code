import { presentationHash } from "../../src/presentation/identity.ts";
import { FindingId, FindingRevisionId } from "@abracode/contracts/identities";
import { feedbackFixture } from "../helpers/review-evidence.ts";
import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { Effect, Schema } from "effect";
import { fixture, planned } from "../fixtures.ts";
import { run } from "../effects.ts";
import { resolveOwnedResource } from "../../src/web/resource-selection.ts";
import { workspaceSearch, resourceFromSearch, searchForResource } from "@abracode/web/navigation";
import { ResourceSelectionSchema, type ResourceSelection } from "@abracode/contracts/web/resources";

test("resource resolution accepts owned sessions and rejects foreign sessions and artifact revisions", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(planned(f));
  const owned = {
    action: "open_session",
    issue_id: e.issue_id,
    session_id: e.explore_session_id!,
  } as const;
  const creates = f.runtime.creates;
  assert.deepEqual(await run(resolveOwnedResource(f.controller.queries, owned)), owned);
  for (const target of [
    { ...owned, session_id: "ses_foreign" },
    {
      action: "open_artifact",
      issue_id: e.issue_id,
      request_id: "foreign-report",
      hash: "a".repeat(40),
    },
    {
      action: "open_decision",
      issue_id: e.issue_id,
      key: "foreign-question",
      generation: e.control_generation,
    },
  ]) {
    await assert.rejects(run(resolveOwnedResource(f.controller.queries, target)), /does not own/);
  }
  assert.equal(f.runtime.creates, creates);
  assert.equal(f.runtime.forms.size, 0);
});

test("invalid resource capabilities are rejected before any ownership read", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  let reads = 0;
  const queries = {
    issue: (id: Parameters<typeof f.controller.queries.issue>[0]) =>
      Effect.sync(() => {
        reads++;
      }).pipe(Effect.andThen(f.controller.queries.issue(id))),
    execution: f.controller.queries.execution,
    planDocument: f.controller.queries.planDocument,
    diff: f.controller.queries.diff,
  };
  for (const target of [
    { action: "run_tool", issue_id: "task-one" },
    { action: "open_task", issue_id: "task-one", callback: "approve" },
    { action: "open_task", issue_id: "task-one", section: "summary", activity: "communication" },
    { action: "open_task", issue_id: "task-one", section: "activity", activity: "execute" },
    { action: "open_changes", issue_id: "task-one", file: "../secret" },
    { action: "open_changes", issue_id: "task-one", file: "/etc/passwd" },
    { action: "open_changes", issue_id: "task-one", file: "src\\secret" },
    { action: "open_task", issue_id: "../secret" },
    { action: "open_decision", issue_id: "task-one", key: "question", generation: -1 },
    { action: "open_artifact", issue_id: "task-one", request_id: "report", hash: "latest" },
  ])
    await assert.rejects(run(resolveOwnedResource(queries, target)), /Resource selection/);
  assert.equal(reads, 0);
});

test("resource bookmarks preserve legacy task/change links and exact typed targets", () => {
  const legacy = workspaceSearch({
    issue: "task-one",
    tab: "Diff",
    file: "src/main.ts",
    scope: "uncommitted",
  });
  assert.deepEqual(resourceFromSearch(legacy), {
    action: "open_changes",
    issue_id: "task-one",
    file: "src/main.ts",
    scope: "uncommitted",
  });
  assert.deepEqual(resourceFromSearch(workspaceSearch({ issue: "task-one", tab: "Plan" })), {
    action: "open_task",
    issue_id: "task-one",
    section: "plan",
  });
  const communication = Schema.decodeSync(ResourceSelectionSchema)({
    action: "open_task",
    issue_id: "task-one",
    section: "activity",
    activity: "communication",
  });
  assert.equal(searchForResource(communication).tab, "Activity");
  assert.equal(searchForResource(communication).activity, "communication");
  assert.deepEqual(
    resourceFromSearch(workspaceSearch(searchForResource(communication))),
    communication,
  );
  const selection = resourceFromSearch(legacy)!;
  assert.deepEqual(resourceFromSearch(workspaceSearch(searchForResource(selection))), selection);
  for (const target of [
    { action: "open_session", issue_id: "task-one", session_id: "ses_worker" },
    { action: "open_decision", issue_id: "task-one", key: "question", generation: 2 },
    {
      action: "open_artifact",
      issue_id: "task-one",
      request_id: "report-one",
      hash: "a".repeat(40),
    },
  ]) {
    const decoded = workspaceSearch({ resource: target }).resource as ResourceSelection;
    assert.deepEqual(decoded, target);
    assert.deepEqual(resourceFromSearch(workspaceSearch(searchForResource(decoded))), target);
  }
  assert.equal(
    resourceFromSearch(workspaceSearch({ issue: "task-one", tab: "Diff", file: "../escape" })),
    undefined,
  );
  assert.equal(
    workspaceSearch({ resource: { action: "approve", issue_id: "task-one" } }).resource,
    undefined,
  );
});

test("full report canvas bookmarks require an exact read-only artifact selection", () => {
  const artifact = {
    action: "open_artifact",
    issue_id: "task-one",
    request_id: "report-one",
    hash: "a".repeat(64),
  };
  const search = workspaceSearch({ resource: artifact, canvas: true });
  assert.equal(search.canvas, true);
  assert.deepEqual(resourceFromSearch(search), artifact);
  assert.equal(
    workspaceSearch({ issue: "task-one", tab: "Reports", canvas: true }).canvas,
    undefined,
  );
  assert.equal(
    workspaceSearch({ resource: { action: "open_task", issue_id: "task-one" }, canvas: true })
      .canvas,
    undefined,
  );
  assert.equal(workspaceSearch({ resource: artifact, canvas: "true" }).canvas, undefined);
});

test("scoped resources resolve findings beyond the first page and refuse changed evidence", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(planned(f));
  const seed = feedbackFixture(false);
  const findings = Array.from({ length: 24 }, (_, index) => ({
    ...seed.findings[0],
    id: FindingId.make("finding-" + index),
  }));
  const history = [{ ...findings[23], revision: "older" }];
  const feedback = {
    schema_version: 1 as const,
    ...seed.observation!,
    digest: "fixture",
    attempts: 1,
    actions: [],
    findings,
    history,
  };
  const owned = await run(f.controller.queries.get(e.issue_id));
  await run(f.records.save({ ...owned, feedback }));
  const queries = {
    issue: f.controller.queries.issue,
    execution: f.controller.queries.execution,
    diff: f.controller.queries.diff,
    planDocument: () => Effect.succeed("original\npassage"),
  };
  for (const finding of [findings[23], history[0]]) {
    const target = {
      action: "open_finding",
      issue_id: e.issue_id,
      finding_id: finding.id,
      revision: finding.revision,
    };
    assert.deepEqual(await run(resolveOwnedResource(queries, target)), target);
    const exact = await run(
      f.controller.queries.feedback(
        e.issue_id,
        0,
        finding.id,
        FindingRevisionId.make(finding.revision),
      ),
    );
    assert.deepEqual([...exact.findings, ...exact.history], [finding]);
    await assert.rejects(
      run(resolveOwnedResource(queries, { ...target, revision: "wrong" })),
      /does not own/,
    );
    await assert.rejects(
      run(resolveOwnedResource(queries, { ...target, issue_id: "foreign-task" })),
    );
  }
  const passage = {
    action: "open_passage",
    issue_id: e.issue_id,
    file: "proposal.md",
    generation: e.control_generation,
    hash: presentationHash("original\npassage"),
    start: 2,
    end: 2,
  };
  assert.deepEqual(await run(resolveOwnedResource(queries, passage)), passage);
  await assert.rejects(
    run(
      resolveOwnedResource({ ...queries, planDocument: () => Effect.succeed("changed") }, passage),
    ),
    /does not own/,
  );
  await assert.rejects(
    run(
      resolveOwnedResource(queries, {
        action: "open_changes",
        issue_id: e.issue_id,
        file: "absent.ts",
        head: seed.head,
      }),
    ),
  );
});
