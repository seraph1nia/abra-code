import { test } from "vite-plus/test";
import { nativeTest } from "./native-fixture.ts";
import { join } from "node:path";

if (!process.env.ABRACODE_TEST_JOURNEY && process.env.ABRACODE_TEST_COMBINED !== "1")
  nativeTest(
    "native PR feedback, exact merge authorization and residue preservation survive restart",
    {
      journey: "finishing",
      timeout: 180000,
      evidenceDirectory: process.env.ABRACODE_TEST_EVIDENCE_DIR
        ? join(process.env.ABRACODE_TEST_EVIDENCE_DIR, "finishing")
        : undefined,
    },
  );
else test.skip("finishing is covered by the selected combined journey", () => {});
