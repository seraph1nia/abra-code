import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { run } from "../effects.ts";
import { applying, fixture, repo } from "../fixtures.ts";
import { removeFixture } from "../helpers/resources.ts";
import { verifiedSpec } from "../helpers/spec-review.ts";
import {
  AbsolutePath,
  Executable,
  RelativePath,
  ModelId,
  ModelVariant,
} from "../../src/identities.ts";
import { Git } from "../../src/git/repository.ts";
import { ProcessRunner } from "../../src/process.ts";
import { readReviewChanges } from "../../src/git/review-changes.ts";

test("the real OCR delegate reconciles range and workspace against the final net patch", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "abra-ocr-"));
  t.onTestFinished(() => removeFixture(root));
  const dir = AbsolutePath.make(await run(repo(root, "project")));
  const git = new Git(new ProcessRunner());
  const write = (name: string, content: string) => writeFile(join(dir, name), content);
  await write("restored.ts", "original\n");
  await run(git.run(dir, ["add", "."]));
  await run(git.run(dir, ["commit", "-m", "Retained base"]));
  const base = await run(git.head(dir));
  await write("restored.ts", "temporary\n");
  await write("mixed.ts", "committed\n");
  await write("committed.ts", "range only\n");
  await run(git.run(dir, ["add", "."]));
  await run(git.run(dir, ["commit", "-m", "Work on the task"]));
  await write("restored.ts", "original\n");
  await write("mixed.ts", "staged\n");
  await run(git.run(dir, ["add", "mixed.ts"]));
  await write("mixed.ts", "final\n");
  await write("-fresh.ts", "new file\n");
  await write("README.md", "accepted documentation\n");
  const cli = Executable.make(resolve("node_modules/.bin/ocr"));
  const read = (selected?: RelativePath) =>
    run(readReviewChanges(git, cli, dir, base, 0, selected));
  const index = join(dir, ".git/index");
  const prior = await readFile(index);
  const page = await read();
  assert.deepEqual(page.changes.map((f) => f.path).sort(), [
    "-fresh.ts",
    "README.md",
    "committed.ts",
    "mixed.ts",
  ]);
  assert.match(page.changes.find((f) => f.path === "mixed.ts")!.patch!, /\+final/);
  assert.doesNotMatch(page.changes.find((f) => f.path === "mixed.ts")!.patch!, /staged|committed/);
  assert.ok(page.changes.find((f) => f.path === "README.md")!.excluded);
  assert.deepEqual(page.rules.flatMap((g) => g.files).sort(), [
    "-fresh.ts",
    "committed.ts",
    "mixed.ts",
  ]);
  assert.match(
    (await read(RelativePath.make("README.md"))).changes[0]!.patch!,
    /accepted documentation/,
  );
  await assert.rejects(read(RelativePath.make("restored.ts")), /current net change inventory/);
  assert.deepEqual(await readFile(index), prior);
});

test("Review requires every page of the verified inventory and refuses stale or incomplete evidence", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const cheap = {
    ...f.config.models.default,
    id: ModelId.make("cheap-review"),
    variant: ModelVariant.make("low"),
  };
  f.config.workers.review = { model: cheap };
  const e = await run(applying(f));
  const dir = e.worktree_directory!;
  for (let i = 0; i < 33; i++)
    await writeFile(join(dir, `change-${i}.ts`), "export const changed = true;\n");
  // Drive this worker's reads explicitly.
  f.runtime.consumeReviewPages = false;
  await writeFile(join(dir, "oversize.ts"), "x".repeat(65537));
  f.spec.done = true;
  f.runtime.success(e.apply_session_id!);
  const reviewing = await run(f.controller.advance(e.issue_id));
  const session = reviewing.review_session_id!;
  assert.deepEqual(f.runtime.sessions.get(session)!.model, cheap);
  const pass = () =>
    run(f.controller.reviewReport(session, true, "Verified", undefined, verifiedSpec));
  await assert.rejects(pass(), /review pages/);
  await assert.rejects(run(f.controller.reviewChanges(e.apply_session_id!, 0)), /Assigned Review/);
  await assert.rejects(run(f.controller.reviewChanges(session, 32)), /preceding review page/);
  const first = await run(f.controller.reviewChanges(session));
  assert.equal(first.next_offset, 32);
  await assert.rejects(pass(), /review pages/);
  await run(f.controller.reviewChanges(session, 32));
  await assert.rejects(pass(), /resolve missing patch evidence/);
  const evidence = [
    {
      path: RelativePath.make("oversize.ts"),
      basis: "verified_elsewhere" as const,
      evidence: "Inspected the full changed file through the assigned read tool.",
    },
  ];
  const passed = await run(
    f.controller.reviewReport(session, true, "Verified", undefined, verifiedSpec, evidence),
  );
  assert.equal(passed.review_receipt?.fingerprint, reviewing.verification_receipt?.fingerprint);
  await writeFile(join(dir, "change-0.ts"), "modified after verification");
  await assert.rejects(run(f.controller.reviewChanges(session)), /Verified content changed/);
  await assert.rejects(pass(), /matching verified content/);
});
