import { createContext } from "react";

export const composerCommands = [
  {
    id: "onboard-repo",
    label: "Onboard repository",
    aliases: ["add project", "add repository"],
    effect: "Prepare draft",
    text: "Inspect registered projects and help me onboard a project.",
  },
  {
    id: "save-thought",
    label: "Save thought",
    aliases: ["save memo", "capture thought"],
    effect: "Prepare draft",
    text: "Save the following wording as a private thought in Memos:",
  },
  {
    id: "attach-thought",
    label: "Attach thought",
    aliases: ["use memo"],
    effect: "Attach to chat",
  },
  {
    id: "memory",
    label: "Search agent memory",
    aliases: ["Basic Memory", "search notes", "brain"],
    effect: "Open",
  },
] as const;
export type ComposerCommand = (typeof composerCommands)[number];
export const RunCommand = createContext<(command: ComposerCommand) => void>(() => {});
export function workControl(action: "pause" | "resume" | "advance", issue: string) {
  return {
    id: action,
    label: "Ask Abra to " + action + " work",
    effect: "Prepare draft",
    text: `Request controller action ${action} for ${issue}. Inspect its current state and use the existing guarded work control.`,
  };
}
export function appendDraft(text: string, addition: string) {
  const result = [text, addition].filter(Boolean).join("\n");
  return result.length <= 32768 ? result : undefined;
}
export function slashToken(text: string, caret: number) {
  const before = text.slice(0, caret);
  let fence = "";
  for (const line of before.split("\n")) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!marker) continue;
    if (!fence) fence = marker[1];
    else if (marker[1].startsWith(fence) && !marker[2].trim()) fence = "";
  }
  if (fence) return;
  const match = /(?:^|\s)(\/[a-z-]*)$/i.exec(before);
  if (!match || (caret < text.length && !/\s/.test(text[caret]!))) return;
  const token = match[1]!;
  return { start: caret - token.length, end: caret, token };
}

export function snippetDraft(excerpt: string, source: string) {
  const runs = excerpt.match(/`+/g) ?? [];
  const fence = "`".repeat(Math.max(3, ...runs.map((run) => run.length + 1)));
  return source + "\n" + fence + "\n" + excerpt + "\n" + fence;
}
