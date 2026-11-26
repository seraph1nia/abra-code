import { portableRendererABI as rendererABI } from "@abracode/contracts/presentation/report-export-contract";
import { createHash } from "node:crypto";
import { lstat, realpath, readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { rendererStyleInputs } from "./renderer-styles.ts";
import { build, type Plugin } from "vite-plus";
import { reportNoticeInputs } from "@abracode/contracts/presentation/notices";
import { decodeNoticeInventory } from "./notices.ts";

export { portableRendererABI as rendererABI } from "@abracode/contracts/presentation/report-export-contract";
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const inside = (root: string, path: string) => {
  const name = relative(root, path);
  return name !== ".." && !name.startsWith(`..${sep}`) && !isAbsolute(name);
};
/** Compiler evidence records compiler modules, explicit style inputs and actual
 * package links. It deliberately excludes the unrelated backend and lockfile. */
export function rendererManifest(installation: string): Plugin {
  let canonical: string;
  return {
    name: "portable-renderer-inputs",
    async buildStart() {
      canonical = await realpath(installation);
    },
    async generateBundle() {
      const files = new Set<string>();
      const links = new Map<string, string>();
      const pathName = (path: string) => relative(canonical, path).split(sep).join("/");
      async function add(path: string) {
        if (
          !isAbsolute(path) ||
          !inside(canonical, path) ||
          relative(canonical, path).split(sep).includes(".abracode")
        )
          return;
        const info = await lstat(path).catch(() => undefined);
        if (!info?.isFile()) return;
        const actual = await realpath(path);
        if (!inside(canonical, actual))
          throw Error("Renderer input escapes its source installation");
        files.add(actual);
        if (files.size > 8192) throw Error("Renderer input count exceeds 8192");
      }
      async function packageRoot(
        path: string,
      ): Promise<{ root: string; name: string } | undefined> {
        if (!isAbsolute(path)) return;
        for (
          let directory = dirname(path);
          inside(canonical, directory);
          directory = dirname(directory)
        ) {
          try {
            const text = await readFile(resolve(directory, "package.json"), "utf8");
            const value = JSON.parse(text);
            if (typeof value.name === "string") {
              await add(resolve(directory, "package.json"));
              return { root: directory, name: value.name };
            }
          } catch {
            /* Modules inside a package need not have a nearer manifest. */
          }
          if (directory === canonical) break;
        }
      }
      async function resolution(importer: string, target: { root: string; name: string }) {
        for (
          let directory = dirname(importer);
          inside(canonical, directory);
          directory = dirname(directory)
        ) {
          const path = resolve(directory, "node_modules", target.name);
          const actual = await realpath(path).catch(() => undefined);
          if (actual) {
            if (actual === target.root) links.set(pathName(path), pathName(actual));
            return;
          }
          if (directory === canonical) break;
        }
      }
      async function moduleInput(id: string, importers: readonly string[]) {
        const path = id.split("?")[0]!;
        await add(path);
        const target = isAbsolute(path) ? await packageRoot(path) : undefined;
        if (target)
          for (const importer of importers) await resolution(importer.split("?")[0]!, target);
      }
      for (const id of this.getModuleIds())
        await moduleInput(id, this.getModuleInfo(id)?.importers ?? []);
      // Compile both sides of the diagram worker while the installation is being prepared.
      // Export receives the resulting bytes and supplies only the Chromium launcher.
      for (const [entry, format, fileName] of [
        ["mermaid-engine.ts", "iife", "diagram-engine.js"],
        ["prepared-diagram-host.ts", "cjs", "diagram-host.cjs"],
      ] as const) {
        const result = await build({
          root: resolve(canonical, "apps/report"),
          configFile: false,
          publicDir: false,
          logLevel: "error",
          plugins: [
            {
              name: "diagram-renderer-inputs",
              async generateBundle() {
                for (const id of this.getModuleIds())
                  await moduleInput(id, this.getModuleInfo(id)?.importers ?? []);
              },
            },
          ],
          build: {
            write: false,
            target: "esnext",
            minify: true,
            lib: {
              entry: resolve(canonical, "apps/report/scripts", entry),
              formats: [format],
              name: "AbraDiagram",
            },
            rolldownOptions: { external: ["node:crypto"], output: { codeSplitting: false } },
          },
        });
        const outputs = (Array.isArray(result) ? result : [result]).flatMap((output) =>
          "output" in output ? output.output : [],
        );
        const chunks = outputs.filter((output) => output.type === "chunk");
        if (chunks.length !== 1 || outputs.some((output) => output.type === "asset"))
          throw Error("Diagram worker must compile to one self-contained module per entry");
        this.emitFile({ type: "asset", fileName, source: chunks[0]!.code });
      }
      for (const path of await rendererStyleInputs(canonical)) await add(resolve(canonical, path));
      for (const path of [
        "apps/report/vite.config.ts",
        "apps/report/scripts/notices.ts",
        "packages/contracts/src/presentation/notices.ts",
        "packages/contracts/src/presentation/report-export-contract.ts",
        "apps/report/scripts/renderer-manifest.ts",
        "apps/report/scripts/renderer-cache.ts",
        "apps/report/scripts/renderer-styles.ts",
        "apps/report/scripts/diagrams.ts",
        "apps/report/scripts/preparation.ts",
        "apps/report/scripts/diagram-batch.ts",
        "apps/report/scripts/prepared-diagram-host.ts",
        "packages/contracts/src/presentation/diagrams.ts",
        "apps/report/scripts/mermaid-engine.ts",
        "apps/report/scripts/browser.ts",
        "apps/report/index.html",
        "LICENSE",
        "licenses/shadcn-ui.txt",
      ])
        await add(resolve(canonical, path));
      for (const path of [
        "node_modules/vite-plus",
        "apps/report/node_modules/@vitejs/plugin-react",
        "apps/report/node_modules/@tailwindcss/vite",
        "apps/report/node_modules/vite-plugin-singlefile",
      ]) {
        const full = resolve(canonical, path),
          actual = await realpath(full);
        if (!inside(canonical, actual))
          throw Error("Renderer tool resolves outside its installation");
        links.set(path, pathName(actual));
        await add(resolve(actual, "package.json"));
      }
      const notices = reportNoticeInputs(
        decodeNoticeInventory(
          await readFile(resolve(canonical, "licenses/inventory.json"), "utf8"),
        ),
      );
      for (const item of notices)
        for (const sha of item.evidence) {
          if (!/^[a-f0-9]{64}$/.test(sha)) throw Error("Invalid notice digest");
          await add(resolve(canonical, `licenses/texts/${sha}.txt`));
        }
      let bytes = 0;
      const inputs = [];
      for (const file of [...files].sort()) {
        const stat = await lstat(file);
        bytes += stat.size;
        if (bytes > 128 * 1024 * 1024) throw Error("Renderer inputs exceed 128 MiB");
        inputs.push({ file: pathName(file), hash: hash(await readFile(file)) });
      }
      const manifest = {
        abi: rendererABI,
        inputs,
        links: [...links].sort(([a], [b]) => a.localeCompare(b)),
        notices_hash: hash(JSON.stringify(notices)),
      };
      this.emitFile({
        type: "asset",
        fileName: "renderer-inputs.json",
        source: JSON.stringify(manifest),
      });
    },
  };
}
