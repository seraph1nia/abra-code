import { portableRendererABI as rendererABI } from "@abracode/contracts/presentation/report-export-contract";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { lstat, realpath, readFile, readdir } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { Plugin } from "vite-plus";
import { reportNoticeInputs, type NoticeInventory } from "@abracode/contracts/presentation/notices";

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
    async generateBundle(_options, bundle) {
      const files = new Set<string>();
      const links = new Map<string, string>();
      const pathName = (path: string) => relative(canonical, path).split(sep).join("/");
      async function add(path: string) {
        if (!isAbsolute(path) || !inside(canonical, path) || path.includes(`${sep}.abracode${sep}`))
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
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk") continue;
        for (const id of output.moduleIds) {
          const path = id.split("?")[0]!;
          await add(path);
          const target = isAbsolute(path) ? await packageRoot(path) : undefined;
          if (!target) continue;
          for (const importer of this.getModuleInfo(id)?.importers ?? [])
            await resolution(importer.split("?")[0]!, target);
        }
      }
      for (const id of this.getModuleIds()) await add(id.split("?")[0]!);
      // These directories are explicit @source inputs of the report stylesheet.
      async function styles(directory: string) {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          const path = resolve(directory, entry.name);
          if (entry.isSymbolicLink())
            throw Error("Renderer styles cannot redirect through symlinks");
          if (entry.isDirectory()) await styles(path);
          else if (/\.(?:ts|tsx|css|html)$/.test(entry.name)) await add(path);
        }
      }
      await styles(resolve(canonical, "packages/presentation/src"));
      await styles(resolve(canonical, "apps/report/src"));
      for (const path of [
        "apps/report/vite.config.ts",
        "apps/report/scripts/notices.ts",
        "packages/contracts/src/presentation/notices.ts",
        "packages/contracts/src/presentation/report-export-contract.ts",
        "apps/report/scripts/renderer-manifest.ts",
        "apps/report/scripts/prepare-diagrams.ts",
        "apps/report/scripts/diagrams.ts",
        "apps/report/scripts/preparation.ts",
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
      // Mermaid runs in the separate preparation tool. Its installed dependency
      // closure is a rendering input even when this particular document has no diagram.
      const diagramPackages = new Set<string>();
      async function diagramPackage(entry: string) {
        const target = await packageRoot(entry);
        if (!target || diagramPackages.has(target.root)) return;
        diagramPackages.add(target.root);
        async function sources(directory: string) {
          for (const item of await readdir(directory, { withFileTypes: true })) {
            if (["node_modules", "test", "tests", "docs"].includes(item.name)) continue;
            const path = resolve(directory, item.name);
            if (item.isDirectory()) await sources(path);
            else if (/\.(?:m?js|cjs|css|json|wasm)$/.test(item.name)) await add(path);
          }
        }
        await sources(target.root);
        const manifest = JSON.parse(await readFile(resolve(target.root, "package.json"), "utf8"));
        const require = createRequire(resolve(target.root, "package.json"));
        for (const name of Object.keys({
          ...manifest.dependencies,
          ...manifest.optionalDependencies,
          ...manifest.peerDependencies,
        })) {
          let path: string;
          try {
            path = require.resolve(name);
          } catch {
            continue;
          }
          const child = await packageRoot(path);
          if (child) await resolution(entry, child);
          await diagramPackage(path);
        }
      }
      const diagramEntry = createRequire(resolve(canonical, "apps/report/package.json")).resolve(
        "mermaid",
      );
      const diagramRoot = await packageRoot(diagramEntry);
      if (!diagramRoot) throw Error("Mermaid dependency is unavailable");
      await resolution(resolve(canonical, "apps/report/scripts/mermaid-engine.ts"), diagramRoot);
      await diagramPackage(diagramEntry);
      const notices = reportNoticeInputs(
        JSON.parse(
          await readFile(resolve(canonical, "licenses/inventory.json"), "utf8"),
        ) as NoticeInventory,
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
