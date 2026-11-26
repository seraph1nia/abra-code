import { createHash } from "node:crypto";
import {
  captureText,
  captureRegularFile,
  ManifestJSON,
  PointerJSON,
  readPreparedBundle,
} from "./renderer-cache.ts";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Schema } from "effect";
import { chromium } from "playwright";
import { createServer } from "vite-plus";
import { launchReportBrowser } from "./browser.ts";
import { createEngineScriptRenderer } from "./prepared-diagram-host.ts";

const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

/** Reuse the prepared diagram-engine.js bundle when present and current for local engine sources. */
async function loadPreparedEngineScript(): Promise<string | undefined> {
  const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
  const rendererRoot = join(repoRoot, ".abracode/reports/renderers/v4");
  try {
    const pointer = Schema.decodeResult(PointerJSON)(
      await captureText(join(rendererRoot, "current.json"), 4096),
    );
    if (pointer._tag === "Failure") return undefined;
    const bundle = await readPreparedBundle(rendererRoot, pointer.success.fingerprint);
    const manifest = Schema.decodeResult(ManifestJSON)(bundle.manifest);
    if (manifest._tag === "Failure") return undefined;
    const hashes = new Map<string, string>(
      manifest.success.inputs.map((entry) => [entry.file, entry.hash]),
    );
    for (const file of [
      "apps/report/scripts/mermaid-engine.ts",
      "packages/presentation/src/diagram-svg.ts",
      "packages/contracts/src/presentation/diagrams.ts",
    ]) {
      const expected = hashes.get(file);
      if (!expected) return undefined;
      const actual = sha256(
        (await captureRegularFile(resolve(repoRoot, file), 16 * 1024 * 1024)).buffer,
      );
      if (actual !== expected) return undefined;
    }
    return bundle.engine;
  } catch {
    return undefined;
  }
}

export async function createDiagramRenderer(options: { cacheDir?: string } = {}) {
  const preparedScript = await loadPreparedEngineScript();
  if (preparedScript) return createEngineScriptRenderer(preparedScript, chromium);

  // Fallback when no current prepared diagram-engine.js is available yet.
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
    let blocked = false;
    await page.route("**/*", (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const origin = new URL(server.resolvedUrls!.local[0]!).origin;
      if (url.origin === origin && ["document", "script"].includes(request.resourceType()))
        return route.continue();
      blocked = true;
      return route.abort();
    });
    await page.goto(`${server.resolvedUrls!.local[0]}__diagram-rendering`);
    await page.evaluate(
      'import("/scripts/mermaid-engine.ts").then(module => { globalThis.__abracodeRenderDiagram = module.renderDiagram; })',
    );
    return {
      async render(source: string): Promise<string> {
        blocked = false;
        const svg = await page.evaluate(
          (source) =>
            (
              Reflect.get(globalThis, "__abracodeRenderDiagram") as (
                source: string,
              ) => Promise<string>
            )(source),
          source,
        );
        if (blocked) throw new Error("FORBIDDEN: Diagram attempted a resource request");
        return svg;
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
