import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, symlink, lstat, readlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repo } from "../fixtures.ts";
import { run } from "../effects.ts";
import { removeFixture } from "../helpers/resources.ts";
import { Git } from "../../src/git/repository.ts";
import { ProcessRunner } from "../../src/process.ts";
import { AbsolutePath } from "../../src/identities.ts";

test("batched Git fingerprints preserve legacy bytes, filters, staged edits and odd paths", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "abra-fingerprint-"));
  t.onTestFinished(() => removeFixture(root));
  const path = AbsolutePath.make(await run(repo(root, "project")));
  const git = new Git(new ProcessRunner());
  await writeFile(join(path, ".gitattributes"), "*.txt text eol=lf\n");
  await run(git.run(path, ["add", ".gitattributes"]));
  await run(git.run(path, ["commit", "-m", "Text normalization"]));
  await writeFile(join(path, "source.txt"), "staged\n");
  await run(git.run(path, ["add", "source.txt"]));
  await writeFile(join(path, "source.txt"), "unstaged\n");
  const names = [
    "-leading.txt",
    "space title.txt",
    "line\nbreak.txt",
    "unicode Ω.txt",
    ...Array.from({ length: 70 }, (_, i) => `extra-${i}.txt`),
  ];
  await Promise.all(names.map((name) => writeFile(join(path, name), `line one\r\n${name}\r\n`)));
  await symlink("space title.txt", join(path, "file-link"));
  // Reproduce the persisted algorithm before batching using the actual Git
  // filters, rather than assuming a blob digest from raw filesystem bytes.
  const expected = createHash("sha256")
    .update(await run(git.head(path)))
    .update(await run(git.run(path, ["diff", "--binary"])))
    .update(await run(git.run(path, ["diff", "--cached", "--binary"])));
  const untracked = (await run(git.run(path, ["ls-files", "--others", "--exclude-standard", "-z"])))
    .split("\0")
    .filter(Boolean)
    .sort();
  for (const name of untracked) {
    expected.update(name);
    if ((await lstat(join(path, name))).isSymbolicLink())
      expected.update("symlink:").update(await readlink(join(path, name)));
    else expected.update(await run(git.run(path, ["hash-object", "--", name])));
  }
  let processes = 0;
  const original = git.runner.run.bind(git.runner);
  git.runner.run = (file, args, ...rest) => {
    if (args.includes("hash-object")) processes++;
    return original(file, args, ...rest);
  };
  assert.equal(await run(git.fingerprint(path)), expected.digest("hex"));
  assert.ok(processes <= 2, `74 regular files started ${processes} Git object processes`);
});
