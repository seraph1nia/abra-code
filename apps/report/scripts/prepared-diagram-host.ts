import { DiagramBatch } from "./diagram-batch.ts";
import { launchBrowser } from "./browser-launch.ts";

export async function createEngineScriptRenderer(
  script: string,
  chromium: Parameters<typeof launchBrowser>[0],
) {
  const browser = await launchBrowser(chromium);
  try {
    const page = await browser.newPage();
    let blocked = false;
    await page.route("**/*", (route) => {
      blocked = true;
      return route.abort();
    });
    await page.setContent("<!doctype html><body></body>");
    await page.addScriptTag({ content: script });
    return {
      async render(source: string) {
        blocked = false;
        const svg = await page.evaluate(
          (source) =>
            (
              Reflect.get(globalThis, "AbraDiagram") as {
                renderDiagram(source: string): Promise<string>;
              }
            ).renderDiagram(source),
          source,
        );
        if (blocked) throw new Error("FORBIDDEN: Diagram attempted a resource request");
        return svg;
      },
      close: () => browser.close(),
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

export function createPreparedDiagrams(
  compiler: string,
  script: string,
  chromium: Parameters<typeof launchBrowser>[0],
) {
  return new DiagramBatch({
    compiler,
    factory: () => createEngineScriptRenderer(script, chromium),
  });
}
