type ChromiumBrowserType = typeof import("playwright").chromium;

/** Resolve before a fixture isolates XDG_CACHE_HOME; never provisions a browser. */
export const browserExecutable = (chromium: ChromiumBrowserType) =>
  process.env.REPORT_CHROMIUM_PATH ?? chromium.executablePath();

export async function launchBrowser(chromium: ChromiumBrowserType) {
  try {
    return await chromium.launch({
      channel: "chromium",
      executablePath: browserExecutable(chromium),
    });
  } catch (cause) {
    throw new Error(
      `Could not launch report Chromium. Run pnpm report:browser:install, or set REPORT_CHROMIUM_PATH to a compatible Chromium executable.\n${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
}
