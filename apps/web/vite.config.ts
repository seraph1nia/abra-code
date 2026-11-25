import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { developmentConfig } from "./development.ts";
import { defineConfig } from "vite-plus";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { workCatalogDocument } from "@abracode/contracts/web/catalog";

const development = developmentConfig();

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  define: { "process.env.COPILOTKIT_TELEMETRY_DISABLED": JSON.stringify("true") },
  server: development.server,
  build: { outDir: "dist", emptyOutDir: true },
  plugins: [
    development.boundary,
    react(),
    tailwindcss(),
    {
      name: "abra-web-notices",
      generateBundle(_options, bundle) {
        const modules = Object.values(bundle).flatMap((output) =>
          output.type === "chunk" ? Object.keys(output.modules) : [],
        );
        const leaked = modules.filter((id) =>
          /apps\/report\/scripts\/(?:mermaid-engine|diagrams|preparation)\.ts/.test(id),
        );
        if (leaked.length)
          throw new Error(
            "Report diagram compiler leaked into browser bundle: " + leaked.join(", "),
          );
        this.emitFile({
          type: "asset",
          fileName: "diagram-boundary.json",
          source: JSON.stringify({
            report_compiler: "server-only",
            inspected_modules: modules.length,
            leaked,
            existing_chat_markdown: "preserved",
          }),
        });
        this.emitFile({
          type: "asset",
          fileName: "catalog/work/v1/catalog.json",
          source: JSON.stringify(workCatalogDocument, null, 2) + "\n",
        });
        const root = fileURLToPath(new URL("../../", import.meta.url));
        const inventory = JSON.parse(
          readFileSync(join(root, "licenses/inventory.json"), "utf8"),
        ) as {
          packages: {
            id: string;
            license: string;
            author: unknown;
            uses: string[];
            evidence: { sha256: string }[];
          }[];
        };
        const notices = inventory.packages
          .filter((p) => p.uses.includes("web-client"))
          .map((p) =>
            [
              p.id,
              `License: ${p.license}`,
              `Supplier attribution: ${JSON.stringify(p.author)}`,
              ...p.evidence.map((e) =>
                readFileSync(join(root, `licenses/texts/${e.sha256}.txt`), "utf8"),
              ),
            ].join("\n"),
          )
          .join("\n\n----------------------------------------\n\n");
        this.emitFile({
          type: "asset",
          fileName: "THIRD_PARTY_NOTICES.txt",
          source: `AbraCode — MIT\nThird-party components retain their supplier terms.\n\nshadcn/ui component source (adapted imports and formatting):\n${readFileSync(join(root, "licenses/shadcn-ui.txt"), "utf8")}\n\n${notices}`,
        });
      },
    },
  ],
});
