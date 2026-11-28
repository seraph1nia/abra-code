import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { Form } from "@opencode/schema/form";
import { designFields } from "../../src/opencode/forms.ts";
import { workspaceBrowserFixture } from "../helpers/workspace-browser.ts";
import { capturePlanBrief } from "../../src/openspec/plan-brief.ts";
import { Fingerprint } from "@abracode/contracts/identities";

const choices = [
  {
    question: "Where should results appear?",
    recommended: "Canvas",
    reason: "Keep evidence beside Chat.",
    alternatives: ["Attention"],
  },
  {
    question: "When should it open?",
    recommended: "When idle",
    reason: "Preserve ongoing work.",
    alternatives: ["On demand"],
  },
];
const first = capturePlanBrief(
  Fingerprint.make("first"),
  [
    "## Outcomes",
    "Answer a design question beside Chat.",
    "## Recommendation",
    "Open the focused canvas when idle.",
    "## Risks",
    "A new panel can interrupt typing.",
    "## Alternatives considered",
    "1. Manual opening adds a click.",
  ].join("\n"),
  undefined,
  false,
);
const revised = capturePlanBrief(
  Fingerprint.make("second"),
  first.sections
    .map(
      (s) =>
        "## " +
        s.title +
        "\n" +
        (s.title === "Recommendation"
          ? "Open when idle on desktop. On phones, show a notice."
          : s.text),
    )
    .join("\n") +
    "\n## What changed\nOpen on demand on phones.\n## Why it matters\nKeep the keyboard and draft in place.",
  first,
  false,
);

for (const width of [1440, 390]) {
  test("review journeys at " + width + " CSS pixels", async (t) => {
    const f = await workspaceBrowserFixture();
    t.onTestFinished(f.close);
    const work = f.source.value.work.work[0];
    const page = await f.browser.newPage({ viewport: { width, height: 900 } });
    page.setDefaultTimeout(7000);
    const reading: { name: string; width: number; words: number; clicks: number }[] = [];
    const canvas = page.getByRole("complementary", { name: "Focused decision" });
    const review = page.getByRole("button", { name: "Review decision", exact: true });
    const form = (revision: string, batch: boolean): (typeof f.source.value.forms)[number] => ({
      active: true,
      binding: revision,
      checkpoint: {
        active: true,
        issue_id: work.issue_id,
        kind: batch ? "decision" : "plan",
        fingerprint: batch ? undefined : revision,
      },
      form: {
        id: Form.ID.make("frm_" + revision),
        sessionID: f.source.sessionID,
        title: batch ? "Choose how review opens" : "Review the plan",
        metadata: batch ? { design_choices: "sample" } : {},
        fields: batch
          ? designFields(choices)
          : [{ key: "authorize", type: "boolean", required: true }],
      },
    });
    let clicks = 0;
    const click = async (target: ReturnType<typeof page.getByRole>) => {
      await target.click();
      clicks++;
    };
    const record = async (
      name: string,
      expectedClicks: number,
      submit?: ReturnType<typeof page.getByRole>,
    ) => {
      // innerText for closed details varies between engines. Count only rendered text nodes.
      const words = await page.locator(".inspector:visible").evaluate((element) => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let total = 0;
        while (walker.nextNode()) {
          const node = walker.currentNode;
          const parent = node.parentElement;
          if (!parent?.checkVisibility() || parent.closest("option, .sr-only")) continue;
          let details = parent.closest("details:not([open])");
          let hidden = false;
          while (details) {
            if (!details.querySelector(":scope > summary")?.contains(parent)) {
              hidden = true;
              break;
            }
            details = details.parentElement?.closest("details:not([open])") ?? null;
          }
          if (hidden) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          if (range.getBoundingClientRect().height && node.textContent?.trim())
            total += node.textContent.trim().split(/\s+/).length;
        }
        for (const select of element.querySelectorAll("select")) {
          if (select.checkVisibility())
            total += select.selectedOptions[0]?.text.trim().split(/\s+/).length ?? 0;
        }
        return total;
      });
      if (process.env.ABRACODE_TEST_EVIDENCE_DIR) {
        await page
          .locator("[data-sonner-toast]:visible")
          .last()
          .waitFor({ state: "hidden", timeout: 10000 });
        await page.screenshot({
          path: join(
            process.env.ABRACODE_TEST_EVIDENCE_DIR,
            name.toLowerCase().replaceAll(" ", "-") + "-" + width + ".png",
          ),
        });
      }
      if (submit) await click(submit);
      assert.equal(clicks, expectedClicks);
      reading.push({ name, width, words, clicks });
      clicks = 0;
      assert.ok(words > 2 && words < 150);
    };
    await page.goto(f.origin);
    await page.getByLabel("Message Abra").waitFor();
    f.source.value = { ...f.source.value, forms: [form("design", true)] };
    await f.changed();
    if (width === 390) await click(review);
    await canvas.getByRole("button", { name: "Accept recommendations" }).waitFor();
    await record(
      "Explore batch",
      width === 390 ? 2 : 1,
      canvas.getByRole("button", { name: "Accept recommendations" }),
    );
    await canvas.getByText("This decision has closed or changed.").waitFor();
    assert.deepEqual(f.replies[0].answer, { choice_1: "Canvas", choice_2: "When idle" });
    await page.reload();
    await canvas.getByText("This decision has closed or changed.").waitFor();
    await canvas.getByLabel("Close inspector").click();
    for (const brief of [first, revised]) {
      const draft = page.getByLabel("Message Abra");
      await draft.fill("Keep my question");
      f.detailOverrides.set(work.issue_id, { plan_brief: brief });
      f.source.value = { ...f.source.value, forms: [form(brief.fingerprint, false)] };
      await f.changed();
      await review.waitFor();
      assert.equal(await draft.inputValue(), "Keep my question");
      assert.equal(await canvas.count(), 0);
      await click(review);
      await canvas
        .getByRole("heading", { name: brief.revised ? "What changed" : "Outcomes", exact: true })
        .waitFor();
      if (brief.revised) {
        await canvas.getByText("Keep the keyboard and draft in place.").waitFor();
        assert.equal(await canvas.getByRole("heading", { name: "Risks" }).count(), 0);
      } else {
        await canvas.getByText("Manual opening adds a click.", { exact: true }).waitFor();
        await canvas.getByText("A new panel can interrupt typing.", { exact: true }).waitFor();
      }
      await record(
        brief.revised ? "Revised plan" : "First plan",
        2,
        canvas.getByRole("button", { name: "Approve plan", exact: true }),
      );
      await canvas.getByText("This decision has closed or changed.").waitFor();
      await canvas.getByLabel("Close inspector").click();
    }
    f.source.value = {
      ...f.source.value,
      work: {
        ...f.source.value.work,
        work: [
          {
            ...work,
            issue_status: "closed",
          },
        ],
      },
    };
    f.detailOverrides.set(work.issue_id, {
      work: {
        ...f.source.value.work.work[0],
        outcome: {
          execution_id: "execution-finished",
          generation: 0,
          observed_at: Date.parse(f.source.value.at),
          approval: { kind: "plan", state: "recorded" },
          delivery: { kind: "branch", state: "verified" },
          cleanup: { state: "retired", generated_paths: [] },
          closure: "closed",
          next_action: "No action required.",
        },
      },
      verification: {
        observed: "revision",
        checks: [{ at: f.source.value.at, fingerprint: "revision", commands: ["pnpm check"] }],
        review: {
          passed: true,
          fingerprint: "revision",
          session_id: "ses_review",
          findings: "Verified.",
        },
      },
      intent: {
        goal: "Answer decisions in the canvas.",
        criteria: [],
        limitations: ["Small screens open on demand."],
      },
    });
    await page.goto(f.origin + "/work?issue=" + work.issue_id);
    await click(page.getByRole("tab", { name: "Reports" }));
    await page.getByText("Branch preserved. No action required.", { exact: true }).waitFor();
    await page.getByText("Independent review passed.", { exact: false }).waitFor();
    await record("Outcome report", 1);
    assert.equal(f.calls.filter((call) => call.name === "document").length, 0);
    if (process.env.ABRACODE_TEST_EVIDENCE_DIR) {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(
        join(process.env.ABRACODE_TEST_EVIDENCE_DIR, "reading-" + width + ".json"),
        JSON.stringify(reading, null, 2),
      );
    }
  });
}
