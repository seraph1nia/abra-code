import { removeFixture } from "./helpers/resources.ts";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Immutable seed only. Every test receives private Git metadata and a private remote. */
export default async function setup() {
  const parent = process.env.ABRACODE_TEST_INSTALL_ROOT ?? tmpdir();
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "abra-git-seed-"));
  const repository = join(root, "repository");
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" });
  try {
    await mkdir(join(repository, "openspec"), { recursive: true });
    await writeFile(join(repository, "source.txt"), "original\n");
    await writeFile(join(repository, "openspec/config.yaml"), "schema: spec-driven\n");
    git(repository, "init", "-b", "main");
    git(repository, "config", "user.email", "fixture@example.invalid");
    git(repository, "config", "user.name", "Fixture");
    git(repository, "add", ".");
    git(repository, "commit", "-m", "Initial");
    git(root, "clone", "--bare", "--no-hardlinks", repository, join(root, "remote.git"));
    process.env.ABRACODE_TEST_REPOSITORY_SEED = root;
    // Many independent compilers can run together. Bound their internal Rayon
    // pools as well as file workers to avoid an 8 x CPU-count startup burst.
    const previousRayon = process.env.RAYON_NUM_THREADS;
    process.env.RAYON_NUM_THREADS ??= "2";
    return async () => {
      if (previousRayon === undefined) delete process.env.RAYON_NUM_THREADS;
      if (process.env.ABRACODE_TEST_REPOSITORY_SEED === root)
        delete process.env.ABRACODE_TEST_REPOSITORY_SEED;
      await removeFixture(root);
    };
  } catch (error) {
    await removeFixture(root);
    throw error;
  }
}
