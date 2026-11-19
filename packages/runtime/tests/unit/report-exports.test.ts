import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { Effect } from "effect";
import { readFile, writeFile, rm, lstat, symlink } from "node:fs/promises";
import { join } from "node:path";
import { fixture } from "../fixtures.ts";
import { run } from "../effects.ts";
import { reportDocument } from "../helpers/report-document.ts";
import { ReportExports } from "../../src/workflow/report-exports.ts";
import { canonicalJSON } from "../../src/presentation/identity.ts";
import { reportHash } from "../../src/workflow/report-build.ts";
import { CrewError } from "../../src/domain.ts";

test("HTML exports are immutable, keyed by document and exporter and repaired without recapture", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const document = reportDocument(),
    json = canonicalJSON(document),
    hash = reportHash(json),
    exporter = reportHash("exporter-one");
  let builds = 0,
    fail = false;
  const bundle = {
    fingerprint: exporter,
    render: () =>
      Effect.sync(() => {
        builds++;
        if (fail) throw new CrewError("BUILD_FAILED", "Fixture export failure");
        return `<!doctype html><div id="abracode-license-notices">Notices</div><script type="application/json" id="abracode-report-document" data-hash="${hash}">${json.replaceAll("<", "\\u003c")}</script>`;
      }),
  };
  const renderer = { acquire: Effect.succeed(bundle) };
  const owner = () => new ReportExports(f.config.home, f.locks, renderer);
  const [first, retry] = await Promise.all([
    run(owner().create(json, hash)),
    run(owner().create(json, hash)),
  ]);
  assert.deepEqual(first, retry);
  assert.equal(builds, 1);
  const directory = join(f.config.home, ".abracode/reports/exports", hash, exporter),
    path = join(directory, "index.html");
  const inode = (await lstat(path)).ino;
  assert.deepEqual(await run(owner().read(hash, exporter)), first);
  const unprepared = new ReportExports(f.config.home, f.locks, {
    acquire: Effect.fail(new CrewError("REPORT_SHELL", "Run pnpm report:prepare")),
  });
  await assert.rejects(run(unprepared.create(json, hash)), /report:prepare/);
  assert.deepEqual(await run(unprepared.read(hash, exporter)), first);
  await rm(join(directory, "receipt.json"));
  assert.deepEqual(await run(owner().create(json, hash)), first);
  assert.equal(builds, 1);
  assert.equal((await lstat(path)).ino, inode);
  await writeFile(path, "tampered");
  await assert.rejects(run(owner().create(json, hash)), /digest/);
  assert.equal(await readFile(path, "utf8"), "tampered");
  assert.equal(builds, 1);
  const next = { acquire: Effect.succeed({ ...bundle, fingerprint: reportHash("exporter-two") }) };
  fail = true;
  await assert.rejects(
    run(new ReportExports(f.config.home, f.locks, next).create(json, hash)),
    /Fixture export failure/,
  );
  assert.equal(canonicalJSON(document), json);
  const occupied = join(
    f.config.home,
    ".abracode/reports/exports",
    hash,
    reportHash("exporter-two"),
    "index.html",
  );
  await symlink(path, occupied);
  fail = false;
  await assert.rejects(
    run(new ReportExports(f.config.home, f.locks, next).create(json, hash)),
    /owned regular/,
  );
  assert.equal((await lstat(occupied)).isSymbolicLink(), true);
  await assert.rejects(run(owner().create(json, reportHash("other-document"))), /digest changed/);
});
