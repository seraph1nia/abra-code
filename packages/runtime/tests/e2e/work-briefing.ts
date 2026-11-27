import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Schema } from "effect";
import { WorkBriefing } from "@abracode/contracts/visibility/briefing";

export const briefingQuestion = (text: string) =>
  text.startsWith("AbraCode, ") && /focus on|catch me up/.test(text);

// The local provider exercises tool choice, result transport and source navigation.
// Its decision policy is deterministic so both phrasings can be compared on identical facts.
export function briefingFixtureAnswer(
  question: string,
  messages: readonly { role: string; content: unknown }[],
) {
  const last = messages.findLast((message) => message.role === "tool")?.content;
  const content = Array.isArray(last) ? last.find((part) => part.type === "text")?.text : last;
  if (typeof content !== "string") return "Briefing tool result unavailable.";
  const result = Schema.decodeOption(
    Schema.fromJsonString(Schema.Struct({ result: WorkBriefing })),
  )(content);
  if (result._tag === "None") return "Briefing tool result unavailable.";
  const brief = result.value.result;
  const decision = brief.decisions.entries[0],
    research = brief.outcomes.entries.find((row) => row.report);
  const pick =
    !question.includes("research first") && decision
      ? "Review the merge for " + decision.issue_id
      : research
        ? "Read the research for " + research.issue_id
        : "No supported action";
  return question.includes("catch me up")
    ? pick +
        ". " +
        [...brief.outcomes.entries, ...brief.ongoing.entries, ...brief.queue.entries]
          .map((row) => row.fact)
          .join(". ")
    : pick + ".";
}

export async function runBriefingBrowser(input: {
  releaseProject: string;
  origin: string;
  ci: string;
  report: string;
  evidence?: string;
  invoke: (tool: string, args: unknown) => Promise<any>;
  eventually: <T>(f: () => Promise<T | undefined>, timeout?: number) => Promise<T>;
  ab: (...args: string[]) => Promise<{ stdout: string }>;
}) {
  const { invoke, ab } = input;
  await invoke("abra_project_onboard", {
    id: "release",
    path: input.releaseProject,
    action: "register",
    plan_approval: false,
    merge_approval: true,
    delivery: "github-pr",
    verification: [[process.execPath, "--version"]],
  });
  const { issue } = await invoke("abra_work_create", {
    repository_id: "release",
    request_id: "release-change",
    title: "Release the sample",
    description: "Implement the sample and preserve the accepted behavior",
  });
  await invoke("abra_work_create", {
    repository_id: "release",
    request_id: "next-release",
    title: "Publish release notes",
    description: "Document the release",
    dependencies: [issue.id],
  });
  await invoke("abra_work_start", { issue_id: issue.id });
  const read = async () =>
    Schema.decodeUnknownSync(WorkBriefing)(await invoke("abra_work_briefing", {}));
  const before = await input.eventually(async () => {
    const brief = await read();
    return brief.decisions.entries.some((row) => row.issue_id === issue.id && row.form_id) &&
      brief.ongoing.entries.some((row) => row.issue_id === input.ci && /check|CI/i.test(row.fact))
      ? brief
      : undefined;
  }, 90000);
  assert.equal(before.decisions.total, 1);
  assert.ok(before.outcomes.entries.some((row) => row.issue_id === input.report && row.report));
  await ab("open", input.origin);
  await ab("set", "viewport", "1500", "900");
  let turns = 0;
  async function ask(question: string, expected: string) {
    await ab("wait", '[aria-label="Message Abra"]:enabled');
    await ab("find", "label", "Message Abra", "fill", question);
    await ab("wait", '[aria-label="Send message"]:enabled');
    await ab("find", "role", "button", "click", "--name", "Send message", "--exact");
    turns++;
    await ab(
      "wait",
      "--fn",
      `[...document.querySelectorAll('.native-tool-observation summary')].filter(s=>s.textContent.startsWith('Briefing sources')).length >= ${turns} && [...document.querySelectorAll('.message-text')].at(-1)?.innerText.includes(${JSON.stringify(expected)})`,
    );
  }
  const focus = "AbraCode, what should I focus on?",
    catchup = "AbraCode, catch me up";
  const releasePick = "Review the merge for " + issue.id;
  const reportPick = "Read the research for " + input.report;
  await ask(focus, releasePick);
  await ask(catchup, releasePick);
  await ask(focus + " Put research first.", reportPick);
  await ask(catchup + ", research first.", reportPick);
  const afterReads = await read();
  assert.equal(afterReads.decisions.entries[0]?.form_id, before.decisions.entries[0]?.form_id);
  assert.equal(afterReads.decisions.entries[0]?.priority, before.decisions.entries[0]?.priority);
  if (input.evidence)
    await writeFile(join(input.evidence, "briefing-chat.txt"), (await ab("snapshot")).stdout);
  // Expand only the latest call so every evidence link has a single visible target.
  await ab("find", "last", ".native-tool-observation summary", "click");
  await ab("find", "role", "button", "click", "--name", "Research report");
  await ab("wait", "--text", "Reviewed retry messaging at the recorded PR head");
  await ab("find", "role", "button", "click", "--name", "Close inspector", "--exact");
  await ab("find", "role", "button", "click", "--name", "Release the sample · Merge approval");
  await ab("wait", "--text", "Controller checks");
  await ab("find", "role", "button", "click", "--name", "Close inspector", "--exact");
  await ab("find", "role", "link", "click", "--name", "Open decision", "--exact");
  await ab("find", "role", "button", "click", "--name", "Approve merge", "--exact");
  const after = await input.eventually(async () => {
    const brief = await read();
    return !brief.decisions.entries.some((row) => row.issue_id === issue.id) ? brief : undefined;
  });
  assert.ok(
    after.ongoing.entries.some((row) => row.issue_id === input.ci && /check|CI/i.test(row.fact)),
  );
  await ab("find", "role", "link", "click", "--name", "Chat", "--exact");
  await ask(catchup, reportPick);
  await ab("find", "role", "link", "click", "--name", "Work", "--exact");
  await ab("wait", "--text", "Recently inspected");
  await ab("find", "role", "link", "click", "--name", "Recently inspected", "--exact");
  await ab("wait", "--text", "Release the sample");
  await ab("wait", '[aria-label="Recently inspected tasks"] button');
  const desktop = (await ab("snapshot")).stdout;
  await ab("set", "viewport", "390", "844");
  await ab("wait", ".phone-navigation");
  const phone = (await ab("snapshot")).stdout;
  for (const snapshot of [desktop, phone]) assert.match(snapshot, /button "Release the sample"/);
  if (input.evidence) {
    await writeFile(join(input.evidence, "briefing-desktop.txt"), desktop);
    await writeFile(join(input.evidence, "briefing-phone.txt"), phone);
    await writeFile(
      join(input.evidence, "steps.md"),
      "Ask focus and catch-up on a fresh device. Repeat both with research first. Open the unvisited report and the release verification. Submit the bound merge form. Ask for another briefing and inspect the recent list on desktop and phone.\n",
    );
  }
  return {
    release: issue.id,
    ci: input.ci,
    report: input.report,
    turns,
    form: before.decisions.entries[0]?.form_id,
    after: after.decisions.total,
  };
}
