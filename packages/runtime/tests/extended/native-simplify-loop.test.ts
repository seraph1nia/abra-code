import { test } from "vite-plus/test";
import { nativeTest } from "../e2e/native-fixture.ts";
import { join } from "node:path";

if (!process.env.ABRACODE_TEST_JOURNEY && process.env.ABRACODE_TEST_COMBINED !== "1")
  nativeTest(
    "compact routine continuation retains human gates and finite corrections across restart",
    {
      journey: "simplify-loop",
      timeout: 420000,
      evidenceDirectory: process.env.ABRACODE_TEST_EVIDENCE_DIR
        ? join(process.env.ABRACODE_TEST_EVIDENCE_DIR, "simplify-loop")
        : undefined,
    },
  );
else test.skip("simplify-loop is covered by the selected combined journey", () => {});
