import { chromium } from "playwright";

/** Resolve before a fixture isolates XDG_CACHE_HOME; never provisions a browser. */
export const reportBrowserExecutable = () =>
  process.env.REPORT_CHROMIUM_PATH ?? chromium.executablePath();

export async function launchReportBrowser() {
  try {
    return await chromium.launch({
      channel: "chromium",
      executablePath: reportBrowserExecutable(),
    });
  } catch (cause) {
    throw new Error(
      `Could not launch report Chromium. Run pnpm report:browser:install, or set REPORT_CHROMIUM_PATH to a compatible Chromium executable.\n${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
}
