import { RelativePath, Commit, timestamp, IssueId } from "../identities.ts";

import { Effect } from "effect";
import { CrewError, identifier } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { realpath } from "../filesystem.ts";
import { diagnosticText } from "../opencode/diagnostics.ts";
import { type Queries } from "../workflow/queries.ts";
import { type Git } from "../git/repository.ts";
import { type DiffScope, type WorkDiff } from "./protocol.ts";
import { documentLimit } from "./documents.ts";

import { untrackedDiff } from "./untracked-diff.ts";

const fileLimit = 500;
type DiffFile = WorkDiff["files"][number];
/** Owns comparison identity and bounded, lazy patch reads. Never stages or refreshes the index. */
export class TicketDiff {
  constructor(
    private c: Pick<Queries, "issue" | "execution" | "project"> & {
      git: Pick<Git, "run" | "validate">;
    },
  ) {}
  read = Effect.fn("TicketDiff.read")(
    function* (this: TicketDiff, issueID: IssueId, scope: DiffScope, selected?: RelativePath) {
      identifier(issueID);
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
      if (!p) return yield* new CrewError("DIFF_REPOSITORY", "Repository is not registered");
      const historical = e.current_phase === "completed";
      if (historical && scope === "uncommitted")
        return empty("Uncommitted changes are unavailable after worktree retirement.");
      if (historical && !e.delivered_commit)
        return empty("Historical diff unavailable: no delivered commit was retained.");
      const path = historical ? p.path : e.worktree_directory;
      yield* this.c.git.validate(p, historical ? undefined : e);
      const base = Commit.make(
        yield* this.c.git.run(path, [
          "rev-parse",
          "--verify",
          "--end-of-options",
          `${scope === "uncommitted" ? "HEAD" : e.base_commit}^{commit}`,
        ]),
      );
      const head = Commit.make(
        yield* this.c.git.run(path, [
          "rev-parse",
          "--verify",
          "--end-of-options",
          `${historical ? e.delivered_commit : "HEAD"}^{commit}`,
        ]),
      );
      const range = historical ? [base, head] : [base];
      const diff = [
        "--literal-pathspecs",
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--no-renames",
      ];
      const [stats, names, untracked] = yield* Effect.all(
        [
          this.c.git.run(path, [...diff, "--numstat", "-z", ...range, "--"]),
          this.c.git.run(path, [...diff, "--name-status", "-z", ...range, "--"]),
          historical
            ? Effect.succeed("")
            : this.c.git.run(path, ["ls-files", "--others", "--exclude-standard", "-z"]),
        ],
        { concurrency: "unbounded" },
      );
      const statuses = new Map<RelativePath, DiffFile["status"]>();
      const tokens = names.split("\0");
      for (let i = 0; i + 1 < tokens.length; i += 2)
        statuses.set(
          RelativePath.make(tokens[i + 1]),
          tokens[i] === "A" ? "added" : tokens[i] === "D" ? "deleted" : "modified",
        );
      let files: DiffFile[] = [];
      const records = stats.split("\0").filter(Boolean);
      const extra = untracked
        .split("\0")
        .filter(Boolean)
        .map((path) => RelativePath.make(path));
      for (const record of records.slice(0, fileLimit)) {
        const parsed = /^(-|\d+)\t(-|\d+)\t([\s\S]+)$/.exec(record);
        if (!parsed)
          return yield* new CrewError("DIFF_FORMAT", "Git returned invalid diff statistics");
        files.push({
          path: RelativePath.make(parsed[3]),
          status: statuses.get(RelativePath.make(parsed[3])) ?? "modified",
          additions: Number(parsed[1]) || 0,
          deletions: Number(parsed[2]) || 0,
          binary: parsed[1] === "-",
          limited: false,
        });
      }
      const tree = historical ? undefined : yield* realpath(path);
      const extraDiff = historical
        ? { files, patches: new Map<RelativePath, { patch?: string; message?: string }>() }
        : yield* untrackedDiff(this.c.git, tree!, base, files, extra, fileLimit);
      files = extraDiff.files;
      files.sort((a, b) => a.path.localeCompare(b.path));
      const file = selected ?? files[0]?.path;
      const result: { -readonly [K in keyof WorkDiff]: WorkDiff[K] } = {
        at,
        base,
        head,
        historical,
        files,
        file,
        limited: new Set([...statuses.keys(), ...extra]).size > fileLimit,
      };
      if (!file) return { ...result, message: "No changes against this base." };
      const entry = files.find((f) => f.path === file);
      if (!entry)
        return {
          ...result,
          file: undefined,
          message: "Selected file is no longer in this comparison. Choose a changed file.",
        };
      if (entry.binary)
        return { ...result, message: "Binary file changed. A text patch is not available." };
      if (entry.limited)
        return {
          ...result,
          message: "File is too large or unavailable for safe preview (64 KiB limit).",
        };
      const fresh = extraDiff.patches.get(file);
      if (fresh) {
        result.patch = fresh.patch;
        result.message = fresh.message;
      } else
        result.patch = yield* this.c.git.run(path, [...diff, "--unified=3", ...range, "--", file], {
          trim: false,
        });
      if (Buffer.byteLength(result.patch ?? "") > documentLimit) {
        delete result.patch;
        result.message = "Patch exceeds 64 KiB. Statistics are shown; text preview is limited.";
      }
      return result;
    }.bind(this),
    domainEffect,
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
