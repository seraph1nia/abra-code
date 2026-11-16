import { test } from "vite-plus/test";
import { nativeTest } from "../e2e/native-fixture.ts";
import { join } from "node:path";

if (!process.env.ABRACODE_TEST_JOURNEY && process.env.ABRACODE_TEST_COMBINED !== "1")
  nativeTest("native product acceptance completes parallel tasks and preserves human gates", {
    journey: "acceptance",
    timeout: 180000,
    evidenceDirectory: process.env.ABRACODE_TEST_EVIDENCE_DIR
      ? join(process.env.ABRACODE_TEST_EVIDENCE_DIR, "acceptance")
      : undefined,
  });
else test.skip("acceptance is covered by the selected combined journey", () => {});
