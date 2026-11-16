import { nativeTest } from "../e2e/native-fixture.ts";
import { join } from "node:path";

nativeTest(
  "real v2 server loads tools and guards across three repositories, executes full OpenSpec through native worker sessions, approvals, preserved branch, cleanup and durable restart",
);
if (!process.env.ABRACODE_TEST_JOURNEY && process.env.ABRACODE_TEST_COMBINED === "1")
  nativeTest("single CopilotKit workspace implements work through native approvals and delivery", {
    journey: "workspace",
    timeout: 180000,
    evidenceDirectory: process.env.ABRACODE_TEST_EVIDENCE_DIR
      ? join(process.env.ABRACODE_TEST_EVIDENCE_DIR, "workspace")
      : undefined,
  });
if (!process.env.ABRACODE_TEST_JOURNEY && process.env.ABRACODE_TEST_COMBINED === "1")
  nativeTest("required worker and lead replies recover once across native restart", {
    journey: "reply-recovery",
    timeout: 120000,
    evidenceDirectory: process.env.ABRACODE_TEST_EVIDENCE_DIR
      ? join(process.env.ABRACODE_TEST_EVIDENCE_DIR, "reply-recovery")
      : undefined,
  });
if (!process.env.ABRACODE_TEST_JOURNEY && process.env.ABRACODE_TEST_OPERATIONAL === "1")
  nativeTest("communication commits survive receipt loss at isolated crash windows", {
    journey: "crash-windows",
    timeout: 180000,
    evidenceDirectory: process.env.ABRACODE_TEST_EVIDENCE_DIR
      ? join(process.env.ABRACODE_TEST_EVIDENCE_DIR, "crash-windows")
      : undefined,
  });

if (!process.env.ABRACODE_TEST_JOURNEY && process.env.ABRACODE_TEST_COMBINED === "1")
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
