import { Fingerprint } from "../identities.ts";
import { Effect } from "effect";
import { createHash } from "node:crypto";
import { type Execution } from "../domain.ts";
import { type Git } from "../git/repository.ts";
/** Revision cycles require new authorization even when their artifact text is identical. */
export const fullPlanFingerprint = (git: Git, e: Execution) =>
  git.planFingerprint(e.worktree_directory!, e.openspec_change).pipe(
    Effect.map((content) =>
      e.planning_base_commit
        ? Fingerprint.make(
            createHash("sha256")
              .update(e.openspec_change)
              .update(e.rounds?.at(-1)?.id ?? "revision")
              .update(content)
              .digest("hex"),
          )
        : content,
    ),
  );
