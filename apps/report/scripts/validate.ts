import { glob, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { diagramPreparer } from "./preparation.ts";

const workspace = fileURLToPath(new URL("../", import.meta.url));

async function diagramFiles(root: string) {
  const paths: string[] = [];
  for await (const path of glob("**/*.mmd", { cwd: resolve(root, "src") })) {
    paths.push(resolve(root, "src", path));
  }
  return paths.sort();
}

async function validate() {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  const paths = args.length ? args.map((path) => resolve(path)) : await diagramFiles(workspace);
  if (!paths.length) {
    console.log("No .mmd diagrams found under apps/report/src; nothing to validate.");
    return;
  }
  const sources = await Promise.all(
    paths.map(async (path) => ({
      path: relative(process.cwd(), path),
      source: await readFile(path, "utf8"),
    })),
  );
  const prepared = await diagramPreparer.prepare(
    sources.map((value, index) => ({ id: `file-${index}`, source: value.source })),
  );
  for (const [index, result] of prepared.results.entries()) {
    if (result.status === "verified")
      console.log(`OK ${sources[index]!.path} (parsed and rendered)`);
    else {
      console.error(`FAIL ${sources[index]!.path}\n${result.message}`);
      process.exitCode = 1;
    }
  }
  if (!prepared.verified) process.exitCode = 1;
}

void validate().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
