import * as Id from "../../src/identities.ts";
import { Effect, Schema } from "effect";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { run } from "../effects.ts";
import { decode, decodeJSON } from "../../src/decode.ts";
import {
  ApprovalSchema,
  CommandArgs,
  Commit,
  Identifier,
  PolicySchema,
} from "../../src/contracts.ts";
import { SpecStatusSchema, ApplyStatusSchema } from "../../src/openspec/adapter.ts";
import { PRSchema } from "../../src/git/delivery.ts";
import { fixture } from "../fixtures.ts";
import { loadConfig } from "../../src/config/load.ts";
import { PackageSchema } from "../../src/config/contracts.ts";
import { json } from "../../src/process.ts";

test("consumed contracts reject invalid identity, command, policy and approval evidence", async () => {
  for (const [schema, value] of [
    [Identifier, "../escape"],
    [Commit, "head"],
    [CommandArgs, []],
    [CommandArgs, ["git", 1]],
    [PolicySchema, "shell"],
    [
      ApprovalSchema,
      {
        kind: "merge",
        fingerprint: "head",
        session_id: "ses_supervisor",
        form_id: "form",
        authorized_at: "today",
        rejected_at: "today",
      },
    ],
  ] as const)
    await assert.rejects(run(decode(schema, value, "fixture")), /fixture/);
  assert.equal(await run(decode(Identifier, "abra-1", "fixture")), "abra-1");
});

test("CLI decoder rejects malformed JSON and shapes with bounded source/field diagnostics", async () => {
  const runner = { run: () => Effect.succeed('{"token":"private-secret", nope') };
  await assert.rejects(
    run(
      json(
        runner,
        SpecStatusSchema,
        Id.Executable.make("openspec"),
        ["status"],
        Id.AbsolutePath.make("/tmp"),
      ),
    ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /openspec status.*(?:Invalid JSON|valid JSON string)/);
      assert.doesNotMatch(error.message, /private-secret/);
      return true;
    },
  );
  await assert.rejects(
    run(
      decodeJSON(
        SpecStatusSchema,
        JSON.stringify({ changeName: "sample", isPlanningComplete: "yes" }),
        "openspec status",
      ),
    ),
    /openspec status/,
  );
  await assert.rejects(
    run(
      decode(
        ApplyStatusSchema,
        {
          state: "all_done",
          taskTrackingConfigured: true,
          progress: { total: 2, complete: 1, remaining: 0 },
          tasks: [],
        },
        "apply",
      ),
    ),
    /counts/,
  );
});

test("forge schema accepts documented nulls and additions while refusing unsafe heads", async () => {
  const pr = {
    url: "https://example.invalid/fixture/api/pull/1",
    state: "OPEN",
    headRefOid: "a".repeat(40),
    baseRefName: "main",
    isDraft: false,
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    mergeCommit: null,
    mergedAt: null,
    reviewDecision: null,
    statusCheckRollup: [],
    extra: { nextVersion: true },
  };
  assert.equal((await run(decode(PRSchema, pr, "forge"))).mergeCommit, null);
  await assert.rejects(
    run(decode(PRSchema, { ...pr, headRefOid: "wrong" }, "forge")),
    /headRefOid/,
  );
});

test("config and package decoding reject wrong shapes rather than guessing commands", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  await writeFile(
    join(f.root, "abracode.yaml"),
    "version: 1\nmodels: { default: { providerID: fixture, id: gpt-fixture } }\nmax_workers: many\n",
  );
  await assert.rejects(run(loadConfig(f.root)), /max_workers/);
  await writeFile(join(f.root, "abracode.yaml"), "workers: [\n");
  await assert.rejects(run(loadConfig(f.root)), /Invalid YAML/);
  await assert.rejects(
    run(decode(PackageSchema, { scripts: { test: 17 } }, "package.json")),
    /scripts/,
  );
  const p = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
  await writeFile(join(p.path, "package.json"), '{"scripts":{"test":false}}');
  await assert.rejects(
    run(f.onboarding.inspect({ id: Id.RepositoryId.make("api"), path: p.path })),
    /package.json/,
  );
  assert.deepEqual(
    (await run(f.records.project(Id.RepositoryId.make("api"))))!.verification,
    p.verification,
  );
});

test("Standard Schema input validation shares identifier rules", async () => {
  const standard = Schema.toStandardSchemaV1(Schema.Struct({ issue_id: Identifier }));
  assert.ok((await standard["~standard"].validate({ issue_id: "../escape" })).issues);
  assert.equal((await standard["~standard"].validate({ issue_id: "abra-1" })).issues, undefined);
});
