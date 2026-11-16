import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import type { Plugin } from "vite-plus";
import { createDiagramRenderer, diagramFiles } from "./diagrams.ts";

export function mermaidDiagrams(options: { cacheDir?: string } = {}): Plugin {
  let root: string;
  let building = false;
  let renderer: ReturnType<typeof createDiagramRenderer> | undefined;
  const prepared = new Map<string, { source: string; svg: string }>();

  async function prepare(path: string) {
    const source = await readFile(path, "utf8");
    const cached = prepared.get(path);
    if (cached?.source === source) return cached;
    try {
      renderer ??= createDiagramRenderer(options);
      const svg = await (await renderer).render(source);
      const diagram = { source, svg };
      prepared.set(path, diagram);
      return diagram;
    } catch (cause) {
      throw new Error(
        `FAIL ${relative(root, path)}\n${cause instanceof Error ? cause.message : String(cause)}`,
        { cause },
      );
    }
  }

  async function close() {
    const pending = renderer;
    renderer = undefined;
    if (pending)
      await pending.then(
        (active) => active.close(),
        () => {},
      );
  }

  return {
    name: "report-mermaid-svg",
    enforce: "pre",
    configResolved(config) {
      root = config.root;
      building = config.command === "build";
    },
    async buildStart() {
      // Validate/render once, then reuse the SVGs when imported modules load.
      // Checking unused sources preserves the report build's validation gate.
      if (building) {
        for (const path of await diagramFiles(root)) {
          this.addWatchFile(path);
          await prepare(path);
        }
      }
    },
    async load(id) {
      if (!id.endsWith(".mmd")) return;
      this.addWatchFile(id);
      return { code: `export default ${JSON.stringify(await prepare(id))};`, map: null };
    },
    async buildEnd() {
      await close();
    },
    async closeBundle() {
      await close();
    },
  };
}
