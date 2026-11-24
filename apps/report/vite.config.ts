import { reportNotices } from "./scripts/notices.ts";
import { rendererManifest } from "./scripts/renderer-manifest.ts";
import { resolve } from "node:path";
import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export function exportConfiguration(
  options: {
    installationRoot?: string;
    cacheDir?: string;
    preparedDiagrams?: string;
    portableShell?: boolean;
  } = {},
) {
  const root = options.installationRoot ?? resolve(import.meta.dirname, "../..");
  return defineConfig({
    ...(options.cacheDir ? { cacheDir: options.cacheDir } : {}),
    resolve: {
      alias: {
        "@report/prepared-diagrams":
          options.preparedDiagrams ?? resolve(root, "apps/report/src/prepared-diagrams.ts"),
      },
      dedupe: ["react", "react-dom", "effect"],
    },
    plugins: [
      ...(options.portableShell ? [rendererManifest(root)] : []),
      {
        name: "saved-report-notices",
        transformIndexHtml() {
          const notices = reportNotices(root);
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
