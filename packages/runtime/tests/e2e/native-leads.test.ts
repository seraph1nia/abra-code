import { test } from "vite-plus/test";
import { nativeTest } from "./native-fixture.ts";
import { join } from "node:path";

if (!process.env.ABRACODE_TEST_JOURNEY && process.env.ABRACODE_TEST_COMBINED !== "1")
  nativeTest("native project lead proposals and replies retain identity across restart", {
    journey: "leads",
    timeout: 120000,
    evidenceDirectory: process.env.ABRACODE_TEST_EVIDENCE_DIR
      ? join(process.env.ABRACODE_TEST_EVIDENCE_DIR, "leads")
      : undefined,
  });
else test.skip("leads is covered by the selected combined journey", () => {});
