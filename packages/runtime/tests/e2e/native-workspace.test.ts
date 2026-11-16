import { test } from "vite-plus/test";
import { nativeTest } from "./native-fixture.ts";
import { join } from "node:path";

if (!process.env.ABRACODE_TEST_JOURNEY && process.env.ABRACODE_TEST_COMBINED !== "1")
  nativeTest("single CopilotKit workspace implements work through native approvals and delivery", {
    journey: "workspace",
    timeout: 180000,
    evidenceDirectory: process.env.ABRACODE_TEST_EVIDENCE_DIR
      ? join(process.env.ABRACODE_TEST_EVIDENCE_DIR, "workspace")
      : undefined,
  });
else test.skip("workspace is covered by the selected combined journey", () => {});
