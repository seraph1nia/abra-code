import react from "@vitejs/plugin-react";
import { developmentConfig } from "./development.ts";
import { defineConfig } from "vite-plus";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const development = developmentConfig();

export default defineConfig({
  server: development.server,
  build: { outDir: "dist", emptyOutDir: true },
  plugins: [
    development.boundary,
    react(),
    {
      name: "abra-web-notices",
      generateBundle() {
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
          source: `AbraCode — MIT\nThird-party components retain their supplier terms.\n\n${notices}`,
        });
      },
    },
  ],
});
