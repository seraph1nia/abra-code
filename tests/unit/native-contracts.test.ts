import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { Clock, Effect, Schema, FileSystem } from "effect";
import { TestClock } from "effect/testing";
import { Model } from "@opencode/schema/model";
import { WorkerModelSchema, WorkerErrorSchema } from "../../src/contracts.ts";
import { Timestamp, timestamp } from "../../src/identities.ts";
import { WorkInputSchema, normalizeIssue } from "../../src/work/model.ts";
import { decodeJSON } from "../../src/decode.ts";
import { run } from "../effects.ts";
import { CrewError } from "../../src/domain.ts";
import { domainEffect } from "../../src/effect.ts";
import { ProvisionedEvidenceSchema, DeliveredEvidenceSchema } from "../../src/workflow/evidence.ts";
import { expectTypeOf } from "vite-plus/test";
import { AbsolutePath, Commit } from "../../src/identities.ts";
import { memoSuccessful } from "../../src/opencode/client.ts";
import { readFile } from "../../src/filesystem.ts";

test("native model and diagnostic projections retain host contracts without response bodies", () => {
  assert.equal(WorkerModelSchema, Model.Ref);
  assert.deepEqual(
    Schema.decodeUnknownSync(WorkerErrorSchema)({
      type: "provider.failure",
      message: "Unavailable",
      status: 503,
      response: { body: "private" },
    }),
    { type: "provider.failure", message: "Unavailable", status: 503 },
  );
});

test("timestamp validation rejects invalid calendars and generation follows the supplied clock", async () => {
  for (const value of [
    "today",
    "2026-02-30T10:00:00Z",
    "2026-10-16T25:00:00Z",
    "2026-10-16T10:00:00+03:00",
  ])
    assert.throws(() => Schema.decodeSync(Timestamp)(value));
  for (const value of [
    "2026-10-16T10:00:00Z",
    "2026-10-16T10:00:00.123Z",
    "2026-10-16T10:00:00+00:00",
  ])
    assert.equal(Schema.decodeSync(Timestamp)(value), value);
  const clock = await run(TestClock.make());
  await run(clock.setTime(Date.parse("2026-10-16T10:00:00Z")));
  assert.equal(
    await run(timestamp.pipe(Effect.provideService(Clock.Clock, clock))),
    "2026-10-16T10:00:00.000Z",
  );
});

test("JSON normalization preserves omission and work input shares normalized semantics", async () => {
  const schema = Schema.Struct({
    absent: Schema.optional(Schema.String),
    present: Schema.NullOr(Schema.String),
  });
  const encoded = JSON.stringify({ absent: undefined, present: null });
  assert.deepEqual(await run(decodeJSON(schema, encoded, "fixture")), { present: null });
  const input = Schema.decodeSync(WorkInputSchema)({
    repository_id: "api",
    title: " Goal ",
    description: " Request ",
    request_id: "retry",
    priority: 2,
    dependencies: ["b", "a", "b"],
  });
  assert.deepEqual(normalizeIssue(input).dependencies, ["a", "b"]);
  assert.equal(normalizeIssue(input).title, "Goal");
  assert.throws(() => Schema.decodeSync(WorkInputSchema)({ ...input, priority: -1 }));
});

test("expected errors and defects stay distinct and phase evidence has required identities", async () => {
  const expected = await run(
    Effect.exit(domainEffect(Effect.fail(new CrewError("EXPECTED", "rejected")))),
  );
  const defect = await run(Effect.exit(domainEffect(Effect.die(new Error("bug")))));
  assert.equal(expected._tag, "Failure");
  assert.equal(defect._tag, "Failure");
  if (expected._tag === "Failure")
    assert.deepEqual(
      expected.cause.reasons.map((r) => r._tag),
      ["Fail"],
    );
  if (defect._tag === "Failure")
    assert.deepEqual(
      defect.cause.reasons.map((r) => r._tag),
      ["Die"],
    );
  expectTypeOf<
    typeof ProvisionedEvidenceSchema.Type.worktree_directory
  >().toEqualTypeOf<AbsolutePath>();
  expectTypeOf<typeof DeliveredEvidenceSchema.Type.delivered_commit>().toEqualTypeOf<Commit>();
  assert.throws(() =>
    Schema.decodeUnknownSync(DeliveredEvidenceSchema)({
      worktree_directory: "/tmp/work",
      base_commit: "a".repeat(40),
      target_branch: "main",
    }),
  );
});

test("lazy single-flight acquisition retries failures and retains a successful client", async () => {
  let attempts = 0;
  const client = {};
  const cached = await run(
    memoSuccessful(
      Effect.suspend(() => {
        attempts++;
        return attempts === 1
          ? Effect.fail(new CrewError("DISCOVERY", "not ready"))
          : Effect.succeed(client);
      }),
    ),
  );
  assert.equal(attempts, 0);
  await assert.rejects(run(cached), /not ready/);
  const values = await run(Effect.all([cached, cached, cached], { concurrency: "unbounded" }));
  assert.equal(attempts, 2);
  assert.ok(values.every((value) => value === client));
  assert.equal(await run(cached), client);
  assert.equal(attempts, 2);
});

test("thin filesystem reads use the injected platform service", async () => {
  const fileSystem = FileSystem.makeNoop({
    readFileString: (path) => Effect.succeed(`injected:${path}`),
  });
  assert.equal(
    await run(
      readFile("/virtual", "utf8").pipe(Effect.provideService(FileSystem.FileSystem, fileSystem)),
    ),
    "injected:/virtual",
  );
});

test("worker inventory preserves explicit model variants and rejects missing/native-incompatible selections", async () => {
  const { checkWorkerInventory } = await import("../../src/opencode/runtime.ts");
  const { Agent } = await import("@opencode/schema/agent");
  const { Provider } = await import("@opencode/schema/provider");
  const agent = { id: Agent.ID.make("build"), name: Agent.Name.make("build"), model: undefined };
  const model = Model.Info.default(Provider.ID.make("fixture"), Model.ID.make("worker"));
  const selected = { providerID: model.providerID, id: model.id };
  await run(checkWorkerInventory(undefined, selected, "apply", [agent], [model]));
  await assert.rejects(
    run(checkWorkerInventory({ agent: Agent.ID.make("missing") }, selected, "apply", [], [model])),
    /AGENT_UNAVAILABLE|agent/,
  );
  await assert.rejects(
    run(checkWorkerInventory(undefined, selected, "apply", [agent], [])),
    /model is absent/,
  );
  await assert.rejects(
    run(
      checkWorkerInventory(
        undefined,
        { ...selected, variant: Model.VariantID.make("missing") },
        "apply",
        [agent],
        [model],
      ),
    ),
    /variant .* is absent/,
  );
  await assert.rejects(
    run(
      checkWorkerInventory(
        undefined,
        selected,
        "apply",
        [agent],
        [{ ...model, capabilities: { ...model.capabilities, tools: false } }],
      ),
    ),
    /does not support tools/,
  );
});

test("adapter preconditions fail in the typed channel before invoking commands", async (t) => {
  const { fixture, planned } = await import("../fixtures.ts");
  const { OpenSpec } = await import("../../src/openspec/adapter.ts");
  const { Forge } = await import("../../src/git/forge.ts");
  const { forgeFixture } = await import("../forge.ts");
  const Id = await import("../../src/identities.ts");
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(planned(f));
  const spec = new OpenSpec(f.git.runner, f.config.commands.openspec);
  const missing = await run(
    Effect.exit(spec.call({ ...e, worktree_directory: undefined }, Schema.Unknown, ["status"])),
  );
  assert.equal(missing._tag, "Failure");
  if (missing._tag === "Failure") assert.equal(missing.cause.reasons[0]._tag, "Fail");
  const project = (await run(f.records.project(e.repository_id)))!;
  const native = forgeFixture(project, () => undefined);
  const mismatch = await run(
    Effect.exit(
      new Forge(native.runner, f.config.commands.forge).repo({
        ...project,
        remote: Id.GitRemote.make(`${project.remote}-different`),
      }),
    ),
  );
  assert.equal(mismatch._tag, "Failure");
  if (mismatch._tag === "Failure") assert.equal(mismatch.cause.reasons[0]._tag, "Fail");
});
