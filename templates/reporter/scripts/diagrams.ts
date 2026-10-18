import { glob } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite-plus";
import { launchReportBrowser } from "./browser.ts";

export async function diagramFiles(root: string) {
  const paths: string[] = [];
  for await (const path of glob("**/*.mmd", { cwd: resolve(root, "src") })) {
    paths.push(resolve(root, "src", path));
  }
  return paths.sort();
}

export async function createDiagramRenderer(options: { cacheDir?: string } = {}) {
  // Separate from the report's Vite config: loading the engine must not recurse
  // into the .mmd build plugin or include this tooling in the report bundle.
  const server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL("../", import.meta.url)),
    appType: "custom",
    cacheDir:
      options.cacheDir ??
      fileURLToPath(
        new URL(
          `../node_modules/.vite-mermaid/${process.env.NODE_ENV ?? "development"}`,
          import.meta.url,
        ),
      ),
    logLevel: "error",
    optimizeDeps: { noDiscovery: true, include: ["mermaid"] },
    server: { host: "127.0.0.1", port: 0, strictPort: false, open: false },
  });
  let browser: Awaited<ReturnType<typeof launchReportBrowser>> | undefined;
  const close = async () => {
    try {
      await browser?.close();
    } finally {
      await server.close();
    }
  };
  try {
    server.middlewares.use("/__diagram-rendering", (_req, res) => {
      res.setHeader("Content-Type", "text/html");
      res.end(
        '<!doctype html><html><head><link rel="icon" href="data:,"></head><body></body></html>',
      );
    });
    await server.listen();
    browser = await launchReportBrowser();
    const page = await browser.newPage();
    await page.goto(`${server.resolvedUrls!.local[0]}__diagram-rendering`);
    return {
      render(source: string): Promise<string> {
        return page.evaluate(
          async ({ moduleUrl, source }) => {
            const { renderDiagram } = await import(moduleUrl);
            return renderDiagram(source);
          },
          { moduleUrl: "/scripts/mermaid-engine.ts", source },
        );
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
