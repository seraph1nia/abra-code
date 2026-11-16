import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { Schema } from "effect";
import { SpecStatusSchema, ApplyStatusSchema } from "../../src/openspec/contracts.ts";
import { planningPrerequisites, trackedImplementation } from "../../src/openspec/prerequisites.ts";
const artifact = (id: string, status = "done", requires: string[] = []) => ({
  id,
  status,
  requires,
  outputPath: `${id}.md`,
});
const status = (artifacts: unknown[], applyRequires = ["tasks"]) =>
  Schema.decodeUnknownSync(SpecStatusSchema)({
    changeName: "sample",
    schemaName: "custom",
    isPlanningComplete: false,
    isComplete: false,
    actionContext: { mode: "repo-local" },
    artifacts,
    applyRequires,
  });

test("planning follows every native transitive prerequisite including done/skipped dependencies", () => {
  const graph = status([
    artifact("proposal"),
    artifact("specs", "skipped", ["proposal"]),
    artifact("tasks", "done", ["specs"]),
    artifact("unrelated", "ready"),
  ]);
  assert.deepEqual(planningPrerequisites(graph), ["proposal", "specs", "tasks"]);
  for (const artifacts of [
    [
      artifact("proposal", "ready"),
      artifact("specs", "done", ["proposal"]),
      artifact("tasks", "done", ["specs"]),
    ],
    [artifact("tasks", "done", ["missing"])],
    [artifact("tasks", "done", ["tasks"])],
    [artifact("tasks"), artifact("tasks")],
    [{ id: "tasks", status: "done", outputPath: "tasks.md" }],
  ])
    assert.throws(
      () => planningPrerequisites(status(artifacts)),
      /prerequisite|dependencies|identities/,
    );
  assert.throws(() => planningPrerequisites(status([artifact("tasks")], [])), /prerequisites/);
});

test("implementation tracking must be nonempty, unblocked and consistent with native task identities", () => {
  const input = {
    state: "ready",
    taskTrackingConfigured: true,
    progress: { total: 1, complete: 0, remaining: 1 },
    tasks: [{ id: "1", done: false }],
  };
  const decode = Schema.decodeUnknownSync(ApplyStatusSchema);
  trackedImplementation(decode(input));
  trackedImplementation(
    decode({
      ...input,
      state: "all_done",
      progress: { total: 1, complete: 1, remaining: 0 },
      tasks: [{ id: "1", done: true }],
    }),
  );
  for (const changed of [
    { ...input, state: "blocked" },
    { ...input, taskTrackingConfigured: false },
    { ...input, progress: { total: 0, complete: 0, remaining: 0 }, tasks: [] },
    { ...input, tasks: [] },
    { ...input, tasks: [{ id: "1", done: true }] },
    {
      ...input,
      progress: { total: 2, complete: 0, remaining: 2 },
      tasks: [
        { id: "1", done: false },
        { id: "1", done: false },
      ],
    },
  ])
    assert.throws(() => trackedImplementation(decode(changed)), /tracking/);
});
