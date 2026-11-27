import { relative, join, isAbsolute } from "node:path";
import { Schema } from "effect";
import { SafeRelativePath } from "@abracode/contracts/identities";
import type { Execution } from "../domain.ts";
import type { ApplyStatus } from "./contracts.ts";

export function planSteps(e: Execution, apply: ApplyStatus) {
  const root = join(e.worktree_directory!, "openspec/changes", e.openspec_change);
  return {
    total: apply.progress.total,
    complete: apply.progress.complete,
    rows: apply.tasks.slice(0, 100).map((t) => {
      const path =
        t.sourcePath && (isAbsolute(t.sourcePath) ? relative(root, t.sourcePath) : t.sourcePath);
      const source =
        path && path.endsWith(".md") && Schema.is(SafeRelativePath)(path) && t.line && t.line > 0
          ? { path, line: t.line }
          : undefined;
      return {
        id: t.id,
        label:
          t.description && t.description.length > 320
            ? t.description.slice(0, 319) + "…"
            : t.description || "Task " + t.id,
        done: t.done,
        source: source || undefined,
      };
    }),
  };
}
