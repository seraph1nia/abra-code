import { readdir } from "node:fs/promises";
import { join } from "node:path";

/** Explicit Tailwind source trees, including newly added source files. */
export async function rendererStyleInputs(root: string) {
  const files: string[] = [];
  async function visit(directory: string) {
    for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
      if (entry.name === ".abracode") continue;
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw Error("Renderer styles cannot redirect through symlinks");
      if (entry.isDirectory()) await visit(path);
      else if (/\.(?:ts|tsx|css|html)$/.test(entry.name)) files.push(path);
    }
  }
  await visit("packages/presentation/src");
  await visit("apps/report/src");
  return files;
}
