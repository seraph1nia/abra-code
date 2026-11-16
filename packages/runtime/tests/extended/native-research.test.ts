import { test } from "vite-plus/test";
import { nativeTest } from "../e2e/native-fixture.ts";
import { join } from "node:path";

if (!process.env.ABRACODE_TEST_JOURNEY && process.env.ABRACODE_TEST_COMBINED !== "1")
  nativeTest("native research findings, lightweight repair and unavailable proof survive restart", {
    journey: "research",
    timeout: 180000,
    evidenceDirectory: process.env.ABRACODE_TEST_EVIDENCE_DIR
      ? join(process.env.ABRACODE_TEST_EVIDENCE_DIR, "research")
      : undefined,
  });
else test.skip("research is covered by the selected combined journey", () => {});
