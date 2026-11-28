import type { Fingerprint } from "@abracode/contracts/identities";
import type { PlanBrief } from "@abracode/contracts/visibility/document-contracts";

const headings = [
  ["Outcomes", "Outcome", "Why"],
  ["Recommendation", "Scope and choices", "What Changes"],
  ["Risks"],
  ["Alternatives considered"],
  ["Constraints"],
  ["Decision needed"],
] as const;

export function capturePlanBrief(
  fingerprint: Fingerprint,
  proposal: string,
  previous: PlanBrief | undefined,
  revised: boolean,
): PlanBrief {
  if (previous?.fingerprint === fingerprint) return previous;
  const blocks = new Map<string, string[]>();
  let lines: string[] | undefined;
  let fence: string | undefined;
  for (const line of proposal.split(/\r?\n/)) {
    const delimiter = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (delimiter) {
      if (!fence) fence = delimiter;
      else if (delimiter.startsWith(fence)) fence = undefined;
      continue;
    }
    if (fence) continue;
    const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      lines = [];
      blocks.set(heading[1]!.toLowerCase(), lines);
    } else lines?.push(line);
  }
  function section(name: string) {
    const text = blocks.get(name.toLowerCase())?.join("\n").trim();
    if (!text) return undefined;
    return text.length > 1200 ? text.slice(0, 1199) + "…" : text;
  }
  const sections = headings.flatMap(([title, ...aliases]) => {
    const text = [title, ...aliases].map(section).find(Boolean);
    return text ? [{ title, text }] : [];
  });
  if (!previous?.sections.length || !sections.length)
    return { fingerprint, sections, revised: Boolean(previous) || revised };
  const changed = sections.filter(
    (s) => previous.sections.find((p) => p.title === s.title)?.text !== s.text,
  );
  const removed = previous.sections.filter((p) => !sections.some((s) => s.title === p.title));
  const derived = [
    ...changed.map((s) => s.title + " — " + s.text),
    ...removed.map((s) => s.title + " was removed."),
  ].join("\n\n");
  return {
    fingerprint,
    sections,
    revised: Boolean(previous) || revised,
    previous: previous.fingerprint,
    changes:
      section("What changed") ??
      (derived || "The plan revision changed. Its brief records no material difference."),
    significance: section("Why it matters"),
  };
}
