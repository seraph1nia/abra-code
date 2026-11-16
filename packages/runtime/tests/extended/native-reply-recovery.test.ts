import { test } from "vite-plus/test";
import { nativeTest } from "../e2e/native-fixture.ts";
import { join } from "node:path";

if (!process.env.ABRACODE_TEST_JOURNEY && process.env.ABRACODE_TEST_COMBINED !== "1")
  nativeTest("required worker and lead replies recover once across native restart", {
    journey: "reply-recovery",
    timeout: 120000,
    evidenceDirectory: process.env.ABRACODE_TEST_EVIDENCE_DIR
      ? join(process.env.ABRACODE_TEST_EVIDENCE_DIR, "reply-recovery")
      : undefined,
  });
else test.skip("reply-recovery is covered by the selected combined journey", () => {});
