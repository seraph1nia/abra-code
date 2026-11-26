import { test as baseTest, beforeAll, afterAll } from "vite-plus/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { launchReportBrowser } from "@abracode/report-export/browser";
import { workspaceBrowserFixture } from "./workspace-browser.ts";
export const test = baseTest.concurrent;
let browser: Awaited<ReturnType<typeof launchReportBrowser>>;
beforeAll(async () => {
  browser = await launchReportBrowser();
});
afterAll(async () => {
  await browser?.close();
});
export const fixture = () => workspaceBrowserFixture(browser);
type BrowserPage = Awaited<ReturnType<Awaited<ReturnType<typeof launchReportBrowser>>["newPage"]>>;
export async function screenshot(page: BrowserPage, name: string) {
  const evidence = process.env.ABRACODE_TEST_EVIDENCE_DIR;
  if (!evidence) return;
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: join(evidence, name), fullPage: true, animations: "disabled" });
}
