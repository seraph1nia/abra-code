import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { mermaidDiagrams } from "./scripts/mermaid-plugin.ts";

export function exportConfiguration(
  options: { installationRoot?: string; cacheDir?: string; preparedDiagrams?: string } = {},
) {
  const root = options.installationRoot ?? resolve(import.meta.dirname, "../..");
  return defineConfig({
    ...(options.cacheDir ? { cacheDir: options.cacheDir } : {}),
    resolve: {
      alias: {
        "@": resolve(root, "apps/web/src"),
        "@report/prepared-diagrams":
          options.preparedDiagrams ?? resolve(root, "apps/report/src/prepared-diagrams.ts"),
      },
      dedupe: ["react", "react-dom", "effect", "@a2ui/web_core"],
    },
    plugins: [
      {
        name: "saved-report-notices",
        transformIndexHtml() {
          const inventory = JSON.parse(
            readFileSync(resolve(root, "licenses/inventory.json"), "utf8"),
          ) as {
            packages: {
              id: string;
              license: string;
              author: unknown;
              uses: string[];
              evidence: { sha256: string }[];
            }[];
          };
          const notices = {
            project: readFileSync(resolve(root, "LICENSE"), "utf8"),
            shadcn: readFileSync(resolve(root, "licenses/shadcn-ui.txt"), "utf8"),
            dependencies: inventory.packages
              .filter((item) => item.uses.includes("report-artifact"))
              .map((item) => ({
                id: item.id,
                license: item.license,
                author: item.author,
                notices: item.evidence.map((evidence) =>
                  readFileSync(resolve(root, `licenses/texts/${evidence.sha256}.txt`), "utf8"),
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
      mermaidDiagrams({
        cacheDir: options.cacheDir ? resolve(options.cacheDir, "mermaid") : undefined,
      }),
      react(),
      tailwindcss(),
      viteSingleFile(),
      {
        name: "offline-capability-boundary",
        renderChunk(_code, chunk) {
          const forbidden = chunk.moduleIds.filter((id) =>
            /@copilotkit|@tanstack[+/]react-router|\/apps\/web\/src\/(?:data|api|use-workspace)\.ts|\/src\/(?:opencode\/runtime|web\/(?:backend|gateway|server))\.ts/.test(
              id,
            ),
          );
          if (forbidden.length)
            throw new Error(
              `Offline export imported live application capabilities: ${forbidden.join(", ")}`,
            );
          return null;
        },
      } satisfies import("vite-plus").Plugin,
    ],
    publicDir: false,
    build: { sourcemap: false, modulePreload: false },
    server: { host: "127.0.0.1", port: 5174, strictPort: true },
    preview: { host: "127.0.0.1", port: 4174, strictPort: true },
  });
}
