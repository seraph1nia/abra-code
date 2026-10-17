import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDiagramRenderer, diagramFiles } from "./diagrams.ts";

const workspace = fileURLToPath(new URL("../", import.meta.url));

async function validate() {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  const paths = args.length ? args.map((path) => resolve(path)) : await diagramFiles(workspace);
  if (!paths.length) {
    console.log("No .mmd diagrams found under templates/reporter/src; nothing to validate.");
    return;
  }
  const sources = await Promise.all(
    paths.map(async (path) => ({
      path: relative(process.cwd(), path),
      source: await readFile(path, "utf8"),
    })),
  );
  const renderer = await createDiagramRenderer();
  try {
    for (const { path, source } of sources) {
      try {
        await renderer.render(source);
        console.log(`OK ${path} (parsed and rendered)`);
      } catch (error) {
        console.error(`FAIL ${path}\n${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      }
    }
  } finally {
    await renderer.close();
  }
}

void validate().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
