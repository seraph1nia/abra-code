import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite-plus";
import solid from "vite-plugin-solid";
import { viteSingleFile } from "vite-plugin-singlefile";
import { mermaidDiagrams } from "./scripts/mermaid-plugin.ts";

export default defineConfig({
  plugins: [
    {
      name: "distributed-license-notices",
      transformIndexHtml() {
        const root = resolve(import.meta.dirname, "../..");
        const inventory = JSON.parse(
          readFileSync(resolve(root, "licenses/inventory.json"), "utf8"),
        ) as {
          packages: Array<{
            id: string;
            license: string;
            author: unknown;
            uses: string[];
            evidence: Array<{ sha256: string }>;
          }>;
        };
        const notices = {
          project: readFileSync(resolve(root, "LICENSE"), "utf8"),
          dependencies: inventory.packages
            .filter((p) => p.uses.includes("report-artifact"))
            .map((p) => ({
              id: p.id,
              license: p.license,
              author: p.author,
              notices: p.evidence.map((e) =>
                readFileSync(resolve(root, `licenses/texts/${e.sha256}.txt`), "utf8"),
              ),
            })),
        };
        return [
          {
            tag: "script",
            attrs: { type: "application/json", id: "abracode-license-notices" },
            children: JSON.stringify(notices).replaceAll("<", "\\u003c"),
            injectTo: "body",
          },
        ];
      },
    },
    mermaidDiagrams(),
    solid(),
    viteSingleFile(),
    {
      name: "require-report-build",
      // Vite's CLI-only missing-directory check does not run through the Vite+ alias.
      configurePreviewServer(server) {
        const artifact = resolve(server.config.root, server.config.build.outDir, "index.html");
        if (!existsSync(artifact)) {
          throw new Error(
            `Report build does not exist at ${artifact}. Run pnpm report:build first.`,
          );
        }
      },
    },
  ],
  publicDir: false,
  build: { sourcemap: false, modulePreload: false },
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true },
});
