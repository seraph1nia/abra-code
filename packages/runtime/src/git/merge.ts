import {
  type BranchName,
  type Commit,
  type PullRequestUrl,
  type Timestamp,
  timestamp,
} from "@abracode/contracts/identities";
import { type Feedback } from "@abracode/contracts/workflow/feedback-contracts";
import { Effect } from "effect";
import { CrewError, type ManagedExecution, type Project } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { completedProgress, progress } from "../opencode/progress.ts";
import { type OperationResult } from "../workflow/results.ts";
import { type GitHubFeedback } from "./feedback.ts";
import { type Forge, type PR } from "./forge.ts";
import { assertOwnedPR, type InspectPR } from "./publish.ts";
import { type GitHubReadiness } from "./readiness.ts";
import { type Git } from "./repository.ts";

export interface DeliveryAssessment {
  pr: PR;
  feedback: Feedback;
  readiness: OperationResult;
}

export function assessPR(
  inspect: InspectPR,
  readinessAdapter: GitHubReadiness,
  feedbackAdapter: GitHubFeedback,
  p: Project,
  e: ManagedExecution,
): Effect.Effect<DeliveryAssessment, CrewError> {
  return domainEffect(
    Effect.gen(function* () {
      const pr = yield* assertOwnedPR(
        yield* inspect(p, e),
        p,
        e,
        "Findings require the exact open delivered PR/head/target",
        { states: ["OPEN"], base: e.target_branch },
      );
      const readiness = yield* readinessAdapter.check(p, e, pr);
      const feedback = yield* feedbackAdapter.observe(p, e, pr, readiness);
      yield* assertOwnedPR(
        yield* inspect(p, e),
        p,
        e,
        "PR changed identity or head while observing findings",
        { states: ["OPEN"], url: pr.url, head: pr.headRefOid, base: pr.baseRefName },
      );
      return { pr, feedback, readiness };
    }),
  );
}

export function mergePR(
  client: Forge,
  inspect: InspectPR,
  assess: (p: Project, e: ManagedExecution) => Effect.Effect<DeliveryAssessment, CrewError>,
  p: Project,
  e: ManagedExecution,
  assessed?: DeliveryAssessment,
  beforeSubmit?: () => Effect.Effect<void, CrewError>,
): Effect.Effect<OperationResult, CrewError> {
  return completedProgress("merge")(
    Effect.gen(function* () {
      yield* progress({ stage: "merge", status: "started" });
      const rawPr = yield* inspect(p, e);
      if (!rawPr) return yield* new CrewError("PR_MISSING", "No matching PR");
      const pr = yield* assertOwnedPR(
        rawPr,
        p,
        e,
        "PR target or head differs from reviewed delivery",
        { states: ["OPEN", "MERGED"] },
      );
      if (pr.state === "MERGED") return { category: "completed", value: undefined } as const;
      const observation = assessed ?? (yield* assess(p, e));
      if (observation.readiness.category !== "completed") return observation.readiness;
      const current = yield* assertOwnedPR(
        yield* inspect(p, e),
        p,
        e,
        "PR identity, head or target changed during readiness observation",
        { url: pr.url },
      );
      if (current.state === "CLOSED") {
        return yield* new CrewError("PR_CLOSED", "PR closed during readiness observation");
      }
      if (current.state === "MERGED") return { category: "completed", value: undefined } as const;
      if (!beforeSubmit) {
        return yield* new CrewError(
          "MERGE_GUARD",
          "Controller finishing readiness guard is required before merge submission",
        );
      }
      yield* beforeSubmit();
      const method = e.effective_policy.merge_method;
      yield* client.run(p, [
        "pr",
        "merge",
        pr.url,
        `--${method}`,
        "--match-head-commit",
        pr.headRefOid,
      ]);
      return { category: "completed", value: undefined } as const;
    }),
  );
}

export function deliveryEvidence(
  git: Git,
  inspect: InspectPR,
  p: Project,
  e: ManagedExecution,
): Effect.Effect<
  {
    commit: Commit;
    source_commit?: Commit;
    result_commit?: Commit;
    target: BranchName;
    method?: ManagedExecution["effective_policy"]["merge_method"];
    pr?: PullRequestUrl;
    at: Timestamp;
  },
  CrewError
> {
  return completedProgress("deliver")(
    Effect.gen(function* () {
      yield* progress({ stage: "deliver", status: "started" });
      if (p.delivery === "branch") {
        if (!e.delivered_commit) return yield* new CrewError("DELIVERY", "No committed delivery");
        const ref = yield* git.run(p.path, ["ls-remote", "origin", `refs/heads/${e.branch}`]);
        if (!ref.startsWith(`${e.delivered_commit}\t`)) {
          return yield* new CrewError(
            "DELIVERY",
            "Exact commit is not preserved in configured remote branch",
          );
        }
        return { commit: e.delivered_commit, target: e.branch, at: yield* timestamp };
      }
      const pr = yield* assertOwnedPR(
        yield* inspect(p, e),
        p,
        e,
        "Delivery is not a verified merge of the intended PR head",
        { states: ["MERGED"] },
        "NOT_MERGED",
      );
      const mergeOid = pr.mergeCommit?.oid;
      if (!mergeOid) {
        return yield* new CrewError(
          "NOT_MERGED",
          "Delivery is not a verified merge of the intended PR head",
        );
      }
      const target = e.target_branch ?? p.target_branch;
      const method = e.effective_policy.merge_method;
      yield* git.run(p.path, ["fetch", "--no-tags", "origin", `refs/heads/${target}`]);
      yield* git.run(p.path, ["merge-base", "--is-ancestor", mergeOid, "FETCH_HEAD"]);
      if (method === "merge") {
        yield* git.run(p.path, ["merge-base", "--is-ancestor", pr.headRefOid, "FETCH_HEAD"]);
      }
      return {
        commit: pr.headRefOid,
        source_commit: pr.headRefOid,
        result_commit: mergeOid,
        target,
        method,
        pr: pr.url,
        at: yield* timestamp,
      };
    }),
  );
}
