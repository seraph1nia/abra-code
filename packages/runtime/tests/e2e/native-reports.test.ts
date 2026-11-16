import { test } from "vite-plus/test";
import { nativeTest } from "./native-fixture.ts";
import { join } from "node:path";

if (!process.env.ABRACODE_TEST_JOURNEY && process.env.ABRACODE_TEST_COMBINED !== "1")
  nativeTest("native saved reports survive export interruption and restart", {
    journey: "reports",
    timeout: 120000,
    evidenceDirectory: process.env.ABRACODE_TEST_EVIDENCE_DIR
      ? join(process.env.ABRACODE_TEST_EVIDENCE_DIR, "reports")
      : undefined,
  });
else test.skip("reports is covered by the selected combined journey", () => {});
