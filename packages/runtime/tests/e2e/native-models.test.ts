import { test } from "vite-plus/test";
import { nativeTest } from "./native-fixture.ts";
import { join } from "node:path";

if (!process.env.ABRACODE_TEST_JOURNEY && process.env.ABRACODE_TEST_COMBINED !== "1")
  nativeTest("native model dispatch retains profiles and refuses unavailable selections", {
    journey: "models",
    timeout: 120000,
    evidenceDirectory: process.env.ABRACODE_TEST_EVIDENCE_DIR
      ? join(process.env.ABRACODE_TEST_EVIDENCE_DIR, "models")
      : undefined,
  });
else test.skip("models is covered by the selected combined journey", () => {});
