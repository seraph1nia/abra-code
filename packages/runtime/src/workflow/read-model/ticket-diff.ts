import { WorkflowError } from "../../errors.ts";
import { tryDomainValue } from "../../effect.ts";
import { RelativePath, timestamp, IssueId } from "@abracode/contracts/identities";

import { ContentHash } from "@abracode/contracts/identities";
import { digest } from "../../digest.ts";
import type { DiffSelection } from "@abracode/contracts/web/resources";
import { parsePatch } from "diff";
import { Effect } from "effect";
import { identifier } from "../../domain.ts";
import { compareChanges } from "../../git/compare-changes.ts";
import { diagnosticText } from "../../opencode/diagnostics.ts";
import { type Queries } from "../queries.ts";
import { type Git } from "../../git/repository.ts";
import { type DiffScope, type WorkDiff } from "@abracode/contracts/visibility/document-contracts";
import { documentLimit } from "./documents.ts";
import { resolveCommit } from "./archived-plans.ts";

/** Owns comparison identity and bounded, lazy patch reads. Never stages or refreshes the index. */
export class TicketDiff {
  constructor(
    private c: Pick<Queries, "issue" | "execution" | "project"> & {
      git: Pick<Git, "run" | "validate">;
    },
  ) {}
  read = Effect.fn("TicketDiff.read")(
    { self: this },
    function* (issueID: IssueId, scope: DiffScope, selected?: RelativePath, filesOnly = false) {
      yield* tryDomainValue(identifier, issueID);
      yield* this.c.issue(issueID);
      const e = yield* this.c.execution(issueID);
      const at = yield* timestamp;
      const empty = (message: string): WorkDiff => ({
        at,
        historical: e?.current_phase === "completed",
        files: [],
        limited: false,
        message,
      });
      if (!e?.base_commit || !e.worktree_directory)
        return empty("No worktree yet. Changes appear after this ticket starts.");
      const p = yield* this.c.project(e.repository_id);
      if (!p) return yield* new WorkflowError("DIFF_REPOSITORY", "Repository is not registered");
      const historical = e.current_phase === "completed";
      if (historical && scope === "uncommitted")
        return empty("Uncommitted changes are unavailable after worktree retirement.");
      if (historical && !e.delivered_commit)
        return empty("Historical diff unavailable: no delivered commit was retained.");
      const path = historical ? p.path : e.worktree_directory;
      yield* this.c.git.validate(p, historical ? undefined : e);
      const base = yield* resolveCommit(
        this.c.git,
        path,
        scope === "uncommitted" ? "HEAD" : e.base_commit,
        "Diff base commit",
      );
      const head = yield* resolveCommit(
        this.c.git,
        path,
        historical ? e.delivered_commit! : "HEAD",
        "Diff head commit",
      );
      const { files, preview, limited } = yield* compareChanges(
        this.c.git,
        path,
        base,
        head,
        historical,
      );
      const file = selected;
      const result: { -readonly [K in keyof WorkDiff]: WorkDiff[K] } = {
        at,
        base,
        head,
        historical,
        files,
        file,
        limited,
      };
      if (filesOnly) return result;
      if (!files.length) return { ...result, message: "No changes against this base." };
      const patchIds = new Map<RelativePath, ContentHash>();
      const remember = (path: RelativePath, patch: string) => {
        patchIds.set(
          path,
          ContentHash.make(digest([issueID, scope, base, head, e.control_generation, path, patch])),
        );
      };
      const selectableFiles = () =>
        files.map((entry) => {
          const id = patchIds.get(entry.path);
          return id ? { ...entry, patch_id: id } : entry;
        });
      if (file) {
        const entry = files.find((entry) => entry.path === file);
        if (!entry)
          return {
            ...result,
            file: undefined,
            message: "Selected file is no longer in this comparison.",
          };
        const content = yield* preview(entry);
        if (Buffer.byteLength(content.patch ?? "") > documentLimit)
          return { ...result, message: "Patch exceeds 64 KiB. Text preview is limited." };
        if (content.patch) remember(file, content.patch);
        return { ...result, ...content, files: selectableFiles() };
      }
      // Keep whole patches: truncating bytes can corrupt hunks or hide a later file's header.
      // Exact-file reads remain available when a comparison exceeds this total preview budget.
      const patches: string[] = [];
      let bytes = 0,
        omitted = 0;
      for (const entry of files) {
        if (bytes >= documentLimit) {
          omitted++;
          continue;
        }
        const content = yield* preview(entry);
        if (!content.patch) {
          omitted++;
          continue;
        }
        const patch = content.patch.endsWith("\n") ? content.patch : `${content.patch}\n`;
        const size = Buffer.byteLength(patch);
        if (bytes + size > documentLimit) {
          omitted++;
          continue;
        }
        remember(entry.path, content.patch);
        patches.push(patch);
        bytes += size;
      }
      return {
        ...result,
        files: selectableFiles(),
        patch: patches.length ? patches.join("") : undefined,
        limited: result.limited || omitted > 0,
        ...(omitted
          ? {
              message: `${omitted} file preview(s) unavailable or outside the 64 KiB comparison preview. Search by file name to request an individual preview.`,
            }
          : {}),
      };
    },
    Effect.catch((error) =>
      timestamp.pipe(
        Effect.map((at): WorkDiff => ({
          at,
          historical: false,
          files: [],
          limited: false,
          message: `Diff unavailable: ${diagnosticText(error.message)}`,
        })),
      ),
    ),
  );
}

/** Extract from the exact owned single-file read used for validation. */
export function selectedDiffExcerpt(diff: WorkDiff, selection: DiffSelection) {
  const id = diff.files.find((file) => file.path === selection.file)?.patch_id;
  if (!id || id !== selection.patch_id || diff.file !== selection.file || !diff.patch)
    throw new WorkflowError(
      "SELECTION_STALE",
      "The selected diff changed or is unavailable. Review the updated diff or remove the selection.",
    );
  const [patch] = parsePatch(diff.patch);
  for (const hunk of patch?.hunks ?? []) {
    const added = selection.side === "additions";
    let line = added ? hunk.newStart : hunk.oldStart;
    const excerpt: string[] = [];
    for (const row of hunk.lines) {
      if (row[0] !== " " && row[0] !== (added ? "+" : "-")) continue;
      if (line >= selection.start && line <= selection.end) excerpt.push(row.slice(1));
      line++;
    }
    if (excerpt.length && excerpt.length === selection.end - selection.start + 1) {
      const text = excerpt.join("\n");
      if (text.length > 8192)
        throw new WorkflowError(
          "SELECTION_LIMIT",
          "Select a shorter passage (8192 characters maximum).",
        );
      return text;
    }
  }
  throw new WorkflowError("SELECTION_RANGE", "Select visible lines on one side of a single hunk.");
}
