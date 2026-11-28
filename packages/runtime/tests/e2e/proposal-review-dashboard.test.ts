import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "vite-plus/test";
import { Fingerprint, ObligationKey } from "@abracode/contracts/identities";
import type { ProposalReviewView } from "@abracode/contracts/visibility/proposal-review";
import { workspaceBrowserFixture } from "../helpers/workspace-browser.ts";

test("Plan findings render historical evidence and only expose decisions for the current plan", async (t) => {
  const f = await workspaceBrowserFixture();
  t.onTestFinished(f.close);
  const work = f.source.value.work.work[0]!;
  const old: ProposalReviewView = {
    issue_id: work.issue_id,
    fingerprint: Fingerprint.make("a".repeat(64)),
    path: "proposal.md",
    current: false,
    status: "completed",
    report: {
      reading: "Original reading for A",
      findings: [
        {
          owner: "planner",
          question: "Clarify rollback",
          evidence: "Section 2 allows a partial rollback",
        },
      ],
    },
    decisions: [],
  };
  const current: ProposalReviewView = {
    ...old,
    fingerprint: Fingerprint.make("b".repeat(64)),
    current: true,
    status: "unavailable",
    report: undefined,
    reason: "Model offline",
    decisions: [
      { key: ObligationKey.make("retry-review"), generation: 2, label: "Retry review or continue" },
    ],
  };
  f.detailOverrides.set(work.issue_id, { proposal_reviews: [old, current] });
  const page = await f.browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(8000);
  await page.goto(f.origin + "/?issue=" + work.issue_id + "&tab=Plan");
  const panel = page.getByRole("region", { name: "Independent proposal review" });
  await panel.getByText("Model offline").waitFor();
  await panel.getByText("Retry review or continue").waitFor();
  await panel.getByLabel("Reviewed plan").selectOption(old.fingerprint);
  await panel.getByText("Original reading for A").waitFor();
  await panel.getByText("Section 2 allows a partial rollback").waitFor();
  assert.equal(await panel.getByText("Retry review or continue").count(), 0);
  assert.match(await panel.innerText(), /Historical revision/);
  if (process.env.ABRACODE_TEST_EVIDENCE_DIR)
    await panel.screenshot({
      path: join(process.env.ABRACODE_TEST_EVIDENCE_DIR, "historical-findings.png"),
    });
  await panel.getByText("Open current plan").click();
  await panel.getByText("Model offline").waitFor();
  assert.equal(await panel.getByLabel("Reviewed plan").inputValue(), current.fingerprint);
  assert.equal(f.source.submissions, 0);
  assert.equal(f.replies.length, 0);
});
