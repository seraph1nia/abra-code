import { chromium } from "playwright";

export async function launchReportBrowser() {
  try {
    return await chromium.launch({
      channel: "chromium",
      executablePath: process.env.REPORT_CHROMIUM_PATH,
    });
  } catch (cause) {
    throw new Error(
      `Could not launch report Chromium. Run pnpm report:browser:install, or set REPORT_CHROMIUM_PATH to a compatible Chromium executable.\n${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
}
