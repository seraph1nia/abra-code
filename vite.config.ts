import { recommended } from "@effect/tsgo/oxlint-presets";
import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {},
  lint: {
    extends: [recommended],
    ignorePatterns: [".abracode/**", ".lavish/**", "**/dist/**"],
    overrides: [
      {
        files: [
          "templates/reporter/src/**/*.{ts,tsx}",
          "templates/reporter/scripts/mermaid-engine.ts",
        ],
        env: { browser: true, node: false },
      },
    ],
    options: {
      typeAware: true,
      typeCheck: false,
    },
  },
  test: {
    maxWorkers: 1,
    environment: "node",
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["tests/unit/**/*.test.ts"] },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          testTimeout: 30_000,
        },
      },
      {
        extends: true,
        test: {
          name: "e2e",
          include: ["tests/e2e/**/*.test.ts"],
          testTimeout: 120_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
  pack: {
    entry: {
      abracode: "./.opencode/plugins/abracode/index.ts",
      "abracode-tui": "./.opencode/plugins/abracode/tui.ts",
    },
    platform: "node",
    target: "node24",
    format: "esm",
    dts: false,
    sourcemap: true,
    deps: { neverBundle: true },
  },
});
