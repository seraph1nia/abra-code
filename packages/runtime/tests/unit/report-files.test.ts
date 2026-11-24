import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { Effect } from "effect";
import { mkdtemp, rm, writeFile, readFile, symlink, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReportFile } from "../../src/reporting/report-files.ts";
import { reportHash } from "../../src/reporting/report-build.ts";
import { AbsolutePath } from "@abracode/contracts/identities";
import { CrewError } from "../../src/domain.ts";
import { run } from "../effects.ts";

const identity = (text: string) => ({ hash: reportHash(text), bytes: Buffer.byteLength(text) });
async function fixture(t: { onTestFinished: (f: () => Promise<void>) => void }) {
  const home = AbsolutePath.make(await mkdtemp(join(tmpdir(), "abra-report-files-")));
  t.onTestFinished(() => rm(home, { recursive: true, force: true }));
  return {
    home,
    file: new ReportFile(home, ["reports"], "index.json", 128),
    path: join(home, "reports/index.json"),
  };
}

test("immutable file caller reconciles identical concurrent publications and preserves conflicts", async (t) => {
  const f = await fixture(t),
    text = "Immutable original";
  const source = { text, identity: identity(text) };
  await Promise.all([run(f.file.publish(source)), run(f.file.publish(source))]);
  const before = await lstat(f.path);
  await run(f.file.publish(source));
  assert.equal((await lstat(f.path)).ino, before.ino);
  assert.equal((await run(f.file.read(identity(text)))).text, text);
  await assert.rejects(
    run(f.file.publish({ text: "Conflict", identity: identity("Conflict") })),
    /digest/,
  );
  assert.equal(await readFile(f.path, "utf8"), text);
});

test("immutable file caller bounds reads and refuses symlinks, escapes and changed identity", async (t) => {
  const f = await fixture(t),
    text = "original";
  await assert.rejects(run(f.file.stage("x".repeat(129), identity("x".repeat(129)))), /bound/);
  await run(f.file.publish({ text, identity: identity(text) }));
  await writeFile(f.path, "x".repeat(129));
  await assert.rejects(run(f.file.read()), /bounded/);
  await rm(f.path);
  const other = join(f.home, "unrelated");
  await writeFile(other, text);
  await symlink(other, f.path);
  await assert.rejects(run(f.file.publish({ text, identity: identity(text) })), /regular file/);
  assert.equal(await readFile(other, "utf8"), text);
  await assert.rejects(run(new ReportFile(f.home, [".."], "escaped", 128).read()), /path segment/);
  await assert.rejects(
    run(new ReportFile(f.home, ["reports"], "../escaped", 128).read()),
    /filename/,
  );
  await rm(f.path);
  await rm(join(f.home, "reports"), { recursive: true });
  await symlink(f.home, join(f.home, "reports"));
  await assert.rejects(run(f.file.publish({ text, identity: identity(text) })), /real directories/);
});

test("retained staging survives an interrupted receipt, resumes and cleans only verified scratch", async (t) => {
  const f = await fixture(t),
    text = "captured once",
    expected = identity(text);
  const { staging } = await run(f.file.stage(text, expected));
  await assert.rejects(
    run(
      f.file.publish(
        { staging, identity: expected },
        Effect.fail(new CrewError("STORAGE", "Receipt interrupted")),
      ),
    ),
    /Receipt interrupted/,
  );
  assert.equal(await readFile(staging, "utf8"), text);
  assert.equal(await readFile(f.path, "utf8"), text);
  await run(f.file.publish({ staging, identity: expected }));
  await assert.rejects(lstat(staging), /ENOENT/);
  // Historical .stage-*.json paths are valid retained evidence, not a new record format.
  const legacy = join(f.home, "reports/.stage-retained.json");
  await writeFile(legacy, text);
  await run(
    f.file.publish(
      { staging: legacy, identity: expected },
      Effect.sync(() => {
        // Receipt succeeds, but replaced scratch must be preserved.
      }),
    ),
  );
  assert.equal(await readFile(f.path, "utf8"), text);
  const { staging: replaced } = await run(f.file.stage(text, expected));
  await writeFile(replaced, "unrelated replacement");
  await run(f.file.publish({ staging: replaced, identity: expected }));
  assert.equal(await readFile(replaced, "utf8"), "unrelated replacement");
  await assert.rejects(
    run(f.file.publish({ staging: join(f.home, "unrelated"), identity: expected })),
    /Owned report staging/,
  );
});

test("an unpublished replaced stage cannot publish bytes or commit a domain receipt", async (t) => {
  const f = await fixture(t),
    text = "reserved",
    expected = identity(text);
  const { staging } = await run(f.file.stage(text, expected));
  await writeFile(staging, "changed");
  let commits = 0;
  await assert.rejects(
    run(
      f.file.publish(
        { staging, identity: expected },
        Effect.sync(() => {
          commits++;
        }),
      ),
    ),
    /digest/,
  );
  assert.equal(commits, 0);
  await assert.rejects(lstat(f.path), /ENOENT/);
  assert.equal(await readFile(staging, "utf8"), "changed");
});

test("retained destination identity is checked before committing a publication receipt", async (t) => {
  const f = await fixture(t),
    text = "expected";
  let commits = 0;
  await assert.rejects(
    run(
      f.file.publish(
        { text, identity: identity(text), expectedPath: join(f.home, "elsewhere.json") },
        Effect.sync(() => {
          commits++;
        }),
      ),
    ),
    /retained path/,
  );
  assert.equal(commits, 0);
  await assert.rejects(lstat(f.path), /ENOENT/);
});
