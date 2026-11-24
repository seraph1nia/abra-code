import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Effect, Metric } from "effect";
import { test } from "vite-plus/test";
import { measureReconcile, reconcileDuration } from "../../src/observability.ts";
import { computeHighWatermark } from "../../src/work/github-inbox.ts";
import {
  MemoryCollections,
  hash,
  metadataSchema,
  providerProjectsSchema,
  searchPageSchema,
} from "../../src/memory/collections.ts";
import { decode } from "../../src/decode.ts";
import { sha256Json, sha256Text } from "../../src/digest.ts";
import { CrewError } from "../../src/domain.ts";
import { RepositoryId } from "@abracode/contracts/identities";

test("measureReconcile records non-negative duration on both success and failure exits", async () => {
  const before = await Effect.runPromise(Metric.value(reconcileDuration));
  const ok = await Effect.runPromise(measureReconcile(Effect.succeed("ok")));
  assert.equal(ok, "ok");
  const afterSuccess = await Effect.runPromise(Metric.value(reconcileDuration));
  assert.equal(afterSuccess.count, before.count + 1);
  assert.ok(afterSuccess.sum >= before.sum);
  assert.ok(afterSuccess.min >= 0);

  const failed = await Effect.runPromise(
    Effect.flip(measureReconcile(Effect.fail(new CrewError("RECONCILE_TEST", "boom")))),
  );
  assert.equal(failed.code, "RECONCILE_TEST");
  const afterFailure = await Effect.runPromise(Metric.value(reconcileDuration));
  assert.equal(afterFailure.count, afterSuccess.count + 1);
  assert.ok(afterFailure.sum >= afterSuccess.sum);
  assert.ok(afterFailure.min >= 0);
});

test("computeHighWatermark ignores malformed timestamps and handles large item batches safely", () => {
  const base = Date.parse("2026-01-01T00:00:00Z");
  const later = Date.parse("2026-02-01T12:30:00Z");
  const result = computeHighWatermark(base, [
    { updated_at: "not-a-date" },
    { updated_at: "" },
    { updated_at: "2026-02-01T12:30:00Z" },
    { updated_at: "9999-99-99T99:99:99Z" },
  ]);
  assert.equal(result.high, later);
  assert.equal(Number.isFinite(result.high), true);
  assert.deepEqual(result.times, [later]);

  const allMalformed = computeHighWatermark(base, [{ updated_at: "invalid" }]);
  assert.equal(allMalformed.high, base);
  assert.deepEqual(allMalformed.times, []);

  const invalidBase = computeHighWatermark(Number.NaN, [{ updated_at: "invalid" }]);
  assert.equal(invalidBase.high, 0);

  // Guard against Math.max(...times) call-stack overflow on large batches.
  const large = Array.from({ length: 150_000 }, () => ({ updated_at: "2026-01-02T00:00:00Z" }));
  const largeResult = computeHighWatermark(base, large);
  assert.equal(largeResult.high, Date.parse("2026-01-02T00:00:00Z"));
  assert.equal(largeResult.times.length, 150_000);
});

test("memory/collections Effect Schema validation rejects malformed payloads with typed INVALID_DATA errors", async (t) => {
  const badProjects = await Effect.runPromise(
    Effect.flip(
      decode(
        providerProjectsSchema,
        {
          projects: [
            { name: "abra-shared", source: "local", local_path: "/tmp/x", external_id: "not-uuid" },
          ],
        },
        "Memory projects",
      ),
    ),
  );
  assert.equal(badProjects.code, "INVALID_DATA");

  const badMeta = await Effect.runPromise(
    Effect.flip(
      decode(
        metadataSchema,
        { file_path: "note.md", title: "Title", checksum: "short-hex" },
        "Memory note metadata",
      ),
    ),
  );
  assert.equal(badMeta.code, "INVALID_DATA");

  const oversizedPage = await Effect.runPromise(
    Effect.flip(
      decode(
        searchPageSchema,
        {
          has_more: false,
          results: Array.from({ length: 9 }, (_, i) => ({
            file_path: `n${i}.md`,
            project_external_id: "aa000000-0000-4000-8000-000000000000",
          })),
        },
        "Memory search page",
      ),
    ),
  );
  assert.equal(oversizedPage.code, "INVALID_DATA");

  // Also verify MemoryCollections.searchEffect surfaces INVALID_DATA on malformed provider responses.
  const root = await mkdtemp(join(tmpdir(), "abra-wave2-collections-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const vault = join(root, "vault", "abra-shared");
  await mkdir(vault, { recursive: true });
  await writeFile(join(vault, "note.md"), "hello");
  const projectId = "aa000000-0000-4000-8000-000000000001";
  const collections = new MemoryCollections(
    root,
    {
      call: async (_r, tool) => {
        if (tool === "bm_project")
          return {
            projects: [
              { name: "abra-shared", source: "local", local_path: vault, external_id: projectId },
            ],
          };
        if (tool === "bm_search") return { has_more: "not-a-boolean", results: [] };
        return { file_path: "note.md", title: "Hi", checksum: hash("hello") };
      },
    },
    "text",
  );
  const searchErr = await Effect.runPromise(
    Effect.flip(collections.searchEffect(undefined, { query: "hello" })),
  );
  assert.equal(searchErr.code, "INVALID_DATA");

  // Verify malformed metadata in readEffect also returns INVALID_DATA.
  const badMetaCollections = new MemoryCollections(
    root,
    {
      call: async (_r, tool) => {
        if (tool === "bm_project")
          return {
            projects: [
              { name: "abra-shared", source: "local", local_path: vault, external_id: projectId },
            ],
          };
        return { file_path: "note.md", title: "Hi", checksum: "not-64-hex" };
      },
    },
    "text",
  );
  const readErr = await Effect.runPromise(
    Effect.flip(
      badMetaCollections.readEffect(RepositoryId.make("repo"), {
        reference: { scope: { kind: "shared" }, path: "note.md", revision: hash("hello") },
      }),
    ),
  );
  assert.equal(readErr.code, "INVALID_DATA");
});

test("digest helpers produce stable SHA-256 hex for text and canonical JSON", () => {
  assert.equal(sha256Text("hello"), hash("hello"));
  assert.equal(sha256Json({ b: 2, a: 1 }), sha256Json({ a: 1, b: 2 }));
  assert.notEqual(sha256Json({ a: 1 }), sha256Json({ a: 2 }));
});
