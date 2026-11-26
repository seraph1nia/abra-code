import { tryDomainValue } from "../effect.ts";
import { GitError } from "../errors.ts";
import { join } from "node:path";
import {
  AbsolutePath,
  type BranchName,
  type Commit,
  type PullRequestUrl,
} from "@abracode/contracts/identities";
import { Effect } from "effect";
import { CrewError, type ManagedExecution, type Project } from "../domain.ts";
import { scopedTemporaryDirectory, writeFile } from "../filesystem.ts";
import { completedProgress, progress } from "../opencode/progress.ts";
import type { PublicationDestination } from "../workflow/finishing/contracts.ts";
import { publicationDestination } from "../workflow/finishing/contracts.ts";
import { type Forge, type PR } from "./forge.ts";
import { prContent, updateSummary } from "./pr-content.ts";
import { type Git } from "./repository.ts";

export type Publication = { commit: Commit; destination: PublicationDestination };
export type InspectPR = (
  p: Project,
  e: ManagedExecution,
) => Effect.Effect<PR | undefined, CrewError>;

export interface OwnedPRCheck {
  url?: PullRequestUrl | string;
  head?: Commit | readonly (Commit | undefined)[];
  base?: BranchName;
  states?: readonly PR["state"][];
}

export function matchesOwnedPR(
  pr: PR | undefined,
  p: Project,
  e: ManagedExecution,
  check: OwnedPRCheck = {},
): pr is PR {
  if (!pr) return false;
  const expectedUrl = "url" in check ? check.url : e.pull_request_reference;
  const expectedBase = "base" in check ? check.base : (e.target_branch ?? p.target_branch);
  const expectedHead = "head" in check ? check.head : e.delivered_commit;
  const headMatches = Array.isArray(expectedHead)
    ? expectedHead.includes(pr.headRefOid)
    : pr.headRefOid === expectedHead;
  const stateMatches = check.states ? check.states.includes(pr.state) : true;
  return stateMatches && pr.url === expectedUrl && pr.baseRefName === expectedBase && headMatches;
}

export function assertOwnedPR(
  pr: PR | undefined,
  p: Project,
  e: ManagedExecution,
  message: string,
  check: OwnedPRCheck = {},
  code = "PR_HEAD",
): Effect.Effect<PR, CrewError> {
  return matchesOwnedPR(pr, p, e, check)
    ? Effect.succeed(pr)
    : Effect.fail(new CrewError(code, message));
}

function withBody<A>(content: string, action: (path: AbsolutePath) => Effect.Effect<A, CrewError>) {
  return Effect.scoped(
    Effect.gen(function* () {
      const temp = yield* scopedTemporaryDirectory("abracode-pr-");
      const path = AbsolutePath.make(join(temp, "body.md"));
      yield* writeFile(path, content, { mode: 0o600, flag: "wx" });
      return yield* action(path);
    }),
  );
}

export function deliverPublication(
  git: Git,
  client: Forge,
  inspect: InspectPR,
  p: Project,
  e: ManagedExecution,
  { commit, destination }: Publication,
  draft = false,
): Effect.Effect<{ commit: Commit; pr?: PullRequestUrl }, CrewError> {
  return completedProgress("deliver")(
    Effect.gen(function* () {
      yield* progress({ stage: "deliver", status: "started" });
      const worktree = e.worktree_directory;
      if (!worktree) return yield* new GitError("WORKTREE", "Missing worktree");
      const predecessor = destination.kind === "initial" ? undefined : destination.predecessor;
      const ref = `refs/heads/${e.branch}`;
      const readRemote = () => git.run(worktree, ["ls-remote", "origin", ref]);
      const remote = yield* readRemote();
      const intended = `${commit}\t${ref}`;

      if (destination.kind === "synchronization" && p.delivery === "github-pr") {
        const prior = yield* inspect(p, e);
        if (
          matchesOwnedPR(prior, p, e, {
            states: ["MERGED"],
            url: destination.pr,
            base: e.target_branch,
            head: commit,
          }) &&
          remote === intended &&
          (yield* git.head(worktree)) === commit &&
          !(yield* git.dirty(worktree))
        ) {
          return { commit, pr: prior.url };
        }
        yield* assertOwnedPR(
          prior,
          p,
          e,
          "Synchronization PR is no longer the exact owned open publication",
          {
            states: ["OPEN"],
            url: destination.pr,
            base: e.target_branch,
            head: [destination.predecessor, commit],
          },
        );
      }

      if (remote !== intended) {
        if (remote !== (predecessor ? `${predecessor}\t${ref}` : "")) {
          return yield* new GitError(
            "DELIVERY_CHANGED",
            "Owned destination has a conflicting head",
          );
        }
        if (predecessor) {
          yield* git.run(worktree, ["merge-base", "--is-ancestor", predecessor, commit]);
        }
        if (destination.kind === "correction" && p.delivery === "github-pr") {
          const prior = yield* inspect(p, e);
          yield* assertOwnedPR(prior, p, e, "Correction PR changed before push", {
            states: ["OPEN"],
            url: destination.pr,
            base: e.target_branch,
            head: predecessor,
          });
        }
        yield* git.run(worktree, [
          "push",
          `--force-with-lease=${ref}:${predecessor ?? ""}`,
          "origin",
          `${commit}:${ref}`,
        ]);
        if ((yield* readRemote()) !== intended) {
          return yield* new GitError("DELIVERY_CHANGED", "Remote did not confirm the bound commit");
        }
      }

      if (p.delivery === "branch") return { commit };

      const content = yield* tryDomainValue(prContent, p, e, commit);
      const existing = yield* inspect(p, e);
      if (existing) {
        if (existing.state === "CLOSED") {
          return yield* new GitError("PR_CLOSED", "Existing PR was closed without merging");
        }
        if (destination.pr && existing.url !== destination.pr) {
          return yield* new GitError("PR_IDENTITY", "Owned PR identity changed");
        }
        yield* assertOwnedPR(existing, p, e, "Owned PR head differs from the intended delivery", {
          states: ["OPEN", "MERGED"],
          url: existing.url,
          head: commit,
        });
        if (existing.body === undefined) {
          return yield* new GitError(
            "PR_BODY_UNKNOWN",
            "PR body unavailable; do not replace unknown user content",
          );
        }
        const updated = yield* tryDomainValue(updateSummary, existing.body, content.body);
        if (existing.state === "OPEN" && updated !== existing.body) {
          yield* withBody(updated, (body) =>
            client.run(p, ["pr", "edit", existing.url, "--body-file", body]),
          );
          yield* assertOwnedPR(
            yield* inspect(p, e),
            p,
            e,
            "Owned PR changed during its publication update",
            { states: ["OPEN", "MERGED"], url: existing.url, head: commit },
          );
        }
        return { commit, pr: existing.url };
      }

      if (destination.pr) return yield* new GitError("PR_IDENTITY", "Owned PR is missing");
      const createdUrl = yield* withBody(content.body, (body) =>
        client.run(p, [
          "pr",
          "create",
          ...(draft ? ["--draft"] : []),
          "--head",
          e.branch,
          "--base",
          e.target_branch ?? p.target_branch,
          "--title",
          content.title,
          "--body-file",
          body,
        ]),
      );
      const created = yield* inspect(p, e);
      if (!created) {
        return yield* new GitError(
          "PR_UNKNOWN",
          "PR creation outcome unknown; reconcile before retrying",
        );
      }
      yield* assertOwnedPR(
        created,
        p,
        e,
        "Created PR identity, target or head differs from the intended publication",
        { states: ["OPEN"], url: createdUrl.trim(), head: commit },
      );
      return { commit, pr: created.url };
    }),
  );
}

export function provisionalPublication(
  git: Git,
  client: Forge,
  inspect: InspectPR,
  p: Project,
  e: ManagedExecution,
): Effect.Effect<{ commit: Commit; pr?: PullRequestUrl }, CrewError> {
  return Effect.gen(function* () {
    if (!e.worktree_directory) return yield* new GitError("WORKTREE", "Missing worktree");
    const commit = yield* git.commit(
      e.worktree_directory,
      e.issue_id,
      `Publish draft implementation ${e.issue_id}`,
    );
    return yield* deliverPublication(
      git,
      client,
      inspect,
      p,
      e,
      { commit, destination: publicationDestination(e) },
      true,
    );
  });
}
