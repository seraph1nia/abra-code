import { chromium } from "playwright";
import { browserExecutable, launchBrowser } from "./browser-launch.ts";
export const reportBrowserExecutable = () => browserExecutable(chromium);
export const launchReportBrowser = () => launchBrowser(chromium);
